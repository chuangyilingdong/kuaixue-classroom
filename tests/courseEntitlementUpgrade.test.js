import test from 'node:test';
import assert from 'node:assert/strict';
import {openCoursePlatform} from '../apps/api/course-platform.mjs';
import {createApiServer} from '../apps/api/server.mjs';
import {createAccountReader} from '../apps/api/account.mjs';

const model='aicyld-runninghub-llm-cn::deepseek/deepseek-v4.1-flash';
const draft={title:'升级权益回归',subtitle:'同课程更新继续享有权益',price:100,
  permittedDeliveryModes:['CANVAS','VIBECODING'],vibeModelIds:[model],
  steps:[{id:'first',title:'第一步',description:'完成练习',deliverable:'作品'}]};
const receipt=order=>({...order,status:'confirmed',transactionId:`ledger-${order.orderId}`});

async function fixture(t){
  const debits=[];
  const grants=[];
  const platform=openCoursePlatform(':memory:',{
    debitOrLookup:async order=>{debits.push(order);return receipt(order);},
    issueRuntimeTicket:async context=>{grants.push(context);return 'ticket'.repeat(8);},
    issueLocalModelGrant:async context=>({baseUrl:'https://aicyld.com.cn/api/kuaixue/runtime/v1/',
      token:'model-grant',expiresAt:Date.now()+60000,modelIds:context.modelIds,
      usageLimit:0,usageUsed:0,usageRemaining:null}),
  });
  t.after(()=>platform.close());
  const course=platform.publish('operator',draft);
  const target={courseId:course.id,versionId:course.versionId};
  const order=await platform.purchase('learner',target);
  return {platform,debits,grants,course,order,target};
}

test('old purchase opens updated canvas and Vibe without purchase, and keeps historical work',async t=>{
  const {platform:p,debits,course,order,target}=await fixture(t);
  const oldRun=await p.start('learner',{...target,mode:'CANVAS'});
  p.save('learner',{id:oldRun.id,revision:oldRun.revision,mode:'CANVAS',completed:['first'],work:{nodes:[{id:'old-work'}],edges:[]}});
  const next=p.publish('operator',{...draft,id:course.id,baseVersion:course.versionId,price:500});
  assert.equal(next.id,course.id);
  assert.notEqual(next.versionId,course.versionId);
  const current={courseId:next.id,versionId:next.versionId};
  const canvas=await p.start('learner',{...current,mode:'CANVAS'});
  const vibe=await p.start('learner',{...current,mode:'VIBECODING'});
  assert.equal(canvas.id,vibe.id);
  assert.equal(debits.length,1);
  assert.equal(p.listGrants('learner').length,1);
  const context={userId:'learner',runId:vibe.id,...current,mode:'VIBECODING'};
  assert.equal(p.hasRuntimeAccess(context),true);
  assert.equal(p.hasRuntimeAccess({...context,userId:'other'}),false);
  assert.equal(p.hasRuntimeAccess({...context,courseId:'other'}),false);
  assert.equal((await p.localRuntime('learner',{id:vibe.id})).modelGateway.token,'model-grant');
  p.save('learner',{id:canvas.id,revision:canvas.revision,mode:'CANVAS',completed:['first'],work:{nodes:[{id:'new-work'}],edges:[]}});
  assert.equal(p.works('learner').find(w=>w.mode==='CANVAS').versionId,next.versionId);
  const restored=await p.start('learner',{...target,mode:'CANVAS'});
  assert.deepEqual(restored.work,{nodes:[{id:'old-work'}],edges:[]});
  assert.deepEqual(restored.completed,['first']);
  const inherited=await p.purchase('learner',current);
  assert.equal(inherited.inherited,true);
  assert.equal(debits.length,1);
  assert.equal(p.revoke(order.orderId,`ledger-${order.orderId}`),1);
  assert.equal(p.hasRuntimeAccess(context),false);
  await assert.rejects(p.start('learner',{...current,mode:'CANVAS'}),error=>error.status===403);
  await assert.rejects(p.start('learner',{...current,mode:'VIBECODING'}),error=>error.status===403);
  await assert.rejects(p.localRuntime('learner',{id:vibe.id}),error=>error.status===403);
  assert.deepEqual(p.works('learner'),[]);
});

