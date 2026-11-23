const AI_MEDIA_MODELS=new Set([
  'rhart-image-g-2.6-official-token/sunburst/edit',
  'rhart-image-g-2.6-official-token/flare/edit',
  'rhart-image-g-2.6-official-token/sunburst/text-to-image',
  'rhart-image-g-2.6-official-token/flare/text-to-image',
  'rhart-image-g-2.5-official-token/sunburst/edit',
  'rhart-image-g-2.5-official-token/flare/edit',
  'rhart-image-g-2.5-official-token/sunburst/text-to-image',
  'rhart-image-g-2.5-official-token/flare/text-to-image',
  'rhart-image-n-nb21-official/image-to-image',
  'rhart-image-n-nb21-official/text-to-image',
  'rhart-image-n-nb2-official/image-to-image',
  'rhart-image-n-nb2-official/text-to-image',
  'mureka-ai/mureka-v9/generate-bgm',
  'mureka-ai/mureka-v9/generate-song',
  'meta/muse-video/economy',
  'youchuan/text-to-image-v81',
  'youchuan/text-to-image-v8.2-fast',
  'youchuan/text-to-image-v8.2-turbo',
]);

export const canvasBillingAliases=Object.freeze({
  'rh-seedream-v5-pro-t2i':'seedream-v5-pro/text-to-image',
  'rh-seedream-v5-pro-i2i':'seedream-v5-pro/image-to-image',
  'rh-seedream-v5.5-t2i':'seedream-v5.5/text-to-image',
  'rh-seedream-v5.5-i2i':'seedream-v5.5/image-to-image',
  'rh-seedream-v5.5-layer':'seedream-v5.5/layer-decomposition',
  'rh-minimax-h3-image-t2i':'minimax/h3-image/text-to-image',
  'rh-minimax-h3-image-edit':'minimax/h3-image/image-edit',
  'rh-seedance-2.5-multi':'bytedance/seedance-2.5-token/multimodal-video',
  'rh-seedance-2.5-t2v':'bytedance/seedance-2.5-token/text-to-video',
  'rh-seedance-2.5-i2v':'bytedance/seedance-2.5-token/image-to-video',
  'rh-seedance-2.5-flash-multi':'bytedance/seedance-2.5-flash-token/multimodal-video',
  'rh-seedance-2.5-flash-t2v':'bytedance/seedance-2.5-flash-token/text-to-video',
  'rh-seedance-2.5-flash-i2v':'bytedance/seedance-2.5-flash-token/image-to-video',
  'rh-seedance-2.0-multi':'rhart-video/sparkvideo-2.0/multimodal-video',
  'rh-seedance-2.0-t2v':'rhart-video/sparkvideo-2.0/text-to-video',
  'rh-seedance-2.0-i2v':'rhart-video/sparkvideo-2.0/image-to-video',
  'rh-seedance-2.0-fast-multi':'rhart-video/sparkvideo-2.0-fast/multimodal-video',
  'rh-seedance-2.0-fast-t2v':'rhart-video/sparkvideo-2.0-fast/text-to-video',
  'rh-seedance-2.0-fast-i2v':'rhart-video/sparkvideo-2.0-fast/image-to-video',
  'rh-seedance-2.0-mini-multi':'rhart-video/sparkvideo-2.0-mini/multimodal-video',
  'rh-seedance-2.0-mini-i2v':'rhart-video/sparkvideo-2.0-mini/image-to-video',
  'rh-minimax-h3-multi':'minimax/hailuo-h3/multimodal-to-video',
  'rh-minimax-h3-i2v':'minimax/hailuo-h3/image-to-video',
  'rh-kling-4-omni':'kling-v4/omni-video',
  'rh-kling-4-i2v':'kling-v4/image-to-video',
  'rh-kling-4-t2v':'kling-v4/text-to-video',
  'rh-kling-lipsync-tts':'kling-lip-sync/tts',
  'rh-kling-lipsync-video':'kling-lip-sync/lip-sync-video',
  'rh-kling-motion-v3-pro':'kling-v3.0-pro/motion-control',
  'rh-kling-v2-avatar-standard':'kling-v2-ai-avatar-standard/image-audio-to-video',
  'rh-wan-3-ref':'alibaba/wan-3.0/reference-to-video',
  'rh-wan-3-i2v':'alibaba/wan-3.0/image-to-video',
  'rh-wan-3-t2v':'alibaba/wan-3.0/text-to-video',
  'rh-video-upscale':'rhart-video/video-upscaler',
  'rh-speech-2.8-hd':'rhart-audio/text-to-audio/speech-2.8-hd',
  'rh-speech-2.8-turbo':'rhart-audio/text-to-audio/speech-2.8-turbo',
  'rh-mureka-v9-bgm':'mureka-ai/mureka-v9/generate-bgm',
  'rh-mureka-v9-song':'mureka-ai/mureka-v9/generate-song',
  'rh-muse-video-economy':'meta/muse-video/economy',
  'rh-midjourney-v8.1-t2i':'youchuan/text-to-image-v81',
  'rh-midjourney-v8.2-fast-t2i':'youchuan/text-to-image-v8.2-fast',
  'rh-midjourney-v8.2-turbo-t2i':'youchuan/text-to-image-v8.2-turbo',
  'rh-gpt-image-2.6-sunburst-i2i':'rhart-image-g-2.6-official-token/sunburst/edit',
  'rh-gpt-image-2.6-flare-i2i':'rhart-image-g-2.6-official-token/flare/edit',
  'rh-gpt-image-2.6-sunburst-t2i':'rhart-image-g-2.6-official-token/sunburst/text-to-image',
  'rh-gpt-image-2.6-flare-t2i':'rhart-image-g-2.6-official-token/flare/text-to-image',
  'rh-gpt-image-2.5-sunburst-i2i':'rhart-image-g-2.5-official-token/sunburst/edit',
  'rh-gpt-image-2.5-flare-i2i':'rhart-image-g-2.5-official-token/flare/edit',
  'rh-gpt-image-2.5-sunburst-t2i':'rhart-image-g-2.5-official-token/sunburst/text-to-image',
  'rh-gpt-image-2.5-flare-t2i':'rhart-image-g-2.5-official-token/flare/text-to-image',
  'rh-nano-banana-2.1-i2i':'rhart-image-n-nb21-official/image-to-image',
  'rh-nano-banana-2.1-t2i':'rhart-image-n-nb21-official/text-to-image',
});

