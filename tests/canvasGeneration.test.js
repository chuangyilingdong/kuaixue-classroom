import test from 'node:test';
import assert from 'node:assert/strict';
import {canvasBillingAliases,canvasExecutionAliases,canvasModelRoute,createCanvasGenerationAdapter} from '../apps/api/canvas-generation.mjs';

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

test('MiniMax-H3 使用正式模型键报价并把自动画幅发送为 adaptive',async()=>{
  let quoteFacts;
  const adapter=createCanvasGenerationAdapter({
    origin:'https://course.example.test',billingSecret:'billing-secret',runningHubApiKey:'rh-key',fetchImpl:async(url,options)=>{
      assert.ok(String(url).endsWith('/internal/canvas-billing/quote'));
      quoteFacts=JSON.parse(options.body).facts;
      return Response.json({points:4,balance:100});
    },pollIntervalMs:0,
  });
  const quote=await adapter.quoteGeneration({
    jobId:'job-video',userId:'user-1',runId:'run-1',
    modelId:'aicyld-runninghub::rh-minimax-h3-multi',modelLabel:'MiniMax-H3 多模态参考生视频',
    modality:'VIDEO',input:{prompt:'猴子跳起来',params:{aspectRatio:'auto',resolution:'768P',durationSeconds:5}},
  });
  assert.equal(quote.points,4);
  assert.equal(quote.executionModelKey,'rh-minimax-h3-multi');
  assert.equal(quoteFacts.modelKey,'minimax/hailuo-h3/multimodal-to-video');
  assert.equal(quoteFacts.aspectRatio,'adaptive');
  assert.equal(quoteFacts.durationSeconds,5);
  const displayNameCannotRoute=canvasModelRoute({
    modelId:'aicyld-runninghub::rh-minimax-h3-multi',
    modelLabel:'minimax/hailuo-h3/multimodal-to-video',
    modality:'VIDEO',
  });
  assert.equal(displayNameCannotRoute.execution,'rh-minimax-h3-multi');
  assert.equal(displayNameCannotRoute.billingKey,'minimax/hailuo-h3/multimodal-to-video');
});

test('全模态渠道模型都拆分为执行键和正式计费键',()=>{
  assert.ok(Object.keys(canvasBillingAliases).length>=52);
  assert.equal(Object.keys(canvasExecutionAliases).length,10);
  for(const [model,billingKey] of Object.entries(canvasBillingAliases)){
    const route=canvasModelRoute({modelId:`aicyld-runninghub::${model}`,modelLabel:'自定义名称',modality:'IMAGE'});
    assert.equal(route.execution,canvasExecutionAliases[model]||model);
    assert.equal(route.billingKey,billingKey);
  }
  for(const [model,key] of [
    ['deepseek/deepseek-v4.1-flash','deepseek/deepseek-v4.1-flash'],
    ['openai/gpt-6.2-sol-saver','openai/gpt-6.2-sol-saver'],
    ['qwen/qwen3.8-omni-flash','qwen/qwen3.8-omni-flash'],
  ]){
    const route=canvasModelRoute({modelId:`aicyld-runninghub-llm-cn::${model}`,modelLabel:model,modality:'TEXT'});
    assert.equal(route.execution,model);
    assert.equal(route.billingKey,key);
    assert.equal(route.text,true);
  }
});

test('文本模型走 OpenAI 兼容聊天通道而不是 RunningHub 任务接口',async()=>{
  const calls=[];
  const adapter=createCanvasGenerationAdapter({
    origin:'https://course.example.test',billingSecret:'billing-secret',runningHubApiKey:'rh-key',
    fetchImpl:async(url,options)=>{
      const href=String(url);calls.push(href);
      if(href.endsWith('/internal/canvas-billing/reserve'))return Response.json({holdId:'hold-text',points:2,status:'reserved'});
      if(href.endsWith('/internal/canvas-billing/settle'))return Response.json({status:'succeeded'});
      if(href==='https://llm.runninghub.cn/v1/chat/completions')return Response.json({
        choices:[{message:{content:'生成的文字'}}],usage:{prompt_tokens:5,completion_tokens:4},
      });
      throw Error(`unexpected request ${href}`);
    },pollIntervalMs:0,
  });
  const result=await adapter.generateOrLookup({
    jobId:'job-text',userId:'user-1',runId:'run-1',
    modelId:'aicyld-runninghub-llm-cn::deepseek/deepseek-v4.1-flash',modelLabel:'deepseek/deepseek-v4.1-flash',
    modality:'TEXT',input:{prompt:'写一句标题'},
  });
  assert.equal(result.status,'settled');
  assert.equal(result.asset.text,'生成的文字');
  assert.ok(calls.includes('https://llm.runninghub.cn/v1/chat/completions'));
  assert.ok(!calls.some(href=>href.includes('/openapi/v2/')));
});

