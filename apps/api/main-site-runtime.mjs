import {snapshotLimits} from '../../shared/local-snapshot.mjs';

export class MainSiteRuntimeError extends Error {
  constructor(status,code,message='主站本机运行能力暂不可用',currentRevision=null){
    super(message);
    this.name='MainSiteRuntimeError';
    this.status=status;
    this.code=code;
    this.currentRevision=currentRevision;
  }
}

function requireOrigin(value){
  let origin;
  try{origin=new URL(value);}catch{throw new Error('KUAIXUE_MAIN_SITE_ORIGIN 无效');}
  if(origin.username||origin.password||
    !(origin.protocol==='https:'||origin.protocol==='http:'&&['127.0.0.1','localhost','::1'].includes(origin.hostname))) {
    throw new Error('主站内部接口必须使用 HTTPS 或本机回环地址');
  }
  origin.pathname=origin.pathname.replace(/\/+$/,'');
  return origin;
}

async function failure(response){
  const problem=await response.json().catch(()=>null);
  const code=problem?.error?.code||'MAIN_SITE_RUNTIME_UNAVAILABLE';
  const message=problem?.error?.message||(response.status===404?'云端工程快照不存在':'主站本机运行能力暂不可用');
  const currentRevision=Number.isSafeInteger(problem?.currentRevision)?problem.currentRevision:null;
  throw new MainSiteRuntimeError(response.status,code,message,currentRevision);
}

export function createMainSiteRuntimeAdapter({
  origin,secret,fetchImpl=fetch,timeoutMs=15000,maxSnapshotBytes=snapshotLimits.archiveBytes,
}={}){
  if(typeof secret!=='string'||!secret) throw new Error('KUAIXUE_INTERNAL_SECRET 未配置');
  const base=requireOrigin(origin);
  const headers={'x-kuaixue-internal-secret':secret,'Cache-Control':'no-store'};

  async function request(path,options={}){
    let response;
    try{
      response=await fetchImpl(new URL(path,base),{
        ...options,redirect:'error',cache:'no-store',
        headers:{...headers,...options.headers},
        signal:AbortSignal.timeout(timeoutMs),
      });
    }catch(error){
      throw new MainSiteRuntimeError(503,'MAIN_SITE_RUNTIME_UNAVAILABLE',error?.name==='TimeoutError'?'主站本机运行能力超时':'主站本机运行能力暂不可用');
    }
    if(!response.ok)await failure(response);
    return response;
  }

  return {
    async issueLocalModelGrant(context){
      if(!Array.isArray(context.modelIds)||!context.modelIds.length) {
        throw new MainSiteRuntimeError(503,'MODEL_GRANT_NOT_CONFIGURED','课程版本未配置可授权的模型');
      }
      const response=await request('/internal/kuaixue/runtime-grant',{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(context),
      });
      const payload=await response.json().catch(()=>null);
      return payload?.data;
    },
    async uploadLocalSnapshot(context){
      if(!Buffer.isBuffer(context.bytes)||!context.bytes.length) {
        throw new MainSiteRuntimeError(400,'INVALID_SNAPSHOT','快照为空');
      }
      if(context.bytes.length>maxSnapshotBytes) {
        throw new MainSiteRuntimeError(413,'SNAPSHOT_TOO_LARGE','快照压缩后超过 64 MiB');
      }
      const response=await request('/internal/kuaixue/snapshots',{
        method:'POST',
        headers:{
          'Content-Type':'application/zip',
          'x-kuaixue-user-id':context.userId,
          'x-kuaixue-course-id':context.courseId,
          'x-kuaixue-version-id':context.versionId,
          'x-kuaixue-run-id':context.runId,
          'x-kuaixue-base-revision':String(context.baseRevision),
          'x-kuaixue-snapshot-sha256':context.sha256,
        },
        body:context.bytes,
      });
      const payload=await response.json().catch(()=>null);
      return payload?.data;
    },
    async downloadLocalSnapshot(context){
      const query=new URLSearchParams({
        userId:context.userId,courseId:context.courseId,versionId:context.versionId,runId:context.runId,
      });
      const response=await request(`/internal/kuaixue/snapshots?${query}`);
      const bytes=Buffer.from(await response.arrayBuffer());
      const sha256=response.headers.get('x-kuaixue-snapshot-sha256')||'';
      const revision=Number(response.headers.get('x-kuaixue-revision'));
      const capturedAt=response.headers.get('x-kuaixue-captured-at')||'';
      if(!Number.isSafeInteger(revision)||revision<1||!/^[a-f0-9]{64}$/.test(sha256)||!capturedAt||
          response.headers.get('content-type')?.split(';')[0].trim()!=='application/zip') {
        throw new MainSiteRuntimeError(503,'SNAPSHOT_RESPONSE_INVALID','云端工程快照响应无效');
      }
      return {bytes,revision,sha256,capturedAt,etag:response.headers.get('etag')||`"${sha256}"`};
    },
  };
}

export function mainSiteRuntimeFromEnv(env=process.env){
  const origin=env.KUAIXUE_INTERNAL_ORIGIN||env.KUAIXUE_MAIN_SITE_ORIGIN;
  const secret=env.KUAIXUE_INTERNAL_SECRET||env.KUAIXUE_WALLET_SECRET;
  if(!origin||!secret)return null;
  return createMainSiteRuntimeAdapter({origin,secret});
}
