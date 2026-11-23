import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {openCoursePlatform} from '../apps/api/course-platform.mjs';
import {createApiServer} from '../apps/api/server.mjs';
import {createMainSiteRuntimeAdapter} from '../apps/api/main-site-runtime.mjs';
import {createSnapshotZip} from '../shared/local-snapshot.mjs';

function listen(server){
  server.listen(0,'127.0.0.1');
  return once(server,'listening').then(()=>`http://127.0.0.1:${server.address().port}`);
}

async function body(req){
  const chunks=[];
  for await(const chunk of req)chunks.push(chunk);
  return Buffer.concat(chunks);
}

test('课程服务校验权益后调用主站模型授权和快照内部接口',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'kx-runtime-cooperation-'));
  let snapshot=null,grantRequest=null,grantModelIds=null;
  const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
  const internal=createServer(async(req,res)=>{
    if(req.headers['x-kuaixue-internal-secret']!=='fixture-internal-secret')return res.writeHead(403).end();
    if(req.method==='POST'&&req.url==='/internal/kuaixue/runtime-grant'){
      grantRequest=JSON.parse((await body(req)).toString('utf8'));
      res.writeHead(200,{'Content-Type':'application/json'});
      return res.end(JSON.stringify({data:{baseUrl:'https://aicyld.com.cn/api/kuaixue-runtime/v1',
        token:'short-lived-course-token',modelIds:grantModelIds||grantRequest.modelIds,expiresAt:Date.now()+60000}}));
    }
    if(req.method==='POST'&&req.url==='/internal/kuaixue/snapshots'){
      const bytes=await body(req);
      const sha256=req.headers['x-kuaixue-snapshot-sha256'];
      const baseRevision=Number(req.headers['x-kuaixue-base-revision']);
      if(digest(bytes)!==sha256)return res.writeHead(400,{'Content-Type':'application/json'})
        .end(JSON.stringify({error:{code:'SNAPSHOT_HASH_MISMATCH'}}));
      if(snapshot&&snapshot.record.sha256===sha256){
        res.writeHead(200,{'Content-Type':'application/json'});
        return res.end(JSON.stringify({data:{...snapshot.record}}));
      }
      if(snapshot&&snapshot.record.revision!==baseRevision){
        res.writeHead(409,{'Content-Type':'application/json'});
        return res.end(JSON.stringify({error:{code:'SNAPSHOT_CONFLICT',message:'快照版本已变化，请先下载最新快照'},
          currentRevision:snapshot.record.revision}));
      }
      const record={runId:String(req.headers['x-kuaixue-run-id']),revision:(snapshot?.record.revision||0)+1,
        sha256,bytes:bytes.length,capturedAt:new Date().toISOString()};
      snapshot={bytes,record};res.writeHead(200,{'Content-Type':'application/json'});
      return res.end(JSON.stringify({data:record}));
    }
    if(req.method==='GET'&&req.url?.startsWith('/internal/kuaixue/snapshots?')){
      if(!snapshot)return res.writeHead(404,{'Content-Type':'application/json'}).end(JSON.stringify({error:{code:'SNAPSHOT_NOT_FOUND'}}));
      res.writeHead(200,{'Content-Type':'application/zip',ETag:`"${snapshot.record.sha256}"`,
        'X-Kuaixue-Revision':String(snapshot.record.revision),'X-Kuaixue-Snapshot-SHA256':snapshot.record.sha256,
        'X-Kuaixue-Captured-At':snapshot.record.capturedAt});
      return res.end(snapshot.bytes);
    }
    res.writeHead(404).end();
  });
  const internalOrigin=await listen(internal);
  const adapter=createMainSiteRuntimeAdapter({origin:internalOrigin,secret:'fixture-internal-secret'});
  const platform=openCoursePlatform(join(dir,'courses.sqlite'),{
    issueRuntimeTicket:()=> 'r'.repeat(43),
    issueLocalModelGrant:adapter.issueLocalModelGrant,
    uploadLocalSnapshot:adapter.uploadLocalSnapshot,
    downloadLocalSnapshot:adapter.downloadLocalSnapshot,
  });
  const api=createApiServer({platform,identity:session=>({userId:session}),allowedOrigins:['kuaixue://classroom']});
  const apiOrigin=await listen(api);
  t.after(async()=>{
    await new Promise(resolve=>api.close(resolve));
    await new Promise(resolve=>internal.close(resolve));
    platform.close();rmSync(dir,{recursive:true,force:true});
  });
  const modelId='aicyld-runninghub-llm-cn::glm/glm-5.3-flash';
  const course=platform.publish('operator',{title:'本机接口',subtitle:'混合运行',price:0,
    permittedDeliveryModes:['VIBECODING'],vibeModelIds:[modelId],
    classroomConfig:{vibeCoding:{presetPrompts:[{title:'页面',text:'制作网页'}],usageLimit:5}},
    steps:[{id:'one',title:'页面',description:'制作页面',deliverable:'index.html'}]});
  const version={courseId:course.id,versionId:course.versionId};
  await platform.purchase('buyer',version);
  const headers={Origin:'kuaixue://classroom',Cookie:'kuaixue_session=buyer','Content-Type':'application/json'};
  const opened=await fetch(`${apiOrigin}/api/v1/course-runs/open`,{method:'POST',headers,
    body:JSON.stringify({...version,mode:'VIBECODING'})});
  assert.equal(opened.status,200);
  const run=(await opened.json()).data;

  const granted=await fetch(`${apiOrigin}/api/v1/course-runs/local-runtime`,{method:'POST',headers,
    body:JSON.stringify({id:run.id})});
  assert.equal(granted.status,200);
  assert.deepEqual((await granted.json()).data.modelGateway.modelIds,[modelId]);
  assert.deepEqual(grantRequest,{userId:'buyer',courseId:course.id,versionId:course.versionId,runId:run.id,
    mode:'VIBECODING',modelIds:[modelId],usageLimit:5});
  grantModelIds=['aicyld-runninghub-llm-cn::unlisted-model'];
  const badGrant=await fetch(`${apiOrigin}/api/v1/course-runs/local-runtime`,{method:'POST',headers,
    body:JSON.stringify({id:run.id})});
  assert.equal(badGrant.status,503);

  const workspace=join(dir,'workspace');mkdirSync(join(workspace,'src'),{recursive:true});
  writeFileSync(join(workspace,'index.html'),'<!doctype html><h1>快照</h1>');
  writeFileSync(join(workspace,'src','app.js'),'document.body.dataset.ready="1";');
  const archive=await createSnapshotZip(workspace);
  const upload=()=>fetch(`${apiOrigin}/api/v1/course-runs/local-snapshot`,{
    method:'POST',headers:{...headers,'Content-Type':'application/zip','X-Kuaixue-Run-Id':run.id,
      'X-Kuaixue-Base-Revision':'0','X-Kuaixue-Snapshot-SHA256':archive.sha256},
    body:archive.bytes,
  });
  const uploaded=await upload();
  assert.equal(uploaded.status,200);
  const uploadData=(await uploaded.json()).data;
  assert.equal(uploadData.revision,1);
  const replayed=await upload();
  assert.equal(replayed.status,200);
  assert.equal((await replayed.json()).data.revision,1);

  writeFileSync(join(workspace,'index.html'),'<!doctype html><h1>快照 2</h1>');
  const changed=await createSnapshotZip(workspace);
  const conflict=await fetch(`${apiOrigin}/api/v1/course-runs/local-snapshot`,{
    method:'POST',headers:{...headers,'Content-Type':'application/zip','X-Kuaixue-Run-Id':run.id,
      'X-Kuaixue-Base-Revision':'0','X-Kuaixue-Snapshot-SHA256':changed.sha256},
    body:changed.bytes,
  });
  assert.equal(conflict.status,409);
  assert.equal((await conflict.json()).currentRevision,1);

  const download=await fetch(`${apiOrigin}/api/v1/course-runs/local-snapshot?runId=${run.id}`,{headers});
  assert.equal(download.status,200);
  assert.equal(download.headers.get('x-kuaixue-revision'),'1');
  assert.equal(download.headers.get('x-kuaixue-snapshot-sha256'),archive.sha256);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()),archive.bytes);

  const forbidden=await fetch(`${apiOrigin}/api/v1/course-runs/local-snapshot?runId=${run.id}`,{
    headers:{...headers,Cookie:'kuaixue_session=other'},
  });
  assert.equal(forbidden.status,403);
});
