import {CourseProblem} from './course-platform.mjs';

function requiredText(value,message) {
  const text=String(value ?? '').trim();
  if(!text) throw new Error(message);
  return text;
}

function validGatewayUrl(value) {
  const url=new URL(value);
  if(!['https:','http:'].includes(url.protocol)) throw Error('模型网关协议无效');
  if(url.protocol==='http:' && !['127.0.0.1','localhost','::1'].includes(url.hostname)) throw Error('模型网关必须使用 HTTPS');
  return url.toString().replace(/\/+$/,'');
}

export function createMainSiteModelGateway({
  mainSiteOrigin=process.env.KUAIXUE_INTERNAL_ORIGIN || process.env.KUAIXUE_MAIN_SITE_ORIGIN || 'http://127.0.0.1:3001',
  internalSecret=process.env.KUAIXUE_INTERNAL_SECRET || process.env.KUAIXUE_WALLET_SECRET,
  fetchImpl=fetch,
}={}) {
  const origin=requiredText(mainSiteOrigin,'主站地址未配置').replace(/\/+$/,'');
  const secret=requiredText(internalSecret,'主站协作密钥未配置');

  async function issue(context) {
    const response=await fetchImpl(`${origin}/internal/kuaixue/runtime-grant`,{
      method:'POST',
      headers:{
        Accept:'application/json',
        'Content-Type':'application/json',
        'x-kuaixue-internal-secret':secret,
      },
      body:JSON.stringify({
        userId:context.userId,
        courseId:context.courseId,
        versionId:context.versionId,
        runId:context.runId,
        mode:context.mode,
        modelIds:context.modelIds,
        usageLimit:context.usageLimit,
      }),
      redirect:'error',
      signal:AbortSignal.timeout(20_000),
    });
    const payload=await response.json().catch(()=>null);
    if(!response.ok || typeof payload?.data?.token!=='string') {
      const status=response.status>=400 && response.status<600 ? response.status : 503;
      throw new CourseProblem(status,payload?.error?.message || '运行授权暂不可用');
    }
    let baseUrl;
    try {
      const publicBase=validGatewayUrl(payload.data.baseUrl);
      const path=new URL(publicBase).pathname;
      if(!path.startsWith('/api/kuaixue-runtime/v1')) throw Error('模型网关路径无效');
      baseUrl=new URL(path,`${origin}/`).toString().replace(/\/+$/,'');
    }
    catch { throw new CourseProblem(503,'模型网关地址无效'); }
    return {baseUrl,token:payload.data.token};
  }

  async function chat(context,message) {
    const grant=await issue(context);
    return fetchImpl(`${grant.baseUrl}/chat/completions`,{
      method:'POST',
      headers:{
        Accept:'application/json',
        'Content-Type':'application/json',
        Authorization:`Bearer ${grant.token}`,
      },
      body:JSON.stringify(message),
      redirect:'error',
      signal:AbortSignal.timeout(200_000),
    });
  }

  return {issue,chat};
}
