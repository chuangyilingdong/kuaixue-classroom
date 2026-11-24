import test from 'node:test';
import assert from 'node:assert/strict';
import {createMainSiteModelGateway} from '../apps/api/main-site-model-gateway.mjs';

test('课程对话经主站内部授权后调用计数网关',async()=>{
  const calls=[];
  const fetchImpl=async(url,options)=>{
    calls.push({url:String(url),options});
    if(calls.length===1)return new Response(JSON.stringify({data:{
      token:'short-lived-grant',
      baseUrl:'https://public.example/api/kuaixue-runtime/v1',
    }}),{status:200,headers:{'Content-Type':'application/json'}});
    return new Response(JSON.stringify({choices:[{message:{content:'ok'}}]}),{
      status:200,
      headers:{
        'Content-Type':'application/json',
        'X-Kuaixue-Usage-Limit':'10',
        'X-Kuaixue-Usage-Used':'4',
        'X-Kuaixue-Usage-Remaining':'6',
      },
    });
  };
  const gateway=createMainSiteModelGateway({
    mainSiteOrigin:'http://127.0.0.1:3001',
    internalSecret:'internal-secret',
    fetchImpl,
  });
  const context={userId:'learner',courseId:'course',versionId:'v1',runId:'run',mode:'VIBECODING',
    modelIds:['provider::model'],usageLimit:10};
  const response=await gateway.chat(context,{model:'provider::model',messages:[]});

  assert.equal(calls[0].url,'http://127.0.0.1:3001/internal/kuaixue/runtime-grant');
  assert.equal(calls[0].options.headers['x-kuaixue-internal-secret'],'internal-secret');
  assert.deepEqual(JSON.parse(calls[0].options.body),context);
  assert.equal(calls[1].url,'http://127.0.0.1:3001/api/kuaixue-runtime/v1/chat/completions');
  assert.equal(calls[1].options.headers.Authorization,'Bearer short-lived-grant');
  assert.equal(response.headers.get('x-kuaixue-usage-used'),'4');
});

test('主站授予以外的网关路径会失败关闭',async()=>{
  const gateway=createMainSiteModelGateway({
    mainSiteOrigin:'http://127.0.0.1:3001',
    internalSecret:'internal-secret',
    fetchImpl:async()=>new Response(JSON.stringify({data:{
      token:'short-lived-grant',
      baseUrl:'https://public.example/api/other/v1',
    }}),{status:200,headers:{'Content-Type':'application/json'}}),
  });
  await assert.rejects(
    gateway.issue({userId:'learner',courseId:'course',versionId:'v1',runId:'run',mode:'VIBECODING',
      modelIds:['provider::model'],usageLimit:10}),
    error=>error.status===503&&/网关地址无效/.test(error.message),
  );
});
