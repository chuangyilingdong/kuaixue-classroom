import test from 'node:test';
import assert from 'node:assert/strict';
import {createCourseClient} from '../src/services/courseClient.js';

test('画布长请求断开后继续轮询服务端并恢复已完成作品',async()=>{
  let statusChecks=0;
  const fetchImpl=async (url)=>{
    const href=String(url);
    if(href.endsWith('/api/v1/generations/confirm')){
      await new Promise(resolve=>setTimeout(resolve,5));
      throw Error('network lost');
    }
    if(href.endsWith('/api/v1/generations/status')){
      statusChecks++;
      return Response.json({data:statusChecks===1
        ?{jobId:'job-1',status:'SUBMITTED',asset:null}
        :{jobId:'job-1',status:'COMPLETE',asset:{
          assetUrl:'https://cdn.example/result.mp4',previewUrl:'https://cdn.example/result.mp4',
        }}});
    }
    throw Error(`unexpected request ${href}`);
  };
  const client=createCourseClient({
    base:'https://course.example.test',vibeOrigin:'https://vibe.example.test',
    parentOrigin:'kuaixue://classroom',fetchImpl,
  });
  const asset=await client.generateTracked({id:'run-1',nodeId:'node-1',jobId:'job-1',timeout:5000});
  assert.equal(asset.assetUrl,'https://cdn.example/result.mp4');
  assert.equal(statusChecks,2);
});
