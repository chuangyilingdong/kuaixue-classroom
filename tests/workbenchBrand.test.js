import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {brandVibeWorkbench} from '../scripts/brand-vibe-workbench.mjs';
import { courseIconsPlugin } from '../integrations/vibecoding/course-icons.mjs';

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

test('VibeCoding 图标替换使用 IconPark SVG 并保留上游 SVG 属性和自定义图形 API', async () => {
  const plugin = courseIconsPlugin(process.cwd());
  const id = plugin.resolveId('lucide-react');
  const source = await plugin.load(id);
  assert.match(source, /data-iconpark/);
  assert.match(source, /export const CheckIcon/);
  assert.match(source, /export const Search/);
  assert.match(source, /viewBox: '0 0 48 48'/);
  assert.match(source, /React\.forwardRef/);
  assert.match(source, /export \* from /);
  assert.doesNotMatch(source, /from.*@icon-park\/react\/es/);
});
