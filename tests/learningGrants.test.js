import test from 'node:test';
import assert from 'node:assert/strict';
import {groupActiveGrants} from '../src/data/learningGrants.js';

test('同一课程的当前和历史权益合并为一张课程卡',()=>{
  const groups=groupActiveGrants([
    {courseId:'course-a',versionId:'v3',status:'active'},
    {courseId:'course-a',versionId:'v2',status:'active'},
    {courseId:'course-a',versionId:'v1',status:'active'},
    {courseId:'course-b',versionId:'old',status:'active'},
  ],[
    {id:'course-a',versionId:'v3',title:'课程 A'},
    {id:'course-b',versionId:'new',title:'课程 B'},
  ]);
  assert.equal(groups.length,2);
  assert.equal(groups[0].versionCount,3);
  assert.equal(groups[0].currentOwned,true);
  assert.equal(groups[0].grant.versionId,'v3');
  assert.equal(groups[1].currentOwned,false);
  assert.equal(groups[1].grant.versionId,'old');
  assert.equal(groups[1].target.title,'课程 B');
});