test('MiniMax-H3 上传课程素材到 RunningHub，且执行体不发送 generateAudio',async()=>{
  const calls=[];
  const fetchImpl=async(url,options)=>{
    const href=String(url);
    const body=options.body instanceof FormData?Object.fromEntries(options.body.entries()):JSON.parse(options.body||'{}');
    calls.push({href,body,headers:options.headers||{}});
    if(href.endsWith('/internal/canvas-billing/quote'))return Response.json({points:42,balance:1000});
    if(href.endsWith('/internal/canvas-billing/reserve'))return Response.json({holdId:'hold-video',status:'reserved'});
    if(href.startsWith('https://course.example.test/api/v1/course-assets/')){
      return new Response(new Uint8Array([137,80,78,71]),{headers:{'Content-Type':'image/png','Content-Length':'4'}});
    }
    if(href.endsWith('/openapi/v2/media/upload/binary')){
      return Response.json({code:0,data:{download_url:'https://rh.example/uploaded-course-asset.png'}});
    }
    if(href.endsWith('/openapi/v2/rh-minimax-h3-multi'))return Response.json({code:0,data:{taskId:'task-video',status:'QUEUED'}});
    if(href.endsWith('/openapi/v2/query'))return Response.json({code:0,data:{taskId:'task-video',status:'SUCCESS',
      results:[{videoUrl:'https://cdn.example/video.mp4'}]}});
    if(href.endsWith('/internal/canvas-billing/settle'))return Response.json({status:'succeeded'});
    throw Error(`unexpected request ${href}`);
  };
  const adapter=createCanvasGenerationAdapter({
    origin:'https://course.example.test',billingSecret:'billing-secret',runningHubApiKey:'rh-key',
    publicOrigin:'https://aicyld.com.cn',assetSigningSecret:'course-asset-test-secret',
    courseAssetOrigin:'https://course.example.test',
    fetchImpl,pollIntervalMs:0,
  });
  const job={jobId:'job-video-refs',userId:'user-1',runId:'run-1',
    modelId:'aicyld-runninghub::rh-minimax-h3-multi',
    modelLabel:'MiniMax-H3 多模态参考生视频',modality:'VIDEO',
    input:{prompt:'猴子跳起来',params:{aspectRatio:'16:9',resolution:'768P',durationSeconds:5},
      referenceAssets:[
        {type:'IMAGE',url:'https://cdn.example/reference.png'},
        {type:'IMAGE',url:'https://aicyld.com.cn/api/v1/course-assets/11111111-2222-3333-4444-555555555555'},
      ]}};
  const quote=await adapter.quoteGeneration(job);
  assert.equal(quote.points,42);
  await adapter.generateOrLookup(job);
  const execute=calls.find(call=>call.href.endsWith('/openapi/v2/rh-minimax-h3-multi'));
  assert.deepEqual(execute.body.imageUrls.slice(0,1),['https://cdn.example/reference.png']);
  assert.deepEqual(execute.body.imageUrls.slice(1),['https://rh.example/uploaded-course-asset.png']);
  assert.equal(execute.body.ratio,'16:9');
  assert.equal(execute.body.duration,'5');
  assert.equal('generateAudio' in execute.body,false);
  assert.equal(execute.body.aspectRatio,undefined);
  assert.equal(execute.body.durationSeconds,undefined);
  assert.equal(execute.body.audioRole,undefined);
  assert.equal(execute.body.inputMode,undefined);
  const upload=calls.find(call=>call.href.endsWith('/openapi/v2/media/upload/binary'));
  assert.equal(upload.headers.Authorization,'Bearer rh-key');
  assert.ok(upload.body.file?.name?.endsWith('.png'));
  const internal=calls.find(call=>call.href.startsWith('https://course.example.test/api/v1/course-assets/'));
  const signed=new URL(internal.href);
  assert.equal(signed.origin,'https://course.example.test');
  assert.match(signed.searchParams.get('signature')||'',/^[a-zA-Z0-9_-]{43}$/);
  assert.ok(Number(signed.searchParams.get('expires'))>Math.floor(Date.now()/1000));
});

test('课程素材无法镜像时中止 H3、释放预扣且不提交生成任务',async()=>{
  const calls=[];
  const adapter=createCanvasGenerationAdapter({
    origin:'https://course.example.test',billingSecret:'billing-secret',runningHubApiKey:'rh-key',
    publicOrigin:'https://aicyld.com.cn',assetSigningSecret:'course-asset-test-secret',
    courseAssetOrigin:'https://course.example.test',
    fetchImpl:async(url,options)=>{
      const href=String(url);calls.push(href);
      if(href.endsWith('/internal/canvas-billing/reserve'))return Response.json({holdId:'hold-mirror-fail',status:'reserved'});
      if(href.startsWith('https://course.example.test/api/v1/course-assets/'))return new Response('',{status:500});
      if(href.endsWith('/internal/canvas-billing/release'))return Response.json({status:'released'});
      throw Error(`unexpected request ${href}`);
    },pollIntervalMs:0,
  });
  await assert.rejects(adapter.generateOrLookup({
    jobId:'job-mirror-fail',userId:'user-1',runId:'run-1',
    modelId:'aicyld-runninghub::rh-minimax-h3-multi',modality:'VIDEO',
    input:{prompt:'猴子跳起来',params:{aspectRatio:'16:9',resolution:'768P',durationSeconds:5},
      referenceAssets:[{type:'IMAGE',url:'https://aicyld.com.cn/api/v1/course-assets/11111111-2222-3333-4444-555555555555'}]},
  }),/读取课程素材失败/);
  assert.ok(calls.some(href=>href.endsWith('/internal/canvas-billing/release')));
  assert.ok(!calls.some(href=>href.endsWith('/rh-minimax-h3-multi')));
});
