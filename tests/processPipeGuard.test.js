import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import guardModule from '../electron/process-pipe-guard.cjs';

test('主进程 stdout/stderr 管道关闭不会把 EPIPE 升级成未捕获异常',()=>{
  const target = {stdout:new EventEmitter(),stderr:new EventEmitter()};
  guardModule.guardProcessPipes(target);
  assert.doesNotThrow(()=>target.stdout.emit('error',Object.assign(Error('broken pipe'),{code:'EPIPE'})));
  assert.doesNotThrow(()=>target.stderr.emit('error',Object.assign(Error('closed'),{code:'ERR_STREAM_DESTROYED'})));
  assert.equal(target.stdout.listenerCount('error'),1);
  assert.equal(target.stderr.listenerCount('error'),1);
  guardModule.guardProcessPipes(target);
  assert.equal(target.stdout.listenerCount('error'),1);
  assert.equal(target.stderr.listenerCount('error'),1);
});
