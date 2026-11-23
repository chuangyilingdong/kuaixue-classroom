import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanvasGenerationAdapter} from '../apps/api/canvas-generation.mjs';

test('画布生成经主站报价预扣、RunningHub 执行后结算作品',async()=>{
  const calls=[];
  let queried=false;
  const fetchImpl=async(url,options)=>{
    const href=String(url);
    calls.push({href,body:JSON.parse(options.body||'{}'),headers:options.headers});
    if(href.endsWith('/internal/canvas-billing/quote'))return Response.json({points:3,balance:100});
    if(href.endsWith('/internal/canvas-billing/reserve'))return Response.json({holdId:'hold-1',points:3,status:'reserved'});
    if(href.endsWith('/internal/canvas-billing/settle'))return Response.json({status:'succeeded'});
    if(href.endsWith('/rhart-image-g-2.5-official-token/flare/text-to-image')){
      return Response.json({code:0,data:{taskId:'task-1',status:'QUEUED'}});
    }
    if(href.endsWith('/openapi/v2/query')){
      queried=true;
      return Response.json({code:0,data:{taskId:'task-1',status:'SUCCESS',
        results:[{fileUrl:'https://cdn.example/result.png'}],usage:{consumeMoney:'0.2'}}});
    }
    throw Error(`unexpected request ${href}`);
  };
  const adapter=createCanvasGenerationAdapter({
    origin:'https://course.example.test',billingSecret:'billing-secret',
    runningHubApiKey:'rh-key',fetchImpl,pollIntervalMs:0,
  });
  const job={jobId:'job-1',userId:'user-1',runId:'run-1',
    modelId:'aicyld-runninghub-ai-media::rh-gpt-image-2.5-flare-t2i',
    modelLabel:'gpt-image-2.5/flare/text-to-image/stable-token',
    modality:'IMAGE',input:{prompt:'一只兔子',params:{aspectRatio:'1:1'}}};
  const quote=await adapter.quoteGeneration(job);
  assert.equal(quote.points,3);
  const result=await adapter.generateOrLookup(job);
  assert.equal(queried,true);
  assert.equal(result.status,'settled');
  assert.equal(result.transactionId,'hold-1');
  assert.equal(result.asset.assetUrl,'https://cdn.example/result.png');
  assert.equal(calls.find(call=>call.href.includes('/reserve')).body.facts.modelKey,
    'rhart-image-g-2.5-official-token/flare/text-to-image');
  assert.equal(calls.find(call=>call.href.endsWith('/text-to-image')).headers.Authorization,'Bearer rh-key');
});

test('RunningHub 失败时释放画布预扣',async()=>{
  const calls=[];
  const fetchImpl=async(url,options)=>{
    const href=String(url);calls.push(href);
    if(href.endsWith('/reserve'))return Response.json({holdId:'hold-fail',points:2,status:'reserved'});
    if(href.includes('/text-to-image'))return Response.json({code:0,data:{taskId:'task-fail',status:'FAILED',
      errorMessage:'模型执行失败'}});
    if(href.endsWith('/release'))return Response.json({status:'released'});
    throw Error(`unexpected request ${href}`);
  };
  const adapter=createCanvasGenerationAdapter({
    origin:'https://course.example.test',billingSecret:'billing-secret',
    runningHubApiKey:'rh-key',fetchImpl,pollIntervalMs:0,
  });
  await assert.rejects(adapter.generateOrLookup({jobId:'job-fail',userId:'user-1',runId:'run-1',
    modelId:'gpt-image-2.5/flare/text-to-image/stable-token',modality:'IMAGE',input:{prompt:'test'}}),
  /模型执行失败/);
  assert.ok(calls.some(href=>href.endsWith('/release')));
});
