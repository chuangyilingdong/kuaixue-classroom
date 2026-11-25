import test from 'node:test';
import assert from 'node:assert/strict';
import policy from '../electron/course-browser-policy.cjs';
import {normalizeCourseBrowserUrl} from '../src/ui/courseBrowserUrl.js';

test('课程浏览器只允许空白页和匿名 HTTP/HTTPS 导航',()=>{
  for (const value of ['about:blank','https://example.com/','http://127.0.0.1:8080/']) {
    assert.equal(policy.isSafeCourseBrowserUrl(value),true,value);
  }
  for (const value of [
    'file:///C:/secret.txt','javascript:alert(1)','data:text/html,test',
    'https://user:pass@example.com/','zcode-browser-restore://pending','not a url',
  ]) {
    assert.equal(policy.isSafeCourseBrowserUrl(value),false,value);
  }
});

test('网页弹窗只回传安全地址和已知展示方式',()=>{
  assert.deepEqual(policy.normalizeCourseBrowserPopup({
    url:'https://example.com/next', disposition:'foreground-tab', sourceTabId:'tab-1',
  }), {
    url:'https://example.com/next', disposition:'foreground-tab', sourceTabId:'tab-1',
  });
  assert.equal(policy.normalizeCourseBrowserPopup({url:'file:///secret',disposition:'default'}),null);
  assert.equal(
    policy.normalizeCourseBrowserPopup({url:'https://example.com/',disposition:'unsafe'}).disposition,
    'other',
  );
});

test('地址栏接受裸域名和本机端口，拒绝非 HTTP 协议',()=>{
  assert.equal(normalizeCourseBrowserUrl('http://127.0.0.1:8080/workbench'),'http://127.0.0.1:8080/workbench');
  assert.equal(normalizeCourseBrowserUrl('https://example.com/app'),'https://example.com/app');
  assert.equal(normalizeCourseBrowserUrl('localhost:5173'),'http://localhost:5173/');
  assert.equal(normalizeCourseBrowserUrl('127.0.0.1:8080/preview'),'http://127.0.0.1:8080/preview');
  assert.equal(normalizeCourseBrowserUrl('example.com:8443/app'),'https://example.com:8443/app');
  assert.equal(normalizeCourseBrowserUrl('example.com/path'),'https://example.com/path');
  for (const value of ['file:///C:/secret.txt','javascript:alert(1)','data:text/html,test','zcode-browser-restore://pending']) {
    assert.equal(normalizeCourseBrowserUrl(value),'',value);
  }
});
