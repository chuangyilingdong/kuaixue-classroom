import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {openCoursePlatform} from '../apps/api/course-platform.mjs';
import {createApiServer as defaultApi} from '../apps/api/server.mjs';
import {createRuntimeBroker} from '../integrations/vibecoding/runtime-broker.mjs';
import {openTicketedCoursePlatform} from '../integrations/vibecoding/main-site-tickets.mjs';

// An operator can also run this contract against the main site's own course implementation.
const openPlatform = process.env.KX_CONTRACT_PLATFORM_FILE
  ? (await import(pathToFileURL(process.env.KX_CONTRACT_PLATFORM_FILE))).openCoursePlatform
  : openCoursePlatform;
const createApiServer = process.env.KX_CONTRACT_PLATFORM_FILE
  ? (await import(new URL('server.mjs', pathToFileURL(process.env.KX_CONTRACT_PLATFORM_FILE)))).createApiServer
  : defaultApi;

test('main-site course open signs a ticket redeemable by a separate runtime connection', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'kx-tickets-'));
  const ticketFile = join(dir, 'tickets.sqlite');
  const courseFile = join(dir, 'courses.sqlite');
  const platform = openTicketedCoursePlatform(openPlatform, courseFile, {}, ticketFile);
  const runtime = createRuntimeBroker({
    filename: ticketFile, checkAccess: platform.hasRuntimeAccess,
    openWorkspace: () => ({path:'/course/project', identity:'course-run',
      presets:[],modelLabels:{'model-a':'课程模型 A'}}),
  });
  const server = createApiServer({platform, identity: userId => ({userId}), allowedOrigins:['kuaixue://classroom']});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    runtime.close();
    platform.close();
    rmSync(dir, {recursive:true, force:true});
  });
  const course = platform.publish('operator', {title:'双工作区', subtitle:'课程工程', price:0,
    permittedDeliveryModes:['CANVAS','VIBECODING'], steps:[{id:'plan',title:'计划',description:'绘制分镜',deliverable:'故事板'}]});
  const version = {courseId:course.id, versionId:course.versionId};
  const open = async (userId, mode) => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/course-runs/open`, {
      method:'POST', headers:{'Content-Type':'application/json', Origin:'kuaixue://classroom', Cookie:`kuaixue_session=${userId}`},
      body:JSON.stringify({...version, mode}),
    });
    return {status:res.status, data:(await res.json()).data};
  };
  const purchase = await platform.purchase('buyer', version);
  const canvas = await open('buyer', 'CANVAS');
  assert.equal(canvas.status, 200);
  assert.equal(canvas.data.runtimeTicket, undefined);
  assert.equal((await open('other', 'VIBECODING')).status, 403);
  const vibe = await open('buyer', 'VIBECODING');
  assert.equal(vibe.status, 200);
  const launch = {runId:vibe.data.id, ticket:vibe.data.runtimeTicket};
  const exchanged = await runtime.exchange(launch);
  assert.equal(exchanged.runId, launch.runId);
  assert.equal(exchanged.workspacePath, '/course/project');
  assert.equal(exchanged.workspaceIdentity, 'course-run');
  assert.deepEqual(exchanged.modelLabels, {'model-a':'课程模型 A'});
  assert.match(exchanged.previewToken,/^[a-zA-Z0-9_-]{43}$/);
  assert.deepEqual(await runtime.claimPreview(exchanged.previewToken), {...version, userId:'buyer', runId:launch.runId, mode:'VIBECODING'});
  assert.deepEqual(await runtime.claimPreview(exchanged.previewToken), {...version, userId:'buyer', runId:launch.runId, mode:'VIBECODING'});
  await assert.rejects(runtime.exchange(launch));
  assert.deepEqual(await runtime.claimSocket(exchanged.socketId), {...version, userId:'buyer', runId:launch.runId, mode:'VIBECODING'});
  await assert.rejects(runtime.claimSocket(exchanged.socketId));
  const second = (await open('buyer', 'VIBECODING')).data;
  assert.equal(second.id, launch.runId);
  assert.notEqual(second.runtimeTicket, launch.ticket);
  assert.equal(platform.revoke(purchase.orderId, `free-${purchase.orderId}`), 1);
  await assert.rejects(runtime.exchange({runId:second.id, ticket:second.runtimeTicket}));
  await assert.rejects(runtime.claimPreview(exchanged.previewToken));
});

test('unset ticket store still permits local-first Vibe runs and configured paths must be separate', async t => {
  const platform = openTicketedCoursePlatform(openPlatform, ':memory:', {}, '');
  t.after(() => platform.close());
  const course = platform.publish('operator', {title:'创作', subtitle:'课程工程', price:0, permittedDeliveryModes:['VIBECODING'],
    steps:[{id:'plan', title:'计划', description:'绘制分镜', deliverable:'故事板'}]});
  const version = {courseId:course.id, versionId:course.versionId};
  await platform.purchase('buyer', version);
  const localFirst=await platform.start('buyer', {...version, mode:'VIBECODING'});
  assert.equal(localFirst.runtimeTicket,undefined);
  const file = join(tmpdir(), 'example.sqlite');
  for (const invalid of [file, 'relative.sqlite']) {
    assert.throws(() => openTicketedCoursePlatform(openPlatform, file, {}, invalid), /绝对路径/);
  }
});

test('本机运行只领取当前已购版本的短期模型授权', async t => {
  const dir=mkdtempSync(join(tmpdir(),'kx-local-runtime-'));
  const platform=openCoursePlatform(join(dir,'course.sqlite'),{
    issueRuntimeTicket:()=> 'r'.repeat(43),
    issueLocalModelGrant:context=>({baseUrl:'https://model.aicyld.com.cn/v1',token:'local-grant',
      modelIds:['model-a'],expiresAt:Date.now()+60000,context}),
  });
  t.after(()=>{platform.close();rmSync(dir,{recursive:true,force:true});});
  const course=platform.publish('operator',{title:'本机课',subtitle:'混合运行',price:0,
    permittedDeliveryModes:['VIBECODING'],vibeModelIds:['model-a'],
    classroomConfig:{vibeCoding:{presetPrompts:[{title:'本机预设',text:'本机执行'}]}},
    steps:[{id:'one',title:'创作',description:'写页面',deliverable:'页面'}]});
  const version={courseId:course.id,versionId:course.versionId};
  await platform.purchase('buyer',version);
  const run=await platform.start('buyer',{...version,mode:'VIBECODING'});
  const local=await platform.localRuntime('buyer',{id:run.id});
  assert.equal(local.runId,run.id);
  assert.equal(local.presets[0].text,'本机执行');
  assert.deepEqual(local.modelGateway,{baseUrl:'https://model.aicyld.com.cn/v1',token:'local-grant',
    modelIds:['model-a'],expiresAt:local.modelGateway.expiresAt});
  await assert.rejects(platform.localRuntime('other',{id:run.id}),{status:403});
});

test('旧课程从已发布模型标签推导本机运行模型，不接受任意模型', async t => {
  const dir=mkdtempSync(join(tmpdir(),'kx-local-legacy-model-'));
  let requested=null;
  const modelId='aicyld-runninghub-llm-cn::deepseek/deepseek-v4.1-flash';
  const platform=openCoursePlatform(join(dir,'course.sqlite'),{
    issueRuntimeTicket:()=> 'r'.repeat(43),
    issueLocalModelGrant:context=>{requested=context;return{baseUrl:'https://model.aicyld.com.cn/v1',
      token:'local-grant',modelIds:context.modelIds,expiresAt:Date.now()+60000};},
  });
  t.after(()=>{platform.close();rmSync(dir,{recursive:true,force:true});});
  const course=platform.publish('operator',{title:'旧版课程',subtitle:'兼容',price:0,
    permittedDeliveryModes:['VIBECODING'],modelLabels:[modelId,'gpt-image-2.5/flare/text-to-image/stable-token'],
    steps:[{id:'one',title:'创作',description:'执行',deliverable:'作品'}]});
  const version={courseId:course.id,versionId:course.versionId};
  await platform.purchase('buyer',version);
  const run=await platform.start('buyer',{...version,mode:'VIBECODING'});
  await platform.localRuntime('buyer',{id:run.id});
  assert.deepEqual(requested.modelIds,[modelId]);
});
