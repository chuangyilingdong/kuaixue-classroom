import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {openCoursePlatform} from '../apps/api/course-platform.mjs';
import {createApiServer} from '../apps/api/server.mjs';
import {createCourseClient,workbenchUrl} from '../src/services/courseClient.js';
import {loadCourseCatalog,loadCourseDetail} from '../src/services/courseCatalog.js';
import {loadLearningAccount} from '../src/services/learningAccount.js';
import {createAccountReader} from '../apps/api/account.mjs';
import oauth from '../electron/desktop-login.cjs';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import workshop from '../electron/workshop.cjs';
const draft = {title:'分镜与网页',subtitle:'把分镜做成网页',price:100,permittedDeliveryModes:['CANVAS','VIBECODING'],steps:[{id:'plan',title:'分镜',description:'绘制画面',deliverable:'故事板'}]};

test('staging: published dual version, confirmed wallet order, recovery, refund and owner isolation',async t => {
  const orders = new Map(); let fail = true;
  const tickets = [];
  const platform = openCoursePlatform(':memory:',{
    debitOrLookup: async (order) => {
      if (!orders.has(order.orderId)) orders.set(order.orderId,{...order,status:'confirmed',transactionId:`ledger-${order.orderId}`});
      if (fail) { fail=false; throw Error('response lost after debit'); }
      return orders.get(order.orderId);
    },
    issueRuntimeTicket: async context => {tickets.push(context);return 'sample'.repeat(8);},
  });
  const identity = session => ['alice','bob'].includes(session) ? {userId:session,mainSiteToken:session} : null;
  const accountReader = createAccountReader({identity,mainSite:'https://main.example',listGrants:platform.listGrants,
    fetchImpl:async (url,init) => ({ok:true,json:async () => url.pathname.endsWith('/me') ? {id:init.headers.Authorization.slice(7),username:'学员'} : {total:260}})});
  const server = createApiServer({platform,identity,accountReader,allowedOrigins:['kuaixue://classroom']});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));platform.close();});
  const base = `http://127.0.0.1:${server.address().port}`;
  const fetchAs = name => (url,opts) => fetch(url,{...opts,headers:{...opts?.headers,Origin:'kuaixue://classroom',Cookie:'kuaixue_session='+name}});
  const client = name => createCourseClient({base,vibeOrigin:'https://vibe.example',parentOrigin:'kuaixue://classroom',fetchImpl:fetchAs(name),account:()=>loadLearningAccount({base,fetchImpl:fetchAs(name)})});
  assert.throws(()=>platform.publish('operator',{...draft,permittedDeliveryModes:[]}),/工作区/);
  const course = platform.publish('operator',draft);
  const args = [course.id,course.versionId];
  const summary = (await loadCourseCatalog({baseUrl:base})).courses[0];
  assert.deepEqual(summary.permittedDeliveryModes,draft.permittedDeliveryModes);
  for (const mode of draft.permittedDeliveryModes) assert.equal((await (await fetch(`${base}/api/v1/catalog/courses?type=${mode}`)).json()).data.items[0].id,course.id);
  const alice = client('alice'), bob = client('bob');
  await assert.rejects(alice.start(...args,'CANVAS'),/权益/);
  await assert.rejects(alice.purchase(...args),/暂不可用/);
  const recovered = await Promise.all([alice.purchase(...args),alice.purchase(...args)]);
  assert.equal(recovered[0].entitlements[0].status,'active'); assert.equal(orders.size,1);
  const snapshot = {nodes:[{id:'story'}],edges:[]};
  const canvas = await alice.start(...args,'CANVAS');
  await alice.save({...canvas,completed:['plan'],work:snapshot});
  const vibe = await alice.start(...args,'VIBECODING');
  assert.equal(vibe.id,canvas.id);assert.deepEqual(vibe.completed,['plan']); assert.equal(vibe.revision,1);
  assert.equal(new URL(vibe.frameUrl).origin,'https://vibe.example'); assert.equal(tickets[0].runId,canvas.id);
  await alice.save({...vibe,completed:[]});
  await assert.rejects(alice.save({...canvas,work:snapshot}),/更新/);
  await assert.rejects(bob.save({...canvas,work:snapshot}),/权益/);
  assert.deepEqual((await alice.works()).map(w=>w.mode).sort(),['CANVAS','VIBECODING']);
  assert.deepEqual(await bob.works(),[]);
  const next = platform.publish('operator',{...draft,id:course.id,baseVersion:course.versionId,permittedDeliveryModes:['CANVAS'],price:0});
  await alice.purchase(next.id,next.versionId);
  await assert.rejects(alice.start(next.id,next.versionId,'VIBECODING'),/权益/);
  platform.hide('operator',{id:next.id,baseVersion:next.versionId});
  const restored = await alice.start(...args,'CANVAS');assert.deepEqual(restored.work,snapshot);assert.deepEqual(restored.completed,[]);
  assert.equal((await loadCourseDetail(course.id,{baseUrl:base,versionId:course.versionId,fetchImpl:fetchAs('alice')})).price,100);
  await assert.rejects(loadCourseDetail(course.id,{baseUrl:base,versionId:course.versionId,fetchImpl:fetchAs('bob')}),/404/);
  const [receipt] = orders.values(); assert.equal(platform.revoke(receipt.orderId,receipt.transactionId),1);
  await assert.rejects(alice.start(...args,'VIBECODING'),/权益/);
});

