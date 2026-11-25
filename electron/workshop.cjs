// Offline acceptance environment. This database contains only the device's demo learner.
const { DatabaseSync } = require('node:sqlite');
const { randomUUID } = require('node:crypto');
const seed = require('../data/course-catalog.demo.json');

const {buildCourseVersion, deliveryModes} = require('./course-version.cjs');
function selectedMode(course, mode) {
  const modes = deliveryModes(course.permittedDeliveryModes);
  const selected = mode ?? (modes.length === 1 ? modes[0] : null);
  if (!modes.includes(selected)) throw new Error('此版本未开放所选工作区');
  return selected;
}
function readRunState(row, course) {
  const saved = JSON.parse(row.state);
  return {completed:saved.completed, works:saved.works ?? {[course.type]:saved.work}};
}
function createWorkshop(filename) {
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=4000;
    CREATE TABLE IF NOT EXISTS versions (version TEXT PRIMARY KEY, course TEXT NOT NULL, body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS listings (course TEXT PRIMARY KEY, version TEXT NOT NULL, visible INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS purchases (version TEXT PRIMARY KEY, price INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, version TEXT UNIQUE NOT NULL, revision INTEGER NOT NULL, state TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS setup (id INTEGER PRIMARY KEY);`);
  function transaction(work) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = work(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function putVersion(course) {
    db.prepare('INSERT INTO versions VALUES(?,?,?)').run(course.versionId, course.id, JSON.stringify(course));
    db.prepare('INSERT OR REPLACE INTO listings VALUES(?,?,1)').run(course.id, course.versionId);
  }
  transaction(() => {
    if (db.prepare('SELECT id FROM setup').get()) {
      const dual = seed.find(course => course.id === 'story-to-interactive-page');
      if (!db.prepare('SELECT course FROM listings WHERE course=?').get(dual.id)) putVersion(dual);
      for (const demo of seed) {
        const stored=db.prepare('SELECT body FROM versions WHERE course=? AND version=?').get(demo.id,demo.versionId);
        if (!stored) continue;
        const previous=JSON.parse(stored.body);
        if (previous.materialGroups === undefined && previous.classroomConfig === undefined) {
          db.prepare('UPDATE versions SET body=? WHERE version=?').run(JSON.stringify({...previous,materialGroups:demo.materialGroups ?? [],classroomConfig:demo.classroomConfig ?? {}}),demo.versionId);
        }
      }
      return;
    }
    seed.forEach(putVersion);
    db.prepare('INSERT INTO purchases VALUES(?,0)').run('demo-storyboard-v1');
    db.exec('INSERT INTO setup VALUES(1)');
  });
  function catalog(includeHidden = false) {
    return db.prepare(`SELECT body, visible FROM listings JOIN versions USING(version) ${includeHidden ? '' : 'WHERE visible=1'} ORDER BY listings.rowid`).all().map(row => ({...JSON.parse(row.body), visible: !!row.visible}));
  }
  function detail(id, version) {
    const row = db.prepare('SELECT body FROM versions WHERE course=? AND version=?').get(id, version);
    if (!row) throw new Error('找不到此课程版本');
    return JSON.parse(row.body);
  }
  function publish(draft) {
    return transaction(() => {
      const base = draft.baseVersion ? detail(draft.id, draft.baseVersion) : {};
      if (draft.baseVersion && db.prepare('SELECT version FROM listings WHERE course=?').get(draft.id)?.version !== draft.baseVersion) throw new Error('课程已有新版本，请重新选课编辑');
      const course = buildCourseVersion(draft, base);
      putVersion(course);
      return course;
    });
  }
  function account() {
    const rows = db.prepare('SELECT purchases.price, versions.course, purchases.version, versions.body FROM purchases JOIN versions USING(version)').all();
    return {user:{id:'preview-learner', name:'演示学员'}, demo:true, points:360 - rows.reduce((sum,row) => sum + row.price,0),
      entitlements:rows.map(row => ({courseId:row.course,versionId:row.version,status:'active', title:JSON.parse(row.body).title}))};
  }
  function purchase(courseId, version) {
    return transaction(() => {
      const course = detail(courseId,version);
      if (db.prepare('SELECT version FROM purchases WHERE version=?').get(version)) return account();
      if (!db.prepare('SELECT version FROM listings WHERE version=? AND visible=1').get(version)) throw new Error('课程版本已更新或下架，请刷新目录');
      if (course.unlockPricePoints > account().points) throw new Error('演示积分不足');
      db.prepare('INSERT INTO purchases VALUES(?,?)').run(version,course.unlockPricePoints);
      return account();
    });
  }
  function start(courseId, version, mode) {
    return transaction(() => {
      const course = detail(courseId, version);
      if (!db.prepare('SELECT version FROM purchases WHERE version=?').get(version)) throw new Error('请先解锁此课程版本');
      const selected = selectedMode(course, mode);
      let run = db.prepare('SELECT * FROM runs WHERE version=?').get(version);
      if (!run) {
        run = {id:randomUUID(),version,revision:0,state:JSON.stringify({completed:[],works:{}})};
        db.prepare('INSERT INTO runs VALUES(?,?,?,?)').run(run.id,version,0,run.state);
      }
      const state = readRunState(run, course);
      return {id:run.id,revision:run.revision,course,mode:selected,completed:state.completed,work:state.works[selected] ?? null};
    });
  }
  function save({id,revision,completed,work,mode}) {
    return transaction(() => {
      const row = db.prepare('SELECT body,state FROM runs JOIN versions USING(version) JOIN purchases USING(version) WHERE runs.id=?').get(id);
      if (!row) throw new Error('课程运行实例不可用');
      const course = JSON.parse(row.body);
      if (!Array.isArray(completed) || completed.some(step => !course.steps.some(s => s.id === step))) throw new Error('步骤不属于此版本');
      const selected = selectedMode(course, mode);
      if (selected === 'CANVAS' ? !(Array.isArray(work?.nodes) && Array.isArray(work?.edges)) : typeof work !== 'string') throw new Error('作品格式不正确');
      const state = JSON.stringify({completed:[...new Set(completed)],works:{...readRunState(row,course).works,[selected]:work}});
      if (Buffer.byteLength(state) > 4000000) throw new Error('作品超过 4 MB');
      const result = db.prepare('UPDATE runs SET state=?, revision=revision+1 WHERE id=? AND revision=?').run(state,id,revision);
      if (!result.changes) throw new Error('作品已在其他窗口修改，请重新打开');
      return revision + 1;
    });
  }
  function works() {
    const rows = db.prepare('SELECT runs.id, revision, body, state FROM runs JOIN purchases USING(version) JOIN versions USING(version) WHERE revision>0 ORDER BY runs.rowid DESC').all();
    return rows.flatMap(row => {
      const course = JSON.parse(row.body);
      const saved = readRunState(row,course);
      return course.permittedDeliveryModes.filter(mode => saved.works[mode] != null).map(mode => ({
        id:row.id,courseId:course.id,versionId:course.versionId,title:course.title,thumbnailUrl:course.thumbnailUrl || null,
        mode,completed:saved.completed.length,total:course.steps.length,
      }));
    });
  }
  function workPreview({courseId,versionId,mode}) {
    const row = db.prepare(`SELECT body,state FROM runs JOIN purchases USING(version) JOIN versions USING(version)
      WHERE versions.course=? AND version=? AND revision>0`).get(courseId,versionId);
    if (!row) throw new Error('找不到已保存的作品');
    const course = JSON.parse(row.body);
    selectedMode(course,mode);
    const work = readRunState(row,course).works[mode];
    if (work == null) throw new Error('找不到已保存的作品');
    return mode === 'CANVAS' ? {mode,work} : {mode,html:work};
  }
  function projectFile(id) {
    const row = db.prepare('SELECT runs.id, revision, state, body FROM runs JOIN versions USING(version) JOIN purchases USING(version) WHERE runs.id=?').get(id);
    if (!row || !row.revision) throw new Error('请先保存 VibeCoding 作品');
    const course = JSON.parse(row.body);
    selectedMode(course,'VIBECODING');
    const html = readRunState(row,course).works.VIBECODING;
    if (typeof html !== 'string') throw new Error('请先保存 VibeCoding 作品');
    return {runId:row.id,course,revision:row.revision,html};
  }
  function hide(id,version) {
    if (!db.prepare('UPDATE listings SET visible=0 WHERE course=? AND version=? AND visible=1').run(id,version).changes) throw new Error('课程状态已变更，请刷新');
  }
  return {catalog,detail,publish,hide,account,purchase,start,save,works,workPreview,projectFile,close:()=>db.close()};
}
module.exports = {createWorkshop};
