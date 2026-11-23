import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import versioning from '../../electron/course-version.cjs';

export class CourseProblem extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const reject = (status, message) => { throw new CourseProblem(status, message); };

// Staging/one-node deployment. The main site owns every wallet debit and refund.
export function openCoursePlatform(filename, {debitOrLookup, issueRuntimeTicket, quoteGeneration, generateOrLookup} = {}) {
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=4000;
    CREATE TABLE IF NOT EXISTS kx_versions (version TEXT PRIMARY KEY, course TEXT NOT NULL, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS kx_listings (course TEXT PRIMARY KEY, version TEXT NOT NULL, visible INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS kx_orders (id TEXT PRIMARY KEY, user TEXT NOT NULL, version TEXT NOT NULL,
      price INTEGER NOT NULL, status TEXT NOT NULL, receipt TEXT UNIQUE, UNIQUE(user,version));
    CREATE TABLE IF NOT EXISTS kx_runs (id TEXT PRIMARY KEY, user TEXT NOT NULL, version TEXT NOT NULL,
      revision INTEGER NOT NULL, completed TEXT NOT NULL, canvas TEXT, UNIQUE(user,version));
    CREATE TABLE IF NOT EXISTS kx_workspaces_saved (run TEXT NOT NULL, mode TEXT NOT NULL, PRIMARY KEY(run,mode));
    CREATE TABLE IF NOT EXISTS kx_generation (id TEXT PRIMARY KEY, run TEXT NOT NULL, node TEXT NOT NULL, user TEXT NOT NULL,
      input TEXT NOT NULL, quote TEXT NOT NULL, status TEXT NOT NULL, result TEXT);
    CREATE UNIQUE INDEX IF NOT EXISTS kx_pending_node ON kx_generation(run,node) WHERE status='submitted';
    CREATE TABLE IF NOT EXISTS kx_audit (actor TEXT NOT NULL, action TEXT NOT NULL, version TEXT NOT NULL, at TEXT DEFAULT CURRENT_TIMESTAMP);`);
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {const value = fn(); db.exec('COMMIT'); return value;}
    catch (error) {db.exec('ROLLBACK'); throw error;}
  }
  function catalog(includeHidden = false) {
    return db.prepare(`SELECT body,visible FROM kx_listings JOIN kx_versions USING(version) ${includeHidden ? '' : 'WHERE visible=1'} ORDER BY kx_listings.rowid`).all()
      .map(row => ({...JSON.parse(row.body), visible:Boolean(row.visible)}));
  }
  function lookup(courseId,versionId) {
    const row = db.prepare('SELECT body FROM kx_versions WHERE course=? AND version=?').get(courseId, versionId);
    if (!row) reject(404,'找不到课程版本');
    return JSON.parse(row.body);
  }
  function publish(actor, draft) {
    return transaction(() => {
      let base;
      if (draft.id || draft.baseVersion) {
        if (!draft.id || !draft.baseVersion || db.prepare('SELECT version FROM kx_listings WHERE course=?').get(draft.id)?.version !== draft.baseVersion) reject(409,'课程已更新，请刷新后再发布');
        base = lookup(draft.id,draft.baseVersion);
      }
      let course;
      try { course = versioning.buildCourseVersion(draft,base); } catch (error) { reject(400,error.message); }
      db.prepare('INSERT INTO kx_versions VALUES(?,?,?)').run(course.versionId,course.id,JSON.stringify(course));
      db.prepare('INSERT OR REPLACE INTO kx_listings VALUES(?,?,1)').run(course.id,course.versionId);
      db.prepare('INSERT INTO kx_audit(actor,action,version) VALUES(?,?,?)').run(actor,'publish',course.versionId);
      return course;
    });
  }
  function hide(actor,{id,baseVersion}) {
    return transaction(() => {
      const change = db.prepare('UPDATE kx_listings SET visible=0 WHERE course=? AND version=? AND visible=1').run(id,baseVersion);
      if (!change.changes) reject(409,'课程已更新或下架');
      db.prepare('INSERT INTO kx_audit(actor,action,version) VALUES(?,?,?)').run(actor,'hide',baseVersion);
    });
  }
  function listGrants(user) {
    return db.prepare(`SELECT user userId, course courseId, version versionId, CASE WHEN status='confirmed' THEN 'active' ELSE 'revoked' END status
      FROM kx_orders JOIN kx_versions USING(version) WHERE user=? AND status IN ('confirmed','revoked')`).all(user);
  }
  function entitled(user,version) {
    return Boolean(db.prepare("SELECT id FROM kx_orders WHERE user=? AND version=? AND status='confirmed'").get(user,version));
  }
  function detail(courseId,versionId,user) {
    const listing = db.prepare('SELECT version,visible FROM kx_listings WHERE course=?').get(courseId);
    const version = versionId || listing?.version;
    if (!(listing?.visible && listing.version === version) && !(user && version && entitled(user,version))) reject(404,'找不到课程版本');
    return lookup(courseId,version);
  }
  async function purchase(user,{courseId,versionId}) {
    const course = lookup(courseId,versionId);
    const order = transaction(() => {
      const existing = db.prepare('SELECT * FROM kx_orders WHERE user=? AND version=?').get(user,versionId);
      if (existing?.status === 'revoked') reject(403,'课程权益已撤销');
      if (existing) return existing;
      if (!db.prepare('SELECT course FROM kx_listings WHERE version=? AND visible=1').get(versionId)) reject(409,'此版本已更新或下架');
      const id = randomUUID();
      db.prepare('INSERT INTO kx_orders VALUES(?,?,?,?,?,NULL)').run(id,user,versionId,course.unlockPricePoints,'pending');
      return {id, status:'pending', price:course.unlockPricePoints};
    });
    if (order.status === 'pending') {
      // The wallet adapter MUST query/retry the same order ID, including after a timeout or restart.
      if (order.price && !debitOrLookup) reject(503,'积分服务待接入');
      const receipt = order.price ? await debitOrLookup({orderId:order.id,userId:user,courseId,versionId,points:order.price}) :
        {status:'confirmed',transactionId:`free-${order.id}`,orderId:order.id,userId:user,points:0};
      if (receipt?.status === 'insufficient') reject(402,'积分不足');
      if (receipt?.status !== 'confirmed' || receipt.orderId !== order.id || receipt.userId !== user || receipt.points !== order.price || typeof receipt.transactionId !== 'string' || !receipt.transactionId) reject(503,'扣款结果待确认');
      db.prepare("UPDATE kx_orders SET status='confirmed',receipt=? WHERE id=? AND status='pending'").run(receipt.transactionId,order.id);
    }
    if (!entitled(user,versionId)) reject(403,'课程权益已撤销');
    return {orderId:order.id,courseId,versionId,status:'confirmed'};
  }
  function checkMode(user,course,mode) {
    if (!entitled(user,course.versionId) || !course.permittedDeliveryModes.includes(mode)) reject(403,'未获得此工作区的权益');
  }
  async function start(user,{courseId,versionId,mode}) {
    const course = lookup(courseId,versionId);
    checkMode(user,course,mode);
    db.prepare("INSERT INTO kx_runs VALUES(?,?,?,0,'[]',NULL) ON CONFLICT(user,version) DO NOTHING").run(randomUUID(),user,versionId);
    const row = db.prepare('SELECT * FROM kx_runs WHERE user=? AND version=?').get(user,versionId);
    const run = {id:row.id,revision:row.revision,course,mode,completed:JSON.parse(row.completed),work:mode === 'CANVAS' && row.canvas ? JSON.parse(row.canvas) : null};
    run.generationModes = mode === 'CANVAS' && quoteGeneration && generateOrLookup ? (course.modelPolicy || []).map(item => item.modality) : [];
    if (mode === 'VIBECODING') {
      if (!issueRuntimeTicket) reject(503,'VibeCoding 运行服务待接入');
      run.runtimeTicket = await issueRuntimeTicket({runId:row.id,userId:user,courseId,versionId,mode});
      if (typeof run.runtimeTicket !== 'string' || !/^[A-Za-z0-9_-]{24,512}$/.test(run.runtimeTicket)) reject(503,'运行授权暂不可用');
    }
    return run;
  }
  function save(user,{id,revision,mode,completed,work}) {
    return transaction(() => {
      const row = db.prepare('SELECT course,version,canvas FROM kx_runs JOIN kx_versions USING(version) WHERE id=? AND user=?').get(id,user);
      if (!row) reject(403,'运行实例不可用');
      const course = lookup(row.course,row.version);
      checkMode(user,course,mode);
      if (!Array.isArray(completed) || completed.some(id => !course.steps.some(step => step.id === id))) reject(400,'步骤不属于此版本');
      if (mode === 'CANVAS' && (!Array.isArray(work?.nodes) || !Array.isArray(work.edges))) reject(400,'画布快照无效');
      const updated = db.prepare('UPDATE kx_runs SET completed=?,canvas=?,revision=revision+1 WHERE id=? AND revision=?')
        .run(JSON.stringify([...new Set(completed)]),mode === 'CANVAS' ? JSON.stringify(work) : row.canvas,id,revision);
      if (!updated.changes) reject(409,'已有更新的学习进度');
      db.prepare('INSERT OR IGNORE INTO kx_workspaces_saved VALUES(?,?)').run(id,mode);
      return {revision:revision+1};
    });
  }
  function works(user) {
    return db.prepare(`SELECT course courseId, version versionId, body, completed, mode FROM kx_runs
      JOIN kx_versions USING(version) JOIN kx_workspaces_saved ON kx_runs.id=kx_workspaces_saved.run
      JOIN kx_orders USING(version,user) WHERE user=? AND kx_orders.status='confirmed' ORDER BY kx_runs.rowid DESC`).all(user)
      .map(row => {
        const course = JSON.parse(row.body);
        return {courseId:row.courseId, versionId:row.versionId, title:course.title, mode:row.mode, completed:JSON.parse(row.completed).length, total:course.steps.length};
      });
  }
  function generationContext(user,runId) {
    const row = db.prepare('SELECT body FROM kx_runs JOIN kx_versions USING(version) WHERE id=? AND user=?').get(runId,user);
    if (!row) reject(403,'课程工作区不可用');
    const course = JSON.parse(row.body);
    checkMode(user,course,'CANVAS');
    if (!quoteGeneration || !generateOrLookup) reject(503,'模型计费服务待接入');
    return {userId:user,runId,versionId:course.versionId,courseId:course.id,models:course.modelPolicy || []};
  }
  async function quote(user,{id,nodeId,modality,input}) {
    const context = generationContext(user,id);
    const modelId = context.models.find(item => item.modality === modality)?.modelId;
    if (!modelId) reject(403,'本课未开放此模型');
    if (typeof nodeId !== 'string' || !nodeId || nodeId.length > 150 || !input || typeof input !== 'object' || Array.isArray(input)) reject(400,'生成参数无效');
    const pending = db.prepare("SELECT id,quote FROM kx_generation WHERE run=? AND node=? AND status='submitted'").get(id,nodeId);
    if (pending) return {id:pending.id,points:JSON.parse(pending.quote).points,pending:true};
    const jobId = randomUUID();
    const job = {jobId,userId:user,runId:id,versionId:context.versionId,courseId:context.courseId,nodeId,modality,modelId,input};
    const offer = await quoteGeneration(job);
    if (!offer?.quoteId || !Number.isSafeInteger(offer.points) || offer.points < 0 || !Number.isSafeInteger(offer.expiresAt) || offer.expiresAt <= Date.now()) reject(503,'报价暂不可用');
    db.prepare("INSERT INTO kx_generation VALUES(?,?,?,?,?,?,'quoted',NULL)").run(jobId,id,nodeId,user,JSON.stringify(job),JSON.stringify(offer));
    return {id:jobId,points:offer.points,modelId,expiresAt:offer.expiresAt};
  }
  async function generate(user,{id,jobId}) {
    generationContext(user,id);
    const row = transaction(() => {
      const job = db.prepare('SELECT * FROM kx_generation WHERE id=? AND run=? AND user=?').get(jobId,id,user);
      if (!job) reject(403,'生成授权无效');
      if (job.status === 'failed') reject(409,'生成失败，已释放费用');
      if (job.status === 'quoted') {
        if (JSON.parse(job.quote).expiresAt <= Date.now()) reject(409,'报价已过期');
        if (db.prepare("SELECT id FROM kx_generation WHERE run=? AND node=? AND status='submitted'").get(id,job.node)) reject(409,'节点已有生成任务');
        db.prepare("UPDATE kx_generation SET status='submitted' WHERE id=?").run(jobId);
      }
      return job;
    });
    if (row.status === 'complete') return JSON.parse(row.result);
    // Gateway reserves/settles by jobId and returns the same terminal outcome on replay.
    const result = await generateOrLookup(JSON.parse(row.input),JSON.parse(row.quote));
    if (result?.status === 'released' && result.jobId === jobId) {
      db.prepare("UPDATE kx_generation SET status='failed' WHERE id=? AND status='submitted'").run(jobId);
      reject(409,'生成失败，已释放费用');
    }
    if (result?.jobId !== jobId || result?.status !== 'settled' || !result.transactionId || !result.asset) reject(503,'生成结算待确认');
    db.prepare("UPDATE kx_generation SET status='complete',result=? WHERE id=? AND status='submitted'").run(JSON.stringify(result.asset),jobId);
    return result.asset;
  }
  function hasRuntimeAccess({userId,runId,versionId,courseId,mode}) {
    const row = db.prepare('SELECT body FROM kx_runs JOIN kx_versions USING(version) WHERE id=? AND user=? AND version=? AND course=?').get(runId,userId,versionId,courseId);
    return Boolean(row && entitled(userId,versionId) && JSON.parse(row.body).permittedDeliveryModes.includes(mode));
  }
  // Call only after the main site's authenticated refund/reconciliation handler verifies its receipt.
  function revoke(orderId,transactionId) {
    return db.prepare("UPDATE kx_orders SET status='revoked' WHERE id=? AND receipt=? AND status='confirmed'").run(orderId,transactionId).changes;
  }
  return {catalog,detail,publish,hide,listGrants,purchase,start,save,works,quote,generate,revoke,hasRuntimeAccess,close:()=>db.close()};
}

