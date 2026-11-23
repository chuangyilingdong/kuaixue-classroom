import {CourseProblem} from './course-platform.mjs';

export async function sessionPrincipal(req, identity) {
  const session = /(?:^|;\s*)kuaixue_session=([^;\s]+)/.exec(req.headers.cookie || '')?.[1];
  return session && identity ? identity(session) : null;
}
const methods = new Map([
  ['/api/v1/course-runs/works','works'],
  ['/api/v1/generations/quote','quote'], ['/api/v1/generations/confirm','generate'],
  ['/api/v1/course-purchases','purchase'], ['/api/v1/course-runs/open','start'], ['/api/v1/course-runs/save','save'],
]);
export async function readBody(req) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw new CourseProblem(415,'需要 JSON');
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4_000_000) throw new CourseProblem(413,'作品超出大小限制');
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error();
    return value;
  } catch { throw new CourseProblem(400,'无效的数据'); }
}
export async function handleCourseAction(req,res,{path,allowed,identity,platform,json}) {
  const method = methods.get(path);
  if (!method) return false;
  try {
    if (req.method !== 'POST') throw new CourseProblem(405,'需要 POST');
    if (req.headers.origin && !allowed.has(req.headers.origin)) throw new CourseProblem(403,'来源无效');
    if (!platform || !identity) throw new CourseProblem(503,'课程服务待接入');
    const principal = await sessionPrincipal(req,identity);
    if (!principal?.userId) throw new CourseProblem(401,'请先登录');
    const data = await platform[method](principal.userId,await readBody(req));
    json(res,200,{data});
  } catch (error) {
    const known = error instanceof CourseProblem;
    json(res,known ? error.status : 503,{error:{code:'COURSE_ACTION_FAILED',message:known ? error.message : '课程服务暂不可用'}});
  }
  return true;
}
