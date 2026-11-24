import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const require=createRequire(import.meta.url);
const {hideLegacyTasks,prepareCourseProfile,reconcileCourseProfileRuntime}=require('../electron/course-local-vibe.cjs');

test('课程 profile 持久化并优先迁移包含项目索引的旧 profile',async t=>{
  const root=mkdtempSync(join(tmpdir(),'kx-profile-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const makeProfile=name=>{
    const directory=join(root,name);
    mkdirSync(join(directory,'.zcode','v2'),{recursive:true});
    const db=new DatabaseSync(join(directory,'.zcode','v2','tasks-index.sqlite'));
    db.exec('CREATE TABLE tasks(id TEXT); CREATE TABLE projects(id TEXT);');
    db.close();
    return directory;
  };
  const older=makeProfile('run-empty');
  const useful=makeProfile('run-useful');
  const db=new DatabaseSync(join(useful,'.zcode','v2','tasks-index.sqlite'));
  db.exec("INSERT INTO projects VALUES('project'); INSERT INTO tasks VALUES('task');");
  db.close();
  const target=join(root,'stable-hash');
  assert.equal(await prepareCourseProfile(root,'run',target),target);
  assert.equal(await prepareCourseProfile(root,'run',target),target);
  const migrated=new DatabaseSync(join(target,'.zcode','v2','tasks-index.sqlite'),{readOnly:true});
  assert.equal(migrated.prepare('SELECT count(*) n FROM projects').get().n,1);
  assert.equal(migrated.prepare('SELECT count(*) n FROM tasks').get().n,1);
  migrated.close();
  assert.notEqual(older,useful);
});

test('新 V2 课程 profile 不迁移任何旧会话',async t=>{
  const root=mkdtempSync(join(tmpdir(),'kx-profile-v2-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const legacy=join(root,'run-old');
  mkdirSync(join(legacy,'.zcode','v2'),{recursive:true});
  writeFileSync(join(legacy,'.zcode','v2','tasks-index.sqlite'),'legacy');
  const target=join(root,'stable-hash-v2');
  await prepareCourseProfile(root,'run',target,false);
  assert.equal(existsSync(target),true);
  assert.equal(existsSync(join(target,'.zcode','v2','tasks-index.sqlite')),false);
});

test('runtime 协议版本变化时隔离旧任务索引并保留工程文件',async t=>{
  const root=mkdtempSync(join(tmpdir(),'kx-runtime-profile-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const resourceRoot=join(root,'release');
  const runtimeRoot=join(resourceRoot,'vibe-local-runtime');
  mkdirSync(runtimeRoot,{recursive:true});
  writeFileSync(join(runtimeRoot,'zcode.cjs'),'runtime-v2');
  writeFileSync(join(runtimeRoot,'course-runtime.mjs'),'server-v2');
  const profile=join(root,'profile');
  mkdirSync(join(profile,'.zcode','v2'),{recursive:true});
  writeFileSync(join(profile,'.zcode','v2','tasks-index.sqlite'),'legacy-index');
  writeFileSync(join(profile,'index.html'),'workspace-file');
  assert.equal(await reconcileCourseProfileRuntime(profile,resourceRoot),true);
  assert.equal(existsSync(join(profile,'.zcode','v2','tasks-index.sqlite')),false);
  assert.equal(existsSync(join(profile,'index.html')),true);
  assert.equal(await reconcileCourseProfileRuntime(profile,resourceRoot),false);
});

test('旧 runtime 的任务 ID 在新任务索引中隐藏，当前任务保留',async t=>{
  const root=mkdtempSync(join(tmpdir(),'kx-task-quarantine-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const profile=join(root,'profile');
  const legacy=join(profile,'.zcode','legacy-task-index','runtime-old');
  const current=join(profile,'.zcode','v2');
  mkdirSync(legacy,{recursive:true});
  mkdirSync(current,{recursive:true});
  const legacyDb=new DatabaseSync(join(legacy,'tasks-index.sqlite'));
  legacyDb.exec('CREATE TABLE tasks(task_id TEXT); INSERT INTO tasks VALUES(\'old\');');
  legacyDb.close();
  const currentDb=new DatabaseSync(join(current,'tasks-index.sqlite'));
  currentDb.exec("CREATE TABLE tasks(task_id TEXT, archived INTEGER DEFAULT 0, deleted INTEGER DEFAULT 0); INSERT INTO tasks VALUES('old',0,0); INSERT INTO tasks VALUES('new',0,0);");
  currentDb.close();
  assert.equal(await hideLegacyTasks(profile),1);
  const verified=new DatabaseSync(join(current,'tasks-index.sqlite'),{readOnly:true});
  assert.deepEqual(verified.prepare('SELECT task_id,archived,deleted FROM tasks ORDER BY task_id').all().map(row=>({...row})),[
    {task_id:'new',archived:0,deleted:0},
    {task_id:'old',archived:1,deleted:1},
  ]);
  verified.close();
});
