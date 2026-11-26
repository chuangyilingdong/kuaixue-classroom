import {generationModes,generationBinding} from './generation-binding.mjs';
import {DatabaseSync} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import versioning from '../../electron/course-version.cjs';
import {
  defaultCatalogCategories,
  defaultCourseCategories,
  catalogEntriesForCategories,
  validateCourseCategories,
} from '../../shared/catalog-categories.mjs';
import { readSnapshotPreview } from '../../shared/work-preview.mjs';

export class CourseProblem extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const reject = (status, message) => { throw new CourseProblem(status, message); };
function runtimeModelIds(course) {
  const declared=Array.isArray(course.vibeModelIds)?course.vibeModelIds:[];
  const legacy=(Array.isArray(course.modelLabels)?course.modelLabels:[])
    .filter(id=>typeof id==='string'&&/^aicyld-runninghub-llm-(?:cn|global)::[A-Za-z0-9._/:+-]+$/.test(id));
  return [...new Set([...declared,...legacy])];
}

// Staging/one-node deployment. The main site owns every wallet debit and refund.
export function openCoursePlatform(filename, {debitOrLookup, issueRuntimeTicket, issueLocalModelGrant, uploadLocalSnapshot,
  downloadLocalSnapshot, quoteGeneration, generateOrLookup, assetRoot = null, maxAssetBytes = 50 * 1024 * 1024,
  maxSnapshotBytes = 64 * 1024 * 1024} = {}) {
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=4000;
    CREATE TABLE IF NOT EXISTS kx_versions (version TEXT PRIMARY KEY, course TEXT NOT NULL, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS kx_listings (course TEXT PRIMARY KEY, version TEXT NOT NULL, visible INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS kx_orders (id TEXT PRIMARY KEY, user TEXT NOT NULL, version TEXT NOT NULL,
      price INTEGER NOT NULL, status TEXT NOT NULL, receipt TEXT UNIQUE, UNIQUE(user,version));
    CREATE TABLE IF NOT EXISTS kx_runs (id TEXT PRIMARY KEY, user TEXT NOT NULL, version TEXT NOT NULL,
      revision INTEGER NOT NULL, completed TEXT NOT NULL, canvas TEXT, UNIQUE(user,version));
    CREATE TABLE IF NOT EXISTS kx_workspaces_saved (run TEXT NOT NULL, mode TEXT NOT NULL, PRIMARY KEY(run,mode));
    CREATE TABLE IF NOT EXISTS kx_catalog_settings (id INTEGER PRIMARY KEY, revision INTEGER NOT NULL, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS kx_generation (id TEXT PRIMARY KEY, run TEXT NOT NULL, node TEXT NOT NULL, user TEXT NOT NULL,
      input TEXT NOT NULL, quote TEXT NOT NULL, status TEXT NOT NULL, result TEXT, provider_task TEXT);
    CREATE TABLE IF NOT EXISTS kx_assets (id TEXT PRIMARY KEY, user TEXT NOT NULL, run TEXT NOT NULL,
      name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, kind TEXT NOT NULL, object_key TEXT NOT NULL,
      created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE UNIQUE INDEX IF NOT EXISTS kx_pending_node ON kx_generation(run,node) WHERE status='submitted';
    CREATE TABLE IF NOT EXISTS kx_audit (actor TEXT NOT NULL, action TEXT NOT NULL, version TEXT NOT NULL, at TEXT DEFAULT CURRENT_TIMESTAMP);`);
  if(!db.prepare('PRAGMA table_info(kx_generation)').all().some(column=>column.name==='provider_task'))
    db.exec('ALTER TABLE kx_generation ADD COLUMN provider_task TEXT');
  const inFlightGenerations=new Map();
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {const value = fn(); db.exec('COMMIT'); return value;}
    catch (error) {db.exec('ROLLBACK'); throw error;}
  }
  function normalizeCourseCategories(course) {
    const modes = Array.isArray(course.permittedDeliveryModes) && course.permittedDeliveryModes.length
      ? course.permittedDeliveryModes
      : [course.type];
    const categories = Array.isArray(course.categories)
      ? [...new Set(course.categories.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim()))]
      : [
        ...modes.map(mode => mode === 'CANVAS' ? '画布课程' : mode === 'VIBECODING' ? 'VibeCoding' : ''),
        typeof course.category === 'string' ? course.category.trim() : '',
      ].filter(Boolean);
    return { ...course, categories, category: course.category || categories[0] || '' };
  }
  function catalog(includeHidden = false) {
    return db.prepare(`SELECT body,visible FROM kx_listings JOIN kx_versions USING(version) ${includeHidden ? '' : 'WHERE visible=1'} ORDER BY kx_listings.rowid`).all()
      .map(row => ({...normalizeCourseCategories(JSON.parse(row.body)), visible:Boolean(row.visible)}));
  }
  function catalogCategories() {
    const row = db.prepare('SELECT revision,body FROM kx_catalog_settings WHERE id=1').get();
    if (!row) return {
      revision: 0,
      items: defaultCatalogCategories.map(item => ({ ...item })),
      courseCategories: [...defaultCourseCategories],
      categories: [...defaultCourseCategories],
    };
    const stored = JSON.parse(row.body);
    const body = Array.isArray(stored) ? { items: stored } : stored;
    const legacyItems = Array.isArray(body.items) ? body.items : [];
    const categoryNames = [
      ...legacyItems.map(item => item?.mode ? item.label : item?.category || item?.label),
      ...(Array.isArray(body.courseCategories) ? body.courseCategories : defaultCourseCategories),
    ].filter(value => typeof value === 'string' && value.trim());
    const courseCategories = [...new Set(categoryNames.map(value => value.trim()))];
    const canonical = {
      items: catalogEntriesForCategories(courseCategories),
      courseCategories,
    };
    if (JSON.stringify(stored) !== JSON.stringify(canonical)) {
      db.prepare('UPDATE kx_catalog_settings SET body=? WHERE id=1').run(JSON.stringify(canonical));
    }
    return {
      revision: row.revision,
      items: canonical.items,
      courseCategories,
      categories: [...courseCategories],
    };
  }
  function saveCatalogCategories(actor, { revision, categories, courseCategories, items } = {}) {
    const current = catalogCategories();
    let managedCourseCategories;
    try {
      const values = Array.isArray(categories)
        ? categories
        : Array.isArray(courseCategories)
          ? courseCategories
          : Array.isArray(items)
            ? items.map(item => item?.mode ? item.label : item?.category || item?.label)
            : current.courseCategories;
      managedCourseCategories = validateCourseCategories(values);
    } catch (error) { reject(400, error.message); }
    return transaction(() => {
      if (catalogCategories().revision !== revision) reject(409, '课程分类已更新，请刷新后重试');
      db.prepare('INSERT OR REPLACE INTO kx_catalog_settings VALUES(1,?,?)')
        .run(revision + 1, JSON.stringify({
          items: catalogEntriesForCategories(managedCourseCategories),
          courseCategories: managedCourseCategories,
        }));
      db.prepare('INSERT INTO kx_audit(actor,action,version) VALUES(?,?,?)').run(actor, 'categories', String(revision + 1));
      return catalogCategories();
    });
  }
  function lookup(courseId,versionId) {
    const row = db.prepare('SELECT body FROM kx_versions WHERE course=? AND version=?').get(courseId, versionId);
    if (!row) reject(404,'找不到课程版本');
    return normalizeCourseCategories(JSON.parse(row.body));
  }
  function publish(actor, draft) {
    return transaction(() => {
      let base;
      if (draft.id || draft.baseVersion) {
        if (!draft.id || !draft.baseVersion || db.prepare('SELECT version FROM kx_listings WHERE course=?').get(draft.id)?.version !== draft.baseVersion) reject(409,'课程已更新，请刷新后再发布');
        base = lookup(draft.id,draft.baseVersion);
      }
      const categoriesConfigured = Boolean(db.prepare('SELECT id FROM kx_catalog_settings WHERE id=1').get());
      const managedCategories = catalogCategories().courseCategories;
      let categories;
      try {
        const requested = Array.isArray(draft.categories)
          ? draft.categories
          : Array.isArray(base?.categories)
            ? base.categories
            : draft.category || base?.category
              ? [draft.category || base.category]
              : [];
        categories = requested.length ? validateCourseCategories(requested) : [];
      } catch (error) {
        reject(400, error.message);
      }
      if (!categoriesConfigured && !categories.length)
        categories = [String(draft.category || base?.category || '创作实训')];
      if (categoriesConfigured && !categories.length)
        reject(400, '请至少选择一个客户端分类');
      if (categoriesConfigured && categories.some(category => !managedCategories.includes(category)))
        reject(400, '课程分类已停用，请从后台课程分类列表中重新选择');
      let course;
      try { course = versioning.buildCourseVersion(draft,base); } catch (error) { reject(400,error.message); }
      course.categories = categories;
      course.category = categories[0];
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
  function entitledCourse(user,courseId) {
    return Boolean(db.prepare(`SELECT kx_orders.id FROM kx_orders JOIN kx_versions USING(version)
      WHERE kx_orders.user=? AND kx_versions.course=? AND kx_orders.status='confirmed' LIMIT 1`).get(user,courseId));
  }
  function entitled(user,version) {
    const row = db.prepare('SELECT course FROM kx_versions WHERE version=?').get(version);
    return Boolean(row && entitledCourse(user,row.course));
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
      if (entitledCourse(user,courseId)) return existing?.status === 'confirmed'
        ? existing
        : {id:null,status:'confirmed',price:0,inherited:true};
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
    return {orderId:order.id,courseId,versionId,status:'confirmed',...(order.inherited?{inherited:true}:{})};
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
    run.generationModes = mode === 'CANVAS' && quoteGeneration && generateOrLookup ? generationModes(course) : [];
    if (mode === 'VIBECODING' && issueRuntimeTicket) {
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
    const rows=db.prepare(`SELECT kx_runs.id, course courseId, version versionId, body, completed, mode FROM kx_runs
      JOIN kx_versions USING(version) JOIN kx_workspaces_saved ON kx_runs.id=kx_workspaces_saved.run
      WHERE kx_runs.user=? AND EXISTS (
        SELECT 1 FROM kx_orders JOIN kx_versions entitled_version ON entitled_version.version=kx_orders.version
        WHERE kx_orders.user=kx_runs.user AND kx_orders.status='confirmed'
          AND entitled_version.course=kx_versions.course
      ) ORDER BY kx_runs.rowid DESC`).all(user);
    const latest=new Map();
    for(const row of rows)if(!latest.has(`${row.courseId}:${row.mode}`))latest.set(`${row.courseId}:${row.mode}`,row);
    return [...latest.values()]
      .map(row => {
        const course = JSON.parse(row.body);
        return {id:row.id, courseId:row.courseId, versionId:row.versionId, title:course.title,
          thumbnailUrl:course.thumbnailUrl || null, mode:row.mode, completed:JSON.parse(row.completed).length, total:course.steps.length};
      });
  }
  async function workPreview(user, { courseId, versionId, mode }) {
    const course = lookup(courseId, versionId);
    checkMode(user, course, mode);
    const row = db.prepare(`SELECT kx_runs.id,canvas FROM kx_runs JOIN kx_workspaces_saved ON kx_runs.id=kx_workspaces_saved.run
      WHERE user=? AND version=? AND mode=?`).get(user, versionId, mode);
    if (!row) reject(404, '找不到已保存的作品');
    if (mode === 'CANVAS') return { mode, work: row.canvas ? JSON.parse(row.canvas) : { nodes: [], edges: [] } };
    const snapshot = await downloadLocalSnapshotRecord(user, { runId: row.id });
    return { mode, files: await readSnapshotPreview(snapshot.bytes) };
  }
  function generationContext(user,runId) {
    const row = db.prepare('SELECT body FROM kx_runs JOIN kx_versions USING(version) WHERE id=? AND user=?').get(runId,user);
    if (!row) reject(403,'课程工作区不可用');
    const course = JSON.parse(row.body);
    checkMode(user,course,'CANVAS');
    if (!quoteGeneration || !generateOrLookup) reject(503,'模型计费服务待接入');
    return course;
  }
  async function uploadAsset(user,{runId,fileName,mime,kind,bytes}) {
    if (!assetRoot) reject(503,'课程素材存储待接入');
    const row = db.prepare('SELECT body FROM kx_runs JOIN kx_versions USING(version) WHERE id=? AND user=?').get(runId,user);
    if (!row) reject(403,'课程工作区不可用');
    const course = JSON.parse(row.body);
    checkMode(user,course,'CANVAS');
    const allowed = {
      image: new Set(['image/jpeg','image/png','image/webp','image/gif']),
      video: new Set(['video/mp4','video/webm','video/quicktime']),
      audio: new Set(['audio/mpeg','audio/mp4','audio/aac','audio/ogg','audio/wav','audio/webm']),
    };
    if (!allowed[kind]?.has(mime)) reject(415,'不支持的素材类型');
    if (!Buffer.isBuffer(bytes) || !bytes.length) reject(400,'素材为空');
    if (bytes.length > maxAssetBytes) reject(413,'素材超出大小限制');
    if (typeof fileName !== 'string' || !fileName.trim() || fileName.length > 180) reject(400,'素材文件名无效');
    const digest = createHash('sha256').update(bytes).digest('hex');
    const extension = {
      'image/jpeg':'.jpg','image/png':'.png','image/webp':'.webp','image/gif':'.gif',
      'video/mp4':'.mp4','video/webm':'.webm','video/quicktime':'.mov',
      'audio/mpeg':'.mp3','audio/mp4':'.m4a','audio/aac':'.aac','audio/ogg':'.ogg','audio/wav':'.wav','audio/webm':'.weba',
    }[mime];
    const objectKey = `${digest.slice(0,2)}/${digest}${extension}`;
    const directory = join(assetRoot,digest.slice(0,2));
    await mkdir(directory,{recursive:true,mode:0o750});
    const target = join(assetRoot,objectKey);
    await writeFile(target,bytes,{flag:'wx',mode:0o640}).catch(error=>{if(error.code!=='EEXIST')throw error;});
    const id = randomUUID();
    db.prepare('INSERT INTO kx_assets(id,user,run,name,mime,size,kind,object_key) VALUES(?,?,?,?,?,?,?,?)')
      .run(id,user,runId,fileName.trim(),mime,bytes.length,kind,objectKey);
    return {id,name:fileName.trim(),mime,size:bytes.length,kind,
      assetUrl:`/api/v1/course-assets/${id}`,previewUrl:`/api/v1/course-assets/${id}`};
  }
  async function localRuntime(user,{id}) {
    const row = db.prepare('SELECT body FROM kx_runs JOIN kx_versions USING(version) WHERE id=? AND user=?').get(id,user);
    if (!row) reject(403,'课程工作区不可用');
    const course = JSON.parse(row.body);
    checkMode(user,course,'VIBECODING');
    if (!issueLocalModelGrant) reject(503,'本机模型授权待主站接入');
    const allowed = new Set(runtimeModelIds(course));
    if (!allowed.size) reject(503,'课程版本尚未配置本机模型');
    const rawUsageLimit = Number(course.classroomConfig?.vibeCoding?.usageLimit ?? 0);
    const usageLimit = Number.isSafeInteger(rawUsageLimit) && rawUsageLimit >= 0
      ? Math.min(1000000, rawUsageLimit)
      : 0;
    const context = {userId:user,runId:id,courseId:course.id,versionId:course.versionId,mode:'VIBECODING',
      modelIds:[...allowed],usageLimit};
    const grant = await issueLocalModelGrant(context);
    let base;
    try {base = new URL(grant?.baseUrl);} catch {reject(503,'本机模型授权无效');}
    if (!(base.protocol === 'https:' || base.protocol === 'http:' && ['127.0.0.1','localhost'].includes(base.hostname)) ||
        typeof grant?.token !== 'string' || !grant.token || !Number.isSafeInteger(grant.expiresAt) ||
        grant.expiresAt <= Date.now() || !Array.isArray(grant.modelIds) || !grant.modelIds.length ||
        grant.modelIds.length !== allowed.size ||
        grant.modelIds.some(model => typeof model !== 'string' || !allowed.has(model))) {
      reject(503,'本机模型授权无效');
    }
    const remaining=Number.isSafeInteger(grant.usageRemaining)?grant.usageRemaining:null;
    if(!Number.isSafeInteger(grant.usageLimit)||grant.usageLimit<0||
        !Number.isSafeInteger(grant.usageUsed)||grant.usageUsed<0||
        (grant.usageLimit>0&&(!Number.isSafeInteger(remaining)||remaining<0||remaining>grant.usageLimit))) {
      reject(503,'本机模型使用额度无效');
    }
    return {
      runId:id,
      userId:user,
      presets:course.classroomConfig?.vibeCoding?.presetPrompts || [],
      modelGateway:{baseUrl:base.href,token:grant.token,modelIds:grant.modelIds,expiresAt:grant.expiresAt,
        usage:{limit:grant.usageLimit,used:grant.usageUsed,remaining:grant.usageLimit===0?null:remaining}},
    };
  }
  async function uploadLocalSnapshotRecord(user,{runId,baseRevision,sha256,bytes}) {
    const row = db.prepare('SELECT body FROM kx_runs JOIN kx_versions USING(version) WHERE id=? AND user=?').get(runId,user);
    if (!row) reject(403,'课程工作区不可用');
    const course = JSON.parse(row.body);
    checkMode(user,course,'VIBECODING');
    if (!uploadLocalSnapshot) reject(503,'云端工程快照存储待接入');
    if (!Number.isSafeInteger(baseRevision) || baseRevision < 0 || !/^[a-f0-9]{64}$/.test(sha256) ||
        !Buffer.isBuffer(bytes) || !bytes.length) reject(400,'工程快照参数无效');
    if (bytes.length > maxSnapshotBytes) reject(413,'工程快照超出大小限制');
    const data = await uploadLocalSnapshot({userId:user,runId, courseId:course.id, versionId:course.versionId,
      mode:'VIBECODING',baseRevision,sha256,bytes});
    if (data?.runId !== runId || !Number.isSafeInteger(data.revision) || data.revision < 1 ||
        data.sha256 !== sha256 || !Number.isSafeInteger(data.bytes) || data.bytes !== bytes.length ||
        typeof data.capturedAt !== 'string' || Number.isNaN(Date.parse(data.capturedAt))) {
      reject(503,'云端工程快照上传结果待确认');
    }
    return {runId, revision:data.revision, sha256:data.sha256, bytes:data.bytes, capturedAt:data.capturedAt};
  }
  async function downloadLocalSnapshotRecord(user,{runId}) {
    const row = db.prepare('SELECT body FROM kx_runs JOIN kx_versions USING(version) WHERE id=? AND user=?').get(runId,user);
    if (!row) reject(403,'课程工作区不可用');
    const course = JSON.parse(row.body);
    checkMode(user,course,'VIBECODING');
    if (!downloadLocalSnapshot) reject(503,'云端工程快照存储待接入');
    const data = await downloadLocalSnapshot({userId:user,runId,courseId:course.id,versionId:course.versionId,
      mode:'VIBECODING'});
    if (!Buffer.isBuffer(data?.bytes) || !data.bytes.length || !Number.isSafeInteger(data.revision) ||
        data.revision < 1 || !/^[a-f0-9]{64}$/.test(data.sha256) || typeof data.capturedAt !== 'string' ||
        Number.isNaN(Date.parse(data.capturedAt))) reject(503,'云端工程快照下载结果待确认');
    if (data.bytes.length > maxSnapshotBytes) reject(413,'工程快照超出大小限制');
    return data;
  }
  function asset(user,id) {
    const row = db.prepare('SELECT * FROM kx_assets WHERE id=? AND user=?').get(id,user);
    if (!row) reject(404,'素材不存在');
    if (!assetRoot) reject(503,'课程素材存储待接入');
    return {...row,path:join(assetRoot,row.object_key)};
  }
  function assetById(id) {
    const row = db.prepare('SELECT * FROM kx_assets WHERE id=?').get(id);
    if (!row) reject(404,'素材不存在');
    if (!assetRoot) reject(503,'课程素材存储待接入');
    return {...row,path:join(assetRoot,row.object_key)};
  }
  async function quote(user,{id,nodeId,modality,input,preview=false}) {
    const course = generationContext(user,id);
    if (typeof nodeId !== 'string' || !nodeId || nodeId.length > 150 || !input || typeof input !== 'object' || Array.isArray(input)) reject(400,'生成参数无效');
    const binding = generationBinding(course,nodeId,modality,input);
    if (!binding) reject(403,'本课未开放此框体的模型');
    const {modelId} = binding;
    const pending = db.prepare("SELECT id,quote FROM kx_generation WHERE run=? AND node=? AND status='submitted'").get(id,nodeId);
    if (pending) return {id:pending.id,points:JSON.parse(pending.quote).points,pending:true};
    const jobId = randomUUID();
    const job = {jobId,userId:user,runId:id,versionId:course.versionId,courseId:course.id,nodeId,modality,
      modelId,modelLabel:binding.modelLabel || '',input:binding.input};
    const offer = await quoteGeneration(job);
    if (!offer?.quoteId || !Number.isSafeInteger(offer.points) || offer.points < 0 || !Number.isSafeInteger(offer.expiresAt) || offer.expiresAt <= Date.now()) reject(503,'报价暂不可用');
    if (preview === true) return {id:null,points:offer.points,modelId,expiresAt:offer.expiresAt,preview:true};
    db.prepare("INSERT INTO kx_generation(id,run,node,user,input,quote,status,result) VALUES(?,?,?,?,?,?,'quoted',NULL)")
      .run(jobId,id,nodeId,user,JSON.stringify(job),JSON.stringify(offer));
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
    if (inFlightGenerations.has(jobId)) return inFlightGenerations.get(jobId);
    // Gateway reserves/settles by jobId and returns the same terminal outcome on replay.
    const running=(async()=>{
      let result;
      try {
        result = await generateOrLookup(JSON.parse(row.input),JSON.parse(row.quote),{
          providerTaskId:row.provider_task||'',
          onProviderTask:taskId=>db.prepare("UPDATE kx_generation SET provider_task=? WHERE id=? AND status='submitted'").run(taskId,jobId),
        });
      } catch (error) {
        if(error?.definitive===true){
          db.prepare("UPDATE kx_generation SET status='failed' WHERE id=? AND status='submitted'").run(jobId);
          reject(409,error.message||'生成失败，已释放费用');
        }
        if (error instanceof CourseProblem || Number.isInteger(error?.status)) throw error;
        reject(502,error?.message || '模型生成失败');
      }
      if (result?.status === 'released' && result.jobId === jobId) {
        db.prepare("UPDATE kx_generation SET status='failed' WHERE id=? AND status='submitted'").run(jobId);
        reject(409,'生成失败，已释放费用');
      }
      if (result?.jobId !== jobId || result?.status !== 'settled' || !result.transactionId || !result.asset) reject(503,'生成结算待确认');
      db.prepare("UPDATE kx_generation SET status='complete',result=? WHERE id=? AND status='submitted'").run(JSON.stringify(result.asset),jobId);
      return result.asset;
    })();
    inFlightGenerations.set(jobId,running);
    try {
      return await running;
    } finally {
      inFlightGenerations.delete(jobId);
    }
  }
  async function generationState(user,{id,nodeId}) {
    generationContext(user,id);
    if(typeof nodeId!=='string'||!nodeId.trim()||nodeId.length>150)reject(400,'生成节点无效');
    const row=db.prepare(`SELECT id,status,provider_task,result FROM kx_generation
      WHERE run=? AND node=? AND user=? ORDER BY rowid DESC LIMIT 1`).get(id,nodeId,user);
    if(!row)return {jobId:null,status:'NONE',asset:null};
    return {
      jobId:row.id,
      status:String(row.status||'').toUpperCase(),
      providerTaskId:row.provider_task||'',
      asset:row.status==='complete'&&row.result?JSON.parse(row.result):null,
    };
  }
  function hasRuntimeAccess({userId,runId,versionId,courseId,mode}) {
    const row = db.prepare('SELECT body FROM kx_runs JOIN kx_versions USING(version) WHERE id=? AND user=? AND version=? AND course=?').get(runId,userId,versionId,courseId);
    return Boolean(row && entitledCourse(userId,courseId) && JSON.parse(row.body).permittedDeliveryModes.includes(mode));
  }
  // Call only after the main site's authenticated refund/reconciliation handler verifies its receipt.
  function revoke(orderId,transactionId) {
    return db.prepare("UPDATE kx_orders SET status='revoked' WHERE id=? AND receipt=? AND status='confirmed'").run(orderId,transactionId).changes;
  }
  return {catalog,catalogCategories,saveCatalogCategories,detail,publish,hide,listGrants,purchase,start,save,works,workPreview,quote,generate,generationState,uploadAsset,asset,assetById,
    localRuntime,uploadLocalSnapshot:uploadLocalSnapshotRecord,downloadLocalSnapshot:downloadLocalSnapshotRecord,
    revoke,hasRuntimeAccess,close:()=>db.close()};
}

