import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {brandVibeWorkbench} from '../scripts/brand-vibe-workbench.mjs';

test('VibeCoding 启动页使用快学品牌 Logo',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'kx-workbench-brand-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  writeFileSync(join(dir,'index.html'),`<!doctype html><html><head><link rel="icon" href="data:image/png;base64,old"><title>ZCode</title></head><body><div class="zcode-boot-loading__logo-shell"><svg>Z</svg></div></body></html>`);
  await brandVibeWorkbench(dir);
  const html=readFileSync(join(dir,'index.html'),'utf8');
  assert.match(html,/快学课堂 · VibeCoding/);
  assert.match(html,/kx-class-lockup\.png/);
  assert.doesNotMatch(html,/<svg>Z<\/svg>/);
  assert.ok(readFileSync(join(dir,'kx-class-mark.png')).length>1000);
});
