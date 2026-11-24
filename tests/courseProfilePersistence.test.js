import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const require=createRequire(import.meta.url);
const {prepareCourseProfile}=require('../electron/course-local-vibe.cjs');

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
