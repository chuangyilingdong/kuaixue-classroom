import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createCourseClient} from '../src/services/courseClient.js';

const origin='https://classroom.example.test';

test('课程客户端上传和下载整目录 ZIP 并校验摘要与版本',async()=>{
  const bytes=new Uint8Array(Buffer.from('PK\u0003\u0004fixture'));
  const sha256=createHash('sha256').update(bytes).digest('hex');
  const calls=[];
  const fetchImpl=async(url,options)=>{
    calls.push({url:String(url),options});
    if(options?.method==='POST'){
      return new Response(JSON.stringify({data:{runId:'run-12345678',revision:2,sha256,bytes:bytes.length,
        capturedAt:'2026-11-23T12:00:00.000Z'}}),{status:200,headers:{'Content-Type':'application/json'}});
    }
    return new Response(bytes,{status:200,headers:{'Content-Type':'application/zip','X-Kuaixue-Revision':'2',
      'X-Kuaixue-Snapshot-SHA256':sha256,'X-Kuaixue-Captured-At':'2026-11-23T12:00:00.000Z',ETag:`"${sha256}"`}});
  };
  const client=createCourseClient({base:origin,vibeOrigin:origin,parentOrigin:origin,fetchImpl});
  const uploaded=await client.uploadSnapshot({runId:'run-12345678',baseRevision:1,bytes});
  assert.equal(uploaded.revision,2);
  assert.equal(calls[0].url,`${origin}/api/v1/course-runs/local-snapshot`);
  assert.equal(calls[0].options.headers['X-Kuaixue-Base-Revision'],'1');
  assert.equal(calls[0].options.headers['X-Kuaixue-Snapshot-SHA256'],sha256);
  const downloaded=await client.downloadSnapshot('run-12345678');
  assert.deepEqual(Buffer.from(downloaded.bytes),Buffer.from(bytes));
  assert.equal(downloaded.revision,2);
  assert.equal(downloaded.sha256,sha256);
});

test('课程客户端保留快照冲突的 currentRevision',async()=>{
  const bytes=new Uint8Array([1,2,3]);
  const fetchImpl=async()=>new Response(JSON.stringify({
    error:{code:'SNAPSHOT_CONFLICT',message:'快照版本已变化，请先下载最新快照'},currentRevision:4,
  }),{status:409,headers:{'Content-Type':'application/json'}});
  const client=createCourseClient({base:origin,vibeOrigin:origin,parentOrigin:origin,fetchImpl});
  await assert.rejects(client.uploadSnapshot({runId:'run-12345678',baseRevision:3,bytes}),error=>{
    assert.equal(error.status,409);
    assert.equal(error.code,'SNAPSHOT_CONFLICT');
    assert.equal(error.currentRevision,4);
    return true;
  });
});