function modelEndpoint(value){
  let model=String(value||'').trim().split('::').at(-1).replace(/^\/+/,'');
  if(!model||model.includes('://'))throw Error('画布模型编号无效');
  const aliases={
    'rh-minimax-h3-multi':'minimax/hailuo-h3/multimodal-to-video',
  };
  if(aliases[model])return aliases[model];
  if(model.startsWith('rh')||model.includes('/')&&!model.startsWith('gpt-image-')&&!model.startsWith('nano-banana-'))return model;
  const gpt=model.match(/^gpt-image-(2\.\d+)\/(flare|sunburst)\/(text-to-image|image-to-image)\/stable-token$/);
  if(gpt)return `rhart-image-g-${gpt[1]}-official-token/${gpt[2]}/${gpt[3]}`;
  const nano=model.match(/^nano-banana-(2\.1|2)\/(text-to-image|image-to-image)(?:-official-stable|-offcial-stable)?$/);
  if(nano)return `rhart-image-n-${nano[1]==='2.1'?'nb21':'nb2'}-official/${nano[2]}`;
  return model.replace(/\/stable-token$/,'');
}

function providerModel(value){
  return String(value||'').trim().split('::').at(-1).replace(/^\/+/,'');
}

export function canvasModelRoute(job){
  const raw=providerModel(job?.modelId);
  const label=String(job?.modelLabel||'').trim();
  const labelEndpoint=label?modelEndpoint(label):'';
  const execution=labelEndpoint!==label&&!label.includes('::')?labelEndpoint:raw;
  const billingKey=canvasBillingAliases[raw]||(labelEndpoint!==label?labelEndpoint:modelEndpoint(raw));
  const provider=String(job?.modelId||'').split('::')[0];
  return {
    execution,billingKey,
    aiSite:provider==='aicyld-runninghub-ai-media'||provider==='aicyld-runninghub-llm-global'||AI_MEDIA_MODELS.has(execution),
    text:provider==='aicyld-runninghub-llm-cn'||provider==='aicyld-runninghub-llm-global'||String(job?.modality||'').toUpperCase()==='TEXT',
  };
}

