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

function modelEndpoint(value){
  const model=String(value||'').trim().replace(/^\/+/,'');
  if(!model||model.includes('://'))throw Error('画布模型编号无效');
  if(model.startsWith('rh')||model.includes('/')&&!model.startsWith('gpt-image-')&&!model.startsWith('nano-banana-'))return model;
  const gpt=model.match(/^gpt-image-(2\.\d+)\/(flare|sunburst)\/(text-to-image|image-to-image)\/stable-token$/);
  if(gpt)return `rhart-image-g-${gpt[1]}-official-token/${gpt[2]}/${gpt[3]}`;
  const nano=model.match(/^nano-banana-(2\.1|2)\/(text-to-image|image-to-image)(?:-official-stable|-offcial-stable)?$/);
  if(nano)return `rhart-image-n-${nano[1]==='2.1'?'nb21':'nb2'}-official/${nano[2]}`;
  return model.replace(/\/stable-token$/,'');
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
  return body;
}

function billingFacts(job){
  const displayModel=job.modelLabel||job.modelId;
  const endpoint=modelEndpoint(displayModel);
  const body=generationBody(job);
  const category=modalityCategory(job.modality);
  const facts={
    modelKey:endpoint,
    providerModelKey:endpoint,
    displayName:job.modelLabel||job.modelId,
    category,
    operation:endpoint.split('/').at(-1),
    outputCount:1,
    batchCount:1,
  };
  for(const key of ['aspectRatio','resolution','quality','outputFormat','speed','durationSeconds']) {
    if(body[key]!==undefined&&body[key]!=='')facts[key]=body[key];
  }
  if(body.audio===true)facts.generateAudio=true;
  if(Array.isArray(body.imageUrls)&&body.imageUrls.length)facts.referenceImageCount=body.imageUrls.length;
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
  fetchImpl=fetch,
  pollIntervalMs=2000,
  generationTimeoutMs=300000,
}={}){
  if(!origin||!billingSecret||!runningHubApiKey)throw Error('画布生成适配配置不完整');
  const mainSite=new URL(origin);
  const cnBase=new URL(runningHubBaseUrl);
  const aiBase=new URL(runningHubAiBaseUrl);

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

  function runningHubConfig(facts){
    const ai=AI_MEDIA_MODELS.has(facts.modelKey);
    return {base:ai?aiBase:cnBase,key:ai?runningHubAiApiKey:runningHubApiKey};
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

  async function quoteGeneration(job){
    const facts=billingFacts(job);
    const quote=await billing('quote',{userId:job.userId,facts});
    if(!quote||!Number.isSafeInteger(quote.points)||quote.points<0)throw Error('画布报价待确认');
    return {quoteId:job.jobId,points:quote.points,expiresAt:Date.now()+5*60*1000,modelKey:facts.modelKey,balance:quote.balance};
  }

  async function generateOrLookup(job){
    const facts=billingFacts(job);
    const reservation=await billing('reserve',{
      userId:job.userId,idempotencyKey:job.jobId,taskId:job.jobId,projectId:job.runId,facts,
    });
    const holdId=reservation?.holdId||'';
    try{
      const config=runningHubConfig(facts);
      const body={...generationBody(job),clientId:job.jobId};
      let result=await runningHub(facts.modelKey,body,config);
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
  });
}