test('a revoked newer order still inherits another valid course purchase',async t=>{
  const {platform:p,course,target,order}=await fixture(t);
  assert.equal(p.revoke(order.orderId,`ledger-${order.orderId}`),1);
  const next=p.publish('operator',{...draft,id:course.id,baseVersion:course.versionId});
  const current={courseId:next.id,versionId:next.versionId};
  const newer=await p.purchase('learner',current);
  assert.equal(p.revoke(newer.orderId,`ledger-${newer.orderId}`),1);
  const third=p.publish('operator',{...draft,id:course.id,baseVersion:next.versionId});
  await p.purchase('learner',{courseId:third.id,versionId:third.versionId});
  assert.equal((await p.purchase('learner',current)).inherited,true);
  const run=await p.start('learner',{...target,mode:'VIBECODING'});
  assert.equal(p.hasRuntimeAccess({userId:'learner',runId:run.id,...target,mode:'VIBECODING'}),true);
});

test('deployed account API preserves both avatar field names and complete combined balance',async t=>{
  for(const field of ['avatar','avatarUrl']){
    const profile={id:'learner',username:'学员',[field]:'https://aicyld.com.cn/uploads/avatar.png'};
    const accountReader=createAccountReader({mainSite:'http://127.0.0.1:3001',
      identity:async token=>token==='valid'?{userId:'learner',mainSiteToken:'test-main-token'}:null,
      listGrants:()=>[],fetchImpl:async url=>Response.json(url.pathname==='/api/auth/me'?profile:{pointsPaid:700,pointsSub:300,total:1000})});
    const server=createApiServer({accountReader});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    try{
      const response=await fetch(`http://127.0.0.1:${server.address().port}/api/v1/me`,{headers:{Cookie:'kuaixue_session=valid'}});
      assert.equal(response.status,200);
      const {data}=await response.json();
      assert.equal(data.user.avatarUrl,profile[field]);
      assert.equal(data.points,1000);
      assert.deepEqual(data.entitlements,[]);
    }finally{await new Promise(resolve=>server.close(resolve));}
  }
});


test('loopback account reads retain the public HTTPS origin for main-site media rewriting',async()=>{
  const reader=createAccountReader({mainSite:'http://127.0.0.1:3001',publicMainSite:'https://aicyld.com.cn',
    identity:()=>({userId:'learner',mainSiteToken:'test-main-token'}),listGrants:()=>[],
    fetchImpl:async(url,init)=>{
      assert.equal(url.origin,'http://127.0.0.1:3001');
      assert.equal(init.headers['X-Forwarded-Host'],'aicyld.com.cn');
      assert.equal(init.headers['X-Forwarded-Proto'],'https');
      return Response.json(url.pathname==='/api/auth/me'
        ?{id:'learner',username:'学员',avatar:`${init.headers['X-Forwarded-Proto']}://${init.headers['X-Forwarded-Host']}/api/media/avatar.jpg`}
        :{pointsPaid:700,pointsSub:300,total:1000});
    }});
  assert.equal((await reader('session')).user.avatarUrl,'https://aicyld.com.cn/api/media/avatar.jpg');
});


test('internal runtime access rechecks historical course purchases and their revocation',async t=>{
  const {platform:p,course,order}=await fixture(t);
  const next=p.publish('operator',{...draft,id:course.id,baseVersion:course.versionId});
  const target={courseId:next.id,versionId:next.versionId};
  const run=await p.start('learner',{...target,mode:'VIBECODING'});
  const server=createApiServer({platform:p,internalAccessSecret:'fixture-internal-secret'});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url=`http://127.0.0.1:${server.address().port}/internal/course-runtime/access`;
  const context={userId:'learner',runId:run.id,...target,mode:'VIBECODING'};
  const check=(body=context,secret='fixture-internal-secret')=>fetch(url,{method:'POST',headers:{
    'Content-Type':'application/json','x-kuaixue-internal-secret':secret},body:JSON.stringify(body)});
  assert.equal((await check(context,'wrong')).status,403);
  assert.equal((await check({})).status,400);
  assert.equal((await (await check()).json()).data.allowed,true);
  assert.equal((await (await check({...context,userId:'other'})).json()).data.allowed,false);
  p.revoke(order.orderId,`ledger-${order.orderId}`);
  assert.equal((await (await check()).json()).data.allowed,false);
});