function modalityCategory(modality){
  return ({TEXT:'text',IMAGE:'image',VIDEO:'video',AUDIO:'audio',MUSIC:'audio'})[modality]||'image';
}

function generationBody(job){
  const input=job.input&&typeof job.input==='object'?job.input:{};
  const params=input.params&&typeof input.params==='object'?input.params:{};
  const body={...params};
  if(typeof input.prompt==='string'&&input.prompt.trim())body.prompt=input.prompt.trim();
  if(typeof input.title==='string'&&input.title.trim())body.title=input.title.trim();
  const references=Array.isArray(input.referenceAssets)?input.referenceAssets.filter(item=>typeof item==='string'&&/^https:\/\//.test(item)):[];
  if(references.length)body.imageUrls=references;
  if(typeof input.sourceAssetUrl==='string'&&/^https:\/\//.test(input.sourceAssetUrl))body.sourceImage=input.sourceAssetUrl;
  if(typeof input.lastFrameAssetUrl==='string'&&/^https:\/\//.test(input.lastFrameAssetUrl))body.lastFrameImage=input.lastFrameAssetUrl;
  if(String(job.modality||'').toUpperCase()==='VIDEO'&&body.aspectRatio==='auto')body.aspectRatio='adaptive';
  return body;
}

function billingFacts(job,route=canvasModelRoute(job)){
  const displayText=String(job.modelLabel||job.modelId||'').trim();
  const body=generationBody(job);
  const category=modalityCategory(job.modality);
  const facts={
    modelKey:route.billingKey,
    providerModelKey:route.billingKey,
    displayName:job.modelLabel||job.modelId,
    category,
    operation:route.execution.split('/').at(-1),
    outputCount:1,
    batchCount:1,
  };
  for(const key of ['aspectRatio','resolution','quality','outputFormat','speed','durationSeconds']) {
    if(body[key]!==undefined&&body[key]!=='')facts[key]=body[key];
  }
  if(body.audio===true)facts.generateAudio=true;
  if(Array.isArray(body.imageUrls)&&body.imageUrls.length)facts.referenceImageCount=body.imageUrls.length;
  if(category==='text') {
    const characters=String(body.prompt||'').length;
    facts.inputCharacters=characters;
    facts.inputTokens=Math.max(1,Math.ceil(characters/2));
  }
  return facts;
}

function unwrap(payload){
  if(payload&&typeof payload==='object'&&!Array.isArray(payload)&&'code' in payload&&Number(payload.code)!==0){
    throw Error(String(payload.msg||payload.message||`RunningHub 错误 ${payload.code}`));
  }
  return payload?.data&&typeof payload.data==='object'?payload.data:payload;
}

function resultAsset(result,job){
  const rows=Array.isArray(result?.results)?result.results:[];
  const first=rows.find(row=>row&&typeof row==='object')||{};
  const url=first.fileUrl||first.url||first.outputUrl||first.imageUrl||first.videoUrl||first.audioUrl;
  const text=first.text||first.content||result?.text;
  if(typeof url==='string'&&/^https:\/\//.test(url)){
    return {assetUrl:url,previewUrl:url,metadata:{taskId:result.taskId||'',text:typeof text==='string'?text:undefined}};
  }
  if(typeof text==='string'&&text.trim())return {text:text.trim(),metadata:{taskId:result.taskId||''}};
  throw Error('RunningHub 未返回可展示的作品地址');
}

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export function createCanvasGenerationAdapter({
  origin,
  billingSecret,
  runningHubApiKey,
  runningHubAiApiKey=runningHubApiKey,
  runningHubBaseUrl='https://www.runninghub.cn/openapi/v2',
  runningHubAiBaseUrl='https://www.runninghub.ai/openapi/v2',
  runningHubLlmBaseUrl='https://llm.runninghub.cn/v1',
  runningHubLlmAiBaseUrl='https://llm.runninghub.ai/v1',
  fetchImpl=fetch,
  pollIntervalMs=2000,
  generationTimeoutMs=300000,
}={}){
  if(!origin||!billingSecret||!runningHubApiKey)throw Error('画布生成适配配置不完整');
  const mainSite=new URL(origin);
  const cnBase=new URL(runningHubBaseUrl);
  const aiBase=new URL(runningHubAiBaseUrl);
  const llmCnBase=new URL(runningHubLlmBaseUrl);
  const llmAiBase=new URL(runningHubLlmAiBaseUrl);

  async function billing(path,body,timeout=30000){
    const response=await fetchImpl(new URL(`/internal/canvas-billing/${path}`,mainSite),{
      method:'POST',redirect:'error',cache:'no-store',
      headers:{'Content-Type':'application/json','x-canvas-billing-secret':billingSecret},
      body:JSON.stringify(body),signal:AbortSignal.timeout(timeout),
    });
    const payload=await response.json().catch(()=>null);
    if(!response.ok)throw Object.assign(Error(payload?.error?.message||payload?.error||'画布计费暂不可用'),{
      status:response.status,code:payload?.error?.code||payload?.code,
    });
    return payload?.data||payload;
  }

  function runningHubConfig(route){
    return {base:route.aiSite?aiBase:cnBase,key:route.aiSite?runningHubAiApiKey:runningHubApiKey};
  }

  async function runningHub(path,body,config,timeout=120000){
    const response=await fetchImpl(new URL(path.replace(/^\/+/,''),`${config.base.href.replace(/\/+$/,'')}/`),{
      method:'POST',redirect:'error',cache:'no-store',
      headers:{Authorization:`Bearer ${config.key}`,'Content-Type':'application/json',Accept:'application/json'},
      body:JSON.stringify(body),signal:AbortSignal.timeout(timeout),
    });
    const payload=await response.json().catch(()=>null);
    if(!response.ok)throw Error(payload?.msg||payload?.error||`RunningHub HTTP ${response.status}`);
    return unwrap(payload);
  }

  async function chatCompletion(route,job){
    const body=generationBody(job);
    const base=route.aiSite?llmAiBase:llmCnBase;
    const key=route.aiSite?runningHubAiApiKey:runningHubApiKey;
    const response=await fetchImpl(new URL('chat/completions',`${base.href.replace(/\/+$/,'')}/`),{
      method:'POST',redirect:'error',cache:'no-store',
      headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json',Accept:'application/json'},
      body:JSON.stringify({model:route.execution,messages:[{role:'user',content:String(body.prompt||'')}],stream:false}),
      signal:AbortSignal.timeout(120000),
    });
    const payload=await response.json().catch(()=>null);
    if(!response.ok)throw Error(payload?.error?.message||payload?.message||`RunningHub Chat HTTP ${response.status}`);
    const text=payload?.choices?.[0]?.message?.content??payload?.output_text??payload?.data?.choices?.[0]?.message?.content;
    if(typeof text!=='string'||!text.trim())throw Error('文本模型未返回内容');
    return {text:text.trim(),usage:payload?.usage||{}};
  }

  async function quoteGeneration(job){
    const route=canvasModelRoute(job);
    const facts=billingFacts(job,route);
    const quote=await billing('quote',{userId:job.userId,facts});
    if(!quote||!Number.isSafeInteger(quote.points)||quote.points<0)throw Error('画布报价待确认');
    return {quoteId:job.jobId,points:quote.points,expiresAt:Date.now()+5*60*1000,modelKey:facts.modelKey,executionModelKey:route.execution,balance:quote.balance};
  }

  async function generateOrLookup(job){
    const route=canvasModelRoute(job);
    const facts=billingFacts(job,route);
    const reservation=await billing('reserve',{
      userId:job.userId,idempotencyKey:job.jobId,taskId:job.jobId,projectId:job.runId,facts,
    });
    const holdId=reservation?.holdId||'';
    try{
      const config=runningHubConfig(route);
      const body={...generationBody(job),clientId:job.jobId};
      if(route.text) {
        const chat=await chatCompletion(route,job);
        if(holdId)await billing('settle',{holdId,outcome:'succeeded',reason:'文本生成完成'});
        return {jobId:job.jobId,status:'settled',transactionId:holdId||`free-${job.jobId}`,
          asset:{text:chat.text,metadata:{taskId:'',text:chat.text}}};
      }
      let result=await runningHub(route.execution,body,config);
      const taskId=String(result?.taskId||'');
      if(!taskId)throw Error('RunningHub 未返回任务编号');
      let status=String(result?.status||'QUEUED').toUpperCase();
      const started=Date.now();
      while(!['SUCCESS','FAILED'].includes(status)){
        if(Date.now()-started>=generationTimeoutMs)throw Error('画布生成超时，费用将在对账后处理');
        await sleep(pollIntervalMs);
        result=await runningHub('query',{taskId},config,30000);
        status=String(result?.status||'').toUpperCase();
      }
      if(status==='FAILED')throw Error(result?.errorMessage||result?.failedReason?.exceptionMessage||'RunningHub 生成失败');
      const asset=resultAsset({...result,taskId},job);
      const usage=result?.usage||{};
      const actualCostCny=Number(usage.consumeMoney||usage.thirdPartyConsumeMoney||0);
      if(holdId)await billing('settle',{holdId,outcome:'succeeded',actualCostCny:actualCostCny>0?actualCostCny:undefined,reason:'画布生成完成'});
      return {jobId:job.jobId,status:'settled',transactionId:holdId||`free-${job.jobId}`,asset};
    }catch(error){
      if(holdId)await billing('release',{holdId,reason:error.message||'画布生成失败'}).catch(()=>{});
      throw error;
    }
  }

  return {quoteGeneration,generateOrLookup};
}

export function canvasGenerationFromEnv(env=process.env){
  const origin=env.KUAIXUE_INTERNAL_ORIGIN||env.KUAIXUE_MAIN_SITE_ORIGIN;
  const billingSecret=env.KUAIXUE_CANVAS_BILLING_SECRET||env.CANVAS_BILLING_SECRET;
  const runningHubApiKey=env.RUNNINGHUB_API_KEY;
  if(!origin||!billingSecret||!runningHubApiKey)return null;
  return createCanvasGenerationAdapter({
    origin,billingSecret,runningHubApiKey,
    runningHubAiApiKey:env.RUNNINGHUB_AI_API_KEY||runningHubApiKey,
    runningHubBaseUrl:env.KUAIXUE_RUNNINGHUB_BASE_URL||undefined,
    runningHubAiBaseUrl:env.KUAIXUE_RUNNINGHUB_AI_BASE_URL||undefined,
    runningHubLlmBaseUrl:env.KUAIXUE_RUNNINGHUB_LLM_BASE_URL||undefined,
    runningHubLlmAiBaseUrl:env.KUAIXUE_RUNNINGHUB_LLM_AI_BASE_URL||undefined,
  });
}