test('desktop login binds callback state, verifier and domain to this launch',()=>{
  const flow = oauth.begin({authorizeUrl:'https://www.aicyld.com.cn/auth',apiOrigin:'https://kt.example',clientId:'staging'});
  assert.equal(flow.authorize.searchParams.get('ui'),'kx-class-v1');
  assert.equal(flow.authorize.searchParams.get('code_challenge'),createHash('sha256').update(flow.verifier).digest('base64url'));
  assert.equal(oauth.isCallbackUrl(flow.redirect,flow),true);
  assert.equal(oauth.readCallback(flow.redirect+'?code=test&state='+flow.state,flow),'test');
  assert.throws(()=>oauth.readCallback(flow.redirect+'?code=test&state=wrong',flow));
  assert.equal(oauth.readCallback('https://other.example/?code=test',flow),null);
  assert.throws(()=>workbenchUrl('https://kt.example','https://kt.example','run','a'.repeat(32)));
});

test('workbench requires a separate HTTPS origin and puts the runtime ticket only in the fragment',()=>{
  const parent = 'kuaixue://classroom', ticket = 'sample'.repeat(8);
  for (const origin of [undefined,'','not a URL','http://vibe.example','https://vibe.example/workbench','https://vibe.example?x','https://user@vibe.example']) {
    assert.throws(()=>workbenchUrl(origin,parent,'run-1',ticket),/VITE_KUAIXUE_VIBE_ORIGIN/);
  }
  const url = new URL(workbenchUrl('https://kuaixue-vibe.aicyld.com.cn',parent,'run-1',ticket));
  assert.equal(url.origin + url.pathname + url.search,'https://kuaixue-vibe.aicyld.com.cn/kuaixue/workbench/');
  assert.deepEqual(Object.fromEntries(new URLSearchParams(url.hash.slice(1))),{run:'run-1',ticket});
});

test('legacy offline single-artifact runs migrate on save and recover after restart',t=>{
  const temp=mkdtempSync(join(tmpdir(),'kx-legacy-')),file=join(temp,'store.sqlite');
  let store=workshop.createWorkshop(file);t.after(()=>{store.close();rmSync(temp,{recursive:true,force:true});});
  const course=store.catalog().find(item=>item.permittedDeliveryModes.length===2);
  store.purchase(course.id,course.versionId);
  const run=store.start(course.id,course.versionId,'CANVAS'); store.close();
  const db=new DatabaseSync(file);const snapshot={nodes:[{id:'old'}],edges:[]};
  db.prepare('UPDATE runs SET state=? WHERE id=?').run(JSON.stringify({completed:[],work:snapshot}),run.id);db.close();
  store=workshop.createWorkshop(file);
  const vibe=store.start(course.id,course.versionId,'VIBECODING');assert.equal(vibe.work,null);
  store.save({...vibe,work:'<h1>page</h1>'});
  assert.deepEqual(store.start(course.id,course.versionId,'CANVAS').work,snapshot);
  assert.equal(store.start(course.id,course.versionId,'VIBECODING').work,'<h1>page</h1>');
});

