import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('首页不展示模型用量信息，账号入口使用头像组件',()=>{
  const home=readFileSync(new URL('../src/ui/Home.jsx',import.meta.url),'utf8');
  const app=readFileSync(new URL('../src/ui/App.jsx',import.meta.url),'utf8');
  const learning=readFileSync(new URL('../src/ui/LearningView.jsx',import.meta.url),'utf8');
  assert.doesNotMatch(home,/course\.models/);
  assert.match(app,/UserAvatar/);
  assert.doesNotMatch(learning,/打开创易灵动账号/);
});
