import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {delimiter,join} from 'node:path';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const {withRuntimeTools}=require('../electron/course-local-vibe.cjs');

test('本机运行时优先使用随包或已安装的 Python 环境，不改变工作区路由',t=>{
  const root=mkdtempSync(join(tmpdir(),'kx-runtime-tools-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const bin=join(root,'python',process.platform==='win32'?'Scripts':'bin');
  mkdirSync(bin,{recursive:true});
  writeFileSync(join(bin,process.platform==='win32'?'python.exe':'python'),'fixture');
  const pathKey=process.platform==='win32'?'Path':'PATH';
  const result=withRuntimeTools({[pathKey]:`existing${delimiter}path`},root);
  assert.ok(result[pathKey].split(delimiter).includes(bin));
  assert.match(result[pathKey],/existing/);
  assert.equal(result.PYTHONUTF8,'1');
});