test('Vibe gateway binds one-use tickets to a run and rechecks entitlement before each socket',async t=>{
  const {createRuntimeBroker} = await import('../integrations/vibecoding/runtime-broker.mjs');
  let active = true, clock=1000;
  const broker = createRuntimeBroker({filename:':memory:',now:()=>clock,checkAccess:()=>active,openWorkspace:()=>({path:'/run/project'})});
  t.after(()=>broker.close());
  const context={userId:'alice',runId:'run1',versionId:'v1',courseId:'c1',mode:'VIBECODING'};
  const ticket=await broker.issueRuntimeTicket(context);
  await assert.rejects(broker.exchange({runId:'wrong',ticket}));
  const {socketId}=await broker.exchange({runId:'run1',ticket});
  await assert.rejects(broker.exchange({runId:'run1',ticket}));
  assert.deepEqual(await broker.claimSocket(socketId),context);
  await assert.rejects(broker.claimSocket(socketId));
  const expired=await broker.issueRuntimeTicket(context);clock+=60001;
  await assert.rejects(broker.exchange({runId:'run1',ticket:expired}));
  const revoked=await broker.issueRuntimeTicket(context);active=false;
  await assert.rejects(broker.exchange({runId:'run1',ticket:revoked}));
});

test('quoted generation uses course model, recovers uncertain settlement on the original job and rejects other users',async t=>{
  const settled = new Set(); let dropped=true;
  const p=openCoursePlatform(':memory:',{
    quoteGeneration:async job=>{assert.equal(job.modelId,'course-model');return {quoteId:'quote',points:5,expiresAt:Date.now()+60000};},
    generateOrLookup:async job=>{settled.add(job.jobId);if (dropped){dropped=false;throw Error('timeout');}return {jobId:job.jobId,status:'settled',transactionId:'tx',asset:{text:'作品'}};},
  });t.after(()=>p.close());
  const course=p.publish('op',{...draft,price:0,modelPolicy:[{modality:'TEXT',modelId:'course-model'}]});
  const target={courseId:course.id,versionId:course.versionId};
  await p.purchase('learner',target);const run=await p.start('learner',{...target,mode:'CANVAS'});
  const node={id:run.id,nodeId:'scene',modality:'TEXT',input:{prompt:'分镜',modelId:'untrusted'}};
  await assert.rejects(p.quote('learner',{...node,modality:'VIDEO'}),/未开放/);
  const preview=await p.quote('learner',{...node,preview:true});
  assert.deepEqual({id:preview.id,preview:preview.preview,points:preview.points},{id:null,preview:true,points:5});
  const offer=await p.quote('learner',node);assert.equal(offer.points,5);assert.equal(settled.size,0);
  const request={id:run.id,jobId:offer.id};await assert.rejects(p.generate('other',request));
  await assert.rejects(p.generate('learner',request),error=>error.status===502&&error.message==='timeout');
  assert.equal((await p.quote('learner',node)).id,offer.id);
  assert.deepEqual(await p.generate('learner',request),{text:'作品'});
  assert.deepEqual(await p.generate('learner',request),{text:'作品'});assert.equal(settled.size,1);
});

