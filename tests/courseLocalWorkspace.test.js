import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const {courseWorkspaceName}=require('../electron/course-local-vibe.cjs');

test('每门课程和课程版本使用独立且稳定的本机工作区目录',()=>{
  const base={userId:'learner',courseId:'course-a',versionId:'v1'};
  const first=courseWorkspaceName('第一门课',base);
  assert.equal(courseWorkspaceName('第一门课',{...base}),first);
  assert.notEqual(courseWorkspaceName('第二门课',{...base,courseId:'course-b'}),first);
  assert.notEqual(courseWorkspaceName('第一门课新版',{...base,versionId:'v2'}),first);
  assert.notEqual(courseWorkspaceName('第一门课',{...base,userId:'another-learner'}),first);
  assert.match(first,/^第一门课-[a-f0-9]{8}$/);
});
