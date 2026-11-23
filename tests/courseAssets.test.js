import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApiServer} from '../apps/api/server.mjs';
import {openCoursePlatform} from '../apps/api/course-platform.mjs';
import {createCourseClient} from '../src/services/courseClient.js';

async function fixture(t) {
  const root=await mkdtemp(join(tmpdir(),'kuaixue-assets-'));
  const platform=openCoursePlatform(join(root,'course.sqlite'),{assetRoot:join(root,'objects'),maxAssetBytes:32});
  t.after(async()=>{platform.close();await rm(root,{recursive:true,force:true});});
  const course=platform.publish('operator',{
    title:'画布素材课',subtitle:'上传测试',permittedDeliveryModes:['CANVAS'],price:0,
    steps:[{id:'one',title:'画面',description:'放入素材',deliverable:'画布'}],
  });
  await platform.purchase('learner',{courseId:course.id,versionId:course.versionId});
  const run=await platform.start('learner',{courseId:course.id,versionId:course.versionId,mode:'CANVAS'});
  const server=createApiServer({
    platform,identity:session=>session==='qa'?{userId:'learner'}:null,allowedOrigins:['kuaixue://classroom'],
  });
  server.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  return {platform,course,run,origin:`http://127.0.0.1:${server.address().port}`};
}

function upload(origin,runId,bytes,{cookie='kuaixue_session=qa',mime='image/png',name='课堂 素材.png',kind='image'}={}) {
  return fetch(`${origin}/api/v1/course-assets`,{
    method:'POST',redirect:'error',
    headers:{Origin:'kuaixue://classroom',Cookie:cookie,'Content-Type':mime,
      'X-Kuaixue-Run-Id':runId,'X-Kuaixue-File-Name':encodeURIComponent(name),'X-Kuaixue-Asset-Kind':kind},
    body:bytes,
  });
}

test('画布素材经登录、权益和运行实例校验后持久化并可重新读取',async t=>{
  const {platform,course,run,origin}=await fixture(t);
  const bytes=Buffer.from('89504e470d0a1a0a','hex');
  const uploaded=await upload(origin,run.id,bytes);
  const payload=await uploaded.json();
  assert.equal(uploaded.status,201,JSON.stringify(payload));
  const asset=payload.data;
  assert.equal(asset.kind,'image');
  assert.equal(asset.size,8);
  assert.match(asset.assetUrl,/^\/api\/v1\/course-assets\//);
  const saved=await readFile(platform.asset('learner',asset.id).path);
  assert.deepEqual(saved,bytes);
  const response=await fetch(origin+asset.assetUrl,{headers:{Cookie:'kuaixue_session=qa'}});
  assert.equal(response.status,200);
  assert.equal(response.headers.get('content-type'),'image/png');
  assert.equal(response.headers.get('accept-ranges'),'bytes');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
  const ranged=await fetch(origin+asset.assetUrl,{headers:{Cookie:'kuaixue_session=qa',Range:'bytes=1-3'}});
  assert.equal(ranged.status,206);
  assert.equal(ranged.headers.get('content-range'),'bytes 1-3/8');
  assert.deepEqual(Buffer.from(await ranged.arrayBuffer()),bytes.subarray(1,4));
  const anonymous=await fetch(origin+asset.assetUrl);
  assert.equal(anonymous.status,401);
  const work={nodes:[{id:'local-1',type:'image',position:{x:10,y:20},data:{
    title:asset.name,uploaded:true,uploading:false,fileAssetId:asset.id,assetUrl:asset.assetUrl,previewUrl:asset.previewUrl,
  }}],edges:[]};
  assert.deepEqual(platform.save('learner',{id:run.id,revision:run.revision,mode:'CANVAS',completed:[],work}),{revision:1});
  const reopened=await platform.start('learner',{courseId:course.id,versionId:course.versionId,mode:'CANVAS'});
  assert.deepEqual(reopened.work,work);
});

test('素材上传拒绝未登录、未购版本、非法类型与超限内容',async t=>{
  const {run,origin}=await fixture(t);
  assert.equal((await upload(origin,run.id,Buffer.from('x'),{cookie:''})).status,401);
  assert.equal((await upload(origin,run.id,Buffer.from('x'),{mime:'text/html'})).status,415);
  assert.equal((await upload(origin,run.id,Buffer.alloc(33))).status,413);
  assert.equal((await upload(origin,'00000000-0000-0000-0000-000000000000',Buffer.from('x'))).status,403);
});

test('桌面课程客户端上传原始文件并把素材地址转成正式 HTTPS 地址',async()=>{
  const calls=[];
  const client=createCourseClient({base:'https://aicyld.com.cn',vibeOrigin:'https://kuaixue-vibe.aicyld.com.cn',
    parentOrigin:'kuaixue://classroom',account:async()=>({}),
    fetchImpl:async (url,options)=>{
      calls.push({url,options});
      return new Response(JSON.stringify({data:{id:'asset-1',name:'画面.png',mime:'image/png',size:3,kind:'image',
        assetUrl:'/api/v1/course-assets/asset-1',previewUrl:'/api/v1/course-assets/asset-1'}}),{status:201});
    }});
  const file=Object.assign(new Blob([Buffer.from('png')],{type:'image/png'}),{name:'画面.png'});
  const asset=await client.uploadAsset('12345678-1234-1234-1234-123456789012',file);
  assert.equal(calls[0].url,'https://aicyld.com.cn/api/v1/course-assets');
  assert.equal(calls[0].options.headers['X-Kuaixue-Asset-Kind'],'image');
  assert.equal(calls[0].options.headers['X-Kuaixue-File-Name'],encodeURIComponent('画面.png'));
  assert.equal(asset.assetUrl,'https://aicyld.com.cn/api/v1/course-assets/asset-1');
});
