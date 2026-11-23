import { normalizeCourseDetail } from '../data/courses.js';
import { localWorkshop, loadLearningAccount } from './learningAccount.js';

// The runtime has its own origin. A course response may supply a ticket, never a frame URL.
export function workbenchUrl(origin, parentOrigin, runId, ticket) {
  const target = new URL(origin);
  if (target.protocol !== 'https:' || target.origin === parentOrigin || target.href !== `${target.origin}/` ||
      typeof ticket !== 'string' || !/^[A-Za-z0-9_-]{24,512}$/.test(ticket)) {
    throw new Error('VibeCoding 运行服务配置无效。');
  }
  target.pathname = '/kuaixue/workbench/';
  target.hash = new URLSearchParams({run:runId, ticket}).toString();
  return target.href;
}

export function createCourseClient({ base, vibeOrigin, parentOrigin, fetchImpl = fetch, account }) {
  async function request(path, body) {
    const response = await fetchImpl(`${base}/api/v1/${path}`, {
      method:'POST', credentials:'include', redirect:'error', cache:'no-store',
      headers:{'Content-Type':'application/json'}, body:JSON.stringify(body), signal:AbortSignal.timeout(20000),
    });
    if (!response.ok) {
      const errors = {401:'请重新登录快学账号。', 402:'积分余额不足。', 403:'当前账号没有此课程工作区的权益。', 409:'课程或进度已更新，请重新打开。', 503:'课程服务暂不可用，请稍后重试。'};
      throw new Error(errors[response.status] || '请求未确认，请刷新账户或重新打开课程。');
    }
    return (await response.json()).data;
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
        frameUrl:mode === 'VIBECODING' ? workbenchUrl(vibeOrigin,parentOrigin,run.id,run.runtimeTicket) : null};
    },
    works: () => request('course-runs/works',{}),
    quote: body => request('generations/quote',body),
    generate: body => request('generations/confirm',body),
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