test('desktop session exchange sets a secure cookie and signs out through the identity provider',async t=>{
 const redirectUri='https://kt.example/kuaixue/desktop/callback',clientId='kuaixue',token='x'.repeat(40),revoked=[];
 const server=createApiServer({allowedOrigins:['kuaixue://classroom'],desktopAuth:{redirectUri,clientId,exchange:async()=>token,revokeSession:async session=>revoked.push(session)}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const post=(route,body)=>fetch(`http://127.0.0.1:${server.address().port}/api/v1/desktop/`+route,{method:'POST',headers:{Origin:'kuaixue://classroom','Content-Type':'application/json',Cookie:'kuaixue_session='+token},body:JSON.stringify(body)});
 const payload={code:'code',verifier:'v'.repeat(48),clientId,redirectUri};
 assert.equal((await post('session',{...payload,redirectUri:'https://other.example'})).status,400);
 const started=await post('session',payload);assert.match(started.headers.get('set-cookie'),/HttpOnly; Secure/);assert.deepEqual((await started.json()).data,{authenticated:true});
 const closed=await post('logout',{});assert.match(closed.headers.get('set-cookie'),/Max-Age=0/);assert.deepEqual(revoked,[token]);
});

test('course actions pass the authenticated session into the runtime model host',async t=>{
  let receivedSession='';
  const server=createApiServer({
    allowedOrigins:['kuaixue://classroom'],
    identity:session=>session==='session-token'?{userId:'learner',mainSiteToken:'main-token'}:null,
    platform:{start:async(user,body,session)=>{receivedSession=session;return {id:'run-1',user,body};}},
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const response=await fetch(`http://127.0.0.1:${server.address().port}/api/v1/course-runs/open`,{
    method:'POST',
    headers:{'Content-Type':'application/json',Origin:'kuaixue://classroom',Cookie:'kuaixue_session=session-token'},
    body:JSON.stringify({courseId:'course',versionId:'version',mode:'VIBECODING'}),
  });
  assert.equal(response.status,200);
  assert.equal(receivedSession,'session-token');
});


test('Vibe host only writes provider credentials for the current entitled course version',async t => {
  const {provisionCourseProvider} = await import('../integrations/vibecoding/course-provider.mjs');
  const {readFile} = await import('node:fs/promises');
  const profile = mkdtempSync(join(tmpdir(),'kx-course-provider-'));
  t.after(() => rmSync(profile,{recursive:true,force:true}));
  const context = {userId:'user',runId:'run',versionId:'v1',courseId:'course',mode:'VIBECODING'};
  const gateway = {...context,modelIds:['course-model','extra'],baseUrl:'https://gateway.example/v1',token:'lease-token',expiresAt:Date.now()+60000};
  const platform = {hasRuntimeAccess:async () => false,detail:async () => ({vibeModelIds:['course-model']})};
  const options = {context,profile,gateway,platform};
  await assert.rejects(provisionCourseProvider(options),/失效/);
  platform.hasRuntimeAccess = async () => true;
  await assert.rejects(provisionCourseProvider({...options,gateway:{...gateway,versionId:'v2'}}),/未就绪/);
  await provisionCourseProvider(options);
  const {config} = JSON.parse(await readFile(join(profile,'.zcode','v2','provider_config.json'),'utf8'));
  assert.deepEqual(config.providerConfigRules.providerRules[0].config.personalModelIds,['course-model']);
});

test('a closed production sale is distinguishable from an unconfirmed order', async () => {
  const clientFor = code => createCourseClient({
    base: 'https://example.invalid',
    fetchImpl: async () => Response.json({error:{code}}, {status:423}),
    account: () => assert.fail('a rejected purchase should not refresh the account'),
  });
  await assert.rejects(clientFor('PURCHASES_DISABLED').purchase('course','version'), /正式购课暂未开放/);
  await assert.rejects(clientFor('OTHER_LOCK').purchase('course','version'), /请求未确认/);
});

test('service errors preserve the actionable backend message', async () => {
  const client=createCourseClient({
    base:'https://example.invalid',
    fetchImpl:async()=>Response.json({error:{message:'模型计费服务待接入'}},{status:503}),
    account:()=>assert.fail('account should not load'),
  });
  await assert.rejects(client.quote({}),/模型计费服务待接入/);
});
