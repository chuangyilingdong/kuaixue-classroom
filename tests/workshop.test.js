import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import workshop from '../electron/workshop.cjs';

test('published versions retain purchases, runs, step progress and saved work across restarts', t => {
  const root = mkdtempSync(join(tmpdir(),'kuaixue-run-'));
  const filename = join(root,'store.sqlite');
  let store = workshop.createWorkshop(filename);
  t.after(() => {store.close();rmSync(root,{recursive:true,force:true});});
  const draft = {title:'交互作品', subtitle:'编写页面', type:'VIBECODING', price:65, steps:[{id:'draft',title:'排版',description:'修改页面',deliverable:'首页'}]};
  const course = store.publish(draft);
  assert.throws(() => store.start(course.id, course.versionId),/解锁/);
  assert.equal(store.purchase(course.id,course.versionId).points,295);
  assert.equal(store.purchase(course.id,course.versionId).points,295);
  const run = store.start(course.id,course.versionId);
  assert.throws(() => store.save({...run,completed:['wrong'],work:'<h1>作品</h1>'}), /步骤/);
  assert.equal(store.save({...run,completed:['draft'],work:'<h1>作品</h1>'}),1);
  assert.throws(() => store.save({...run,completed:[],work:''}),/其他窗口/);
  assert.equal(store.projectFile(run.id).html,'<h1>作品</h1>');
  const edited = {...draft, id:course.id,baseVersion:course.versionId,title:'新版',price:999};
  const next = store.publish(edited);
  assert.throws(() => store.publish(edited),/新版本/);
  assert.throws(() => store.purchase(next.id,next.versionId),/不足/);
  store.hide(next.id,next.versionId);
  assert.throws(() => store.purchase(next.id,next.versionId),/下架/);
  store.close();store = workshop.createWorkshop(filename);
  const restored = store.start(course.id,course.versionId);
  assert.equal(restored.id,run.id);assert.equal(restored.course.title,'交互作品');
  assert.deepEqual(restored.completed,['draft']);assert.equal(restored.revision,1);
  assert.equal(store.account().points,295);
  assert.ok(!store.catalog().some(c => c.id === next.id));
});

test('native Vibe projects keep external edits and the exact course instructions when reopened', async t => {
  const {prepareNativeProject} = (await import('../electron/native-project.cjs')).default;
  const {writeFile,readFile} = await import('node:fs/promises');
  const root = mkdtempSync(join(tmpdir(),'kuaixue-vibe-'));
  t.after(() => rmSync(root,{recursive:true,force:true}));
  const project = {runId:'run-a',html:'<h1>draft</h1>',course:{title:'制作主页',steps:[{title:'布局',description:'编辑首页',deliverable:'首页'}]}};
  const dir = await prepareNativeProject(root,project);
  await assert.rejects(readFile(join(dir,'课程步骤.md'),'utf8'),{code:'ENOENT'});
  await writeFile(join(dir,'index.html'),'native edit');
  assert.equal(await prepareNativeProject(root,project),dir);
  assert.equal(await readFile(join(dir,'index.html'),'utf8'),'native edit');
  assert.notEqual(await prepareNativeProject(root,{...project,runId:'run-b'}),dir);
});
