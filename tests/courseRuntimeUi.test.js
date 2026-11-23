import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('VibeCoding 工作台不向学员暴露运行位置、切换或手动同步概念',()=>{
  const source=readFileSync(new URL('../src/ui/CourseRun.jsx',import.meta.url),'utf8');
  for(const forbidden of ['切到本机','切换云端','备份到云端','恢复本机工程','本机运行','云端运行']){
    assert.doesNotMatch(source,new RegExp(forbidden),`不应出现“${forbidden}”`);
  }
});

test('画布把预估价格放在生成按钮旁并点击后直接校验生成',()=>{
  const run=readFileSync(new URL('../src/ui/CourseRun.jsx',import.meta.url),'utf8');
  const canvas=readFileSync(new URL('../vendor/academy-canvas/index.jsx',import.meta.url),'utf8');
  assert.doesNotMatch(run,/window\.confirm/);
  assert.match(run,/quoteGeneration/);
  assert.match(canvas,/function GenerationPrice/);
  assert.match(canvas,/预估/);
  assert.match(canvas,/!=='adaptive'/);
});

test('生成媒体提供本地下载入口',()=>{
  const canvas=readFileSync(new URL('../vendor/academy-canvas/index.jsx',import.meta.url),'utf8');
  const main=readFileSync(new URL('../electron/main.cjs',import.meta.url),'utf8');
  assert.match(canvas,/function MediaDownloadButton/);
  assert.match(canvas,/kind="image"/);
  assert.match(canvas,/kind="video"/);
  assert.match(main,/ipcMain\.handle\('media:download'/);
});
