import { normalizeCourseDetail } from '../data/courses.js';
import { localWorkshop, loadLearningAccount } from './learningAccount.js';
import { requireVibeOrigin } from './vibeOrigin.js';

// The runtime has its own origin. A course response may supply a ticket, never a frame URL.
export function workbenchUrl(origin, parentOrigin, runId, ticket) {
  const target = new URL(requireVibeOrigin(origin, parentOrigin));
  if (typeof ticket !== 'string' || !/^[A-Za-z0-9_-]{24,512}$/.test(ticket)) {
    throw new Error('VibeCoding 运行票据无效，请重新打开工作区。');
  }
  target.pathname = '/kuaixue/workbench/';
  target.hash = new URLSearchParams({run:runId, ticket}).toString();
  return target.href;
}

export function createCourseClient({ base, vibeOrigin, parentOrigin, fetchImpl = fetch, account }) {
  const sleep = milliseconds => new Promise(resolve => setTimeout(resolve,milliseconds));
  const errors = {401:'请重新登录快学账号。', 402:'积分余额不足。', 403:'当前账号没有此课程工作区的权益。', 404:'云端尚无工程快照。', 409:'课程、进度或工程快照已更新，请先刷新。', 413:'文件超出大小限制。', 415:'不支持的文件类型。', 503:'课程服务暂不可用，请稍后重试。'};
  async function failure(response) {
    const problem = await response.json().catch(() => null);
    if (problem?.error?.code === 'PURCHASES_DISABLED') throw new Error('正式购课暂未开放。');
    const serverMessage = problem?.error?.message;
    const message = response.status === 403
      ? `当前账号没有此课程工作区的权益。${serverMessage ? ` ${serverMessage}` : ''}`
      : serverMessage || errors[response.status] || '请求未确认，请刷新账户或重新打开课程。';
    throw Object.assign(new Error(message), {status:response.status});
  }
  async function request(path, body, timeout=20000) {
    const response = await fetchImpl(`${base}/api/v1/${path}`, {
      method:'POST', credentials:'include', redirect:'error', cache:'no-store',
      headers:{'Content-Type':'application/json'}, body:JSON.stringify(body), signal:AbortSignal.timeout(timeout),
    });
    if (!response.ok) await failure(response);
    return (await response.json()).data;
  }
  async function digest(bytes) {
    const value = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (!value.length || !globalThis.crypto?.subtle) throw new Error('无法校验工程快照，请重新打开客户端。');
    return [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',value))]
      .map(byte=>byte.toString(16).padStart(2,'0')).join('');
  }
  async function snapshotFailure(response) {
    const problem = await response.json().catch(()=>null);
    const error = Object.assign(new Error(problem?.error?.message || errors[response.status] || '工程快照请求未确认。'), {
      status:response.status,
      code:problem?.error?.code || null,
      currentRevision:Number.isSafeInteger(problem?.currentRevision) ? problem.currentRevision : null,
    });
    throw error;
  }
  return {
    account,
    signOut: () => request('desktop/logout',{}),
    async purchase(courseId, versionId) {
      const receipt = await request('course-purchases', {courseId,versionId});
      if (receipt?.status !== 'confirmed' || receipt.versionId !== versionId || receipt.courseId !== courseId) throw new Error('购课结果待确认，请刷新账户查询。');
      return account();
    },
    async start(courseId, versionId, mode) {
      const run = await request('course-runs/open', {courseId,versionId,mode});
      const course = normalizeCourseDetail(run?.course);
      if (!run.id || course.id !== courseId || course.versionId !== versionId || run.mode !== mode ||
          !course.permittedDeliveryModes.includes(mode) || !Number.isSafeInteger(run.revision) || run.revision < 0 ||
          !Array.isArray(run.completed) || run.completed.some(id => !course.steps.some(step => step.id === id))) throw new Error('工作区与所购版本不符。');
      if (mode === 'CANVAS' && run.work != null && (!Array.isArray(run.work.nodes) || !Array.isArray(run.work.edges))) throw new Error('画布作品格式不正确。');
      return {id:run.id, revision:run.revision, completed:run.completed, work:run.work, course, mode, generationModes:run.generationModes || [],
        frameUrl:mode === 'VIBECODING' && run.runtimeTicket ? workbenchUrl(vibeOrigin,parentOrigin,run.id,run.runtimeTicket) : null};
    },
    works: () => request('course-runs/works',{}),
    async workPreview(item) {
      const readSavedWork = globalThis.kuaixueDesktop?.vibe?.readSavedWork;
      if (item.mode === 'VIBECODING' && readSavedWork) {
        const current = await account();
        const owned = current.entitlements?.some(grant => grant.courseId === item.courseId && grant.status === 'active');
        if (!owned) throw new Error('当前账号没有此课程工作区的权益。');
        let local;
        try {
          local = await readSavedWork({
            userId: current.user.id, courseId: item.courseId, versionId: item.versionId, runId: item.id || '', title: item.title,
          });
        } catch (error) {
          if (error.status === 413) throw error;
        }
        if (local) return local;
      }
      return request('course-runs/preview', {
        courseId: item.courseId, versionId: item.versionId, mode: item.mode,
      }, 120000);
    },
    async localRuntime(id) {
      const data = await request('course-runs/local-runtime',{id});
      const gateway=data?.modelGateway;
      if (data?.runId !== id || typeof data?.userId !== 'string' || !gateway || typeof gateway.baseUrl !== 'string' ||
          typeof gateway.token !== 'string' || !gateway.token || !Number.isSafeInteger(gateway.expiresAt) ||
          !Array.isArray(gateway.modelIds) || !gateway.modelIds.length ||
          !gateway.usage || !Number.isSafeInteger(gateway.usage.limit) || gateway.usage.limit < 0 ||
          !Number.isSafeInteger(gateway.usage.used) || gateway.usage.used < 0 ||
          (gateway.usage.limit > 0 && (!Number.isSafeInteger(gateway.usage.remaining) ||
            gateway.usage.remaining < 0 || gateway.usage.remaining > gateway.usage.limit))) {
        throw new Error('本机模型授权无效。');
      }
      return data;
    },
    async uploadSnapshot({runId,baseRevision,bytes}) {
      if(typeof runId!=='string'||!runId||!Number.isSafeInteger(baseRevision)||baseRevision<0) throw new Error('工程快照参数无效。');
      const value=bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes||[]);
      if(!value.length) throw new Error('本机工程快照为空。');
      const sha256=await digest(value);
      const response=await fetchImpl(`${base}/api/v1/course-runs/local-snapshot`,{
        method:'POST',credentials:'include',redirect:'error',cache:'no-store',
        headers:{
          'Content-Type':'application/zip',
          'X-Kuaixue-Run-Id':runId,
          'X-Kuaixue-Base-Revision':String(baseRevision),
          'X-Kuaixue-Snapshot-SHA256':sha256,
        },
        body:value,signal:AbortSignal.timeout(180000),
      });
      if(!response.ok)await snapshotFailure(response);
      const data=(await response.json()).data;
      if(data?.runId!==runId||!Number.isSafeInteger(data.revision)||data.revision<1||
          data.sha256!==sha256||data.bytes!==value.length||typeof data.capturedAt!=='string'||
          Number.isNaN(Date.parse(data.capturedAt))) throw new Error('云端工程快照回执无效。');
      return data;
    },
    async downloadSnapshot(runId) {
      if(typeof runId!=='string'||!runId) throw new Error('工程快照参数无效。');
      const response=await fetchImpl(`${base}/api/v1/course-runs/local-snapshot?runId=${encodeURIComponent(runId)}`,{
        credentials:'include',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(180000),
      });
      if(!response.ok)await snapshotFailure(response);
      const sha256=response.headers.get('X-Kuaixue-Snapshot-SHA256')||'';
      const revision=Number(response.headers.get('X-Kuaixue-Revision'));
      const capturedAt=response.headers.get('X-Kuaixue-Captured-At')||'';
      const bytes=new Uint8Array(await response.arrayBuffer());
      if(response.headers.get('Content-Type')?.split(';')[0].trim()!=='application/zip'||!bytes.length||
          !Number.isSafeInteger(revision)||revision<1||!/^[a-f0-9]{64}$/.test(sha256)||!capturedAt||
          Number.isNaN(Date.parse(capturedAt))||await digest(bytes)!==sha256) throw new Error('云端工程快照下载结果无效。');
      return {runId,bytes,revision,sha256,capturedAt,etag:response.headers.get('ETag')||`"${sha256}"`};
    },
    async uploadAsset(id,file) {
      if (!(file instanceof Blob) || !file.type || !file.size) throw new Error('请选择有效的图片、视频或音频。');
      const kind = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : file.type.startsWith('audio/') ? 'audio' : '';
      if (!kind) throw new Error('不支持的素材类型。');
      const response = await fetchImpl(`${base}/api/v1/course-assets`, {
        method:'POST', credentials:'include', redirect:'error', cache:'no-store',
        headers:{
          'Content-Type':file.type,
          'X-Kuaixue-Run-Id':id,
          'X-Kuaixue-File-Name':encodeURIComponent(file.name || `素材-${Date.now()}`),
          'X-Kuaixue-Asset-Kind':kind,
        },
        body:file, signal:AbortSignal.timeout(120000),
      });
      if (!response.ok) await failure(response);
      const data = (await response.json()).data;
      if (!data?.id || !data.assetUrl || !data.previewUrl || data.kind !== kind) throw new Error('素材上传结果待确认，请重试。');
      return {...data,
        assetUrl:new URL(data.assetUrl,base).href,
        previewUrl:new URL(data.previewUrl,base).href,
      };
    },
    quote: body => request('generations/quote',body),
    quotePreview: body => request('generations/quote',{...body,preview:true}),
    generate: body => request('generations/confirm',body,540000),
    generationStatus: body => request('generations/status',body),
    async generateTracked({id,nodeId,jobId,timeout=600000}) {
      let longResult=null,longError=null,longSettled=false;
      const longRequest=request('generations/confirm',{id,jobId},540000)
        .then(result=>{longResult=result;longSettled=true;return result;})
        .catch(error=>{longError=error;longSettled=true;});
      const started=Date.now();
      let missingChecks=0;
      while(Date.now()-started<timeout){
        if(longSettled&&longResult)return longResult;
        try {
          const state=await request('generations/status',{id,nodeId});
          if(state?.jobId===jobId){
            if(state.status==='COMPLETE'&&state.asset)return state.asset;
            if(state.status==='FAILED')throw new Error('生成失败，已释放费用');
            missingChecks=0;
          }else if(state?.status==='NONE'&&longError&&++missingChecks>=3){
            throw longError;
          }
        }catch(error){
          if(longError&&!longSettled)throw longError;
          if(error?.message==='生成失败，已释放费用')throw error;
        }
        await sleep(1500);
      }
      if(longResult)return longResult;
      throw longError||new Error('画布生成超时，请返回课程后重新打开确认结果');
    },
    async save({id,mode,completed,revision,work}) {
      const data = await request('course-runs/save', {id,mode,completed,revision,...(mode === 'CANVAS' ? {work} : {})});
      if (data?.revision !== revision + 1) throw new Error('保存结果待确认，请重新打开课程。');
      return data.revision;
    },
  };
}
const base = import.meta.env?.VITE_KUAIXUE_API_BASE_URL?.replace(/\/+$/, '');
export const courseClient = localWorkshop || (base && import.meta.env?.VITE_KUAIXUE_COURSE_SERVICE === '1' && createCourseClient({
  base, vibeOrigin:import.meta.env.VITE_KUAIXUE_VIBE_ORIGIN, parentOrigin:globalThis.location.origin, account:loadLearningAccount,
}));
