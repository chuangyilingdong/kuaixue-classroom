import test from 'node:test';
import assert from 'node:assert/strict';
import {previewUrlFor,readCourseHtml} from '../integrations/vibecoding/course-html-preview.mjs';

function fixture(content, canonical = path => path) {
  const bytes = new TextEncoder().encode(content);
  return {
    resolvePath: async ({path}) => canonical(path),
    stat: async () => ({type:'file', size:bytes.length}),
    readFileRange: async ({offset, length}) => bytes.slice(offset, offset + length),
  };
}

test('预览可分段读取 UTF-8 作品，支持中文文件名和 URL 片段', async () => {
  const content = '字'.repeat(70000);
  assert.equal(await readCourseHtml(fixture(content), '/workspace', 'file:///workspace/%E7%94%BB.htm#one'), content);
});

test('本机课堂工程支持 Windows 文件 URL', async () => {
  assert.equal(await readCourseHtml(fixture('OK'), 'D:\\课堂\\workspace', 'file:///D:/课堂/workspace/site.html'), 'OK');
});

test('只读取本工程内的 HTML，并检查链接的真实位置', async () => {
  for (const url of ['file:///workspace-other/site.html','file:///workspace%5Cother.html','file://remote/workspace/site.html','file:///workspace/a.js','https://example.org/site.html']) {
    await assert.rejects(readCourseHtml(fixture(''), '/workspace', url), /当前课程工程/);
  }
  await assert.rejects(readCourseHtml(fixture('', p => p.endsWith('.html') ? '/other/file.html' : p), '/workspace', 'file:///workspace/link.html'), /文件不在/);
});

test('超大文件和不完整读取均返回错误', async () => {
  const service = fixture('a');
  service.stat = async () => ({type:'file',size:3 * 1024 * 1024});
  await assert.rejects(readCourseHtml(service, '/workspace', 'file:///workspace/a.html'), /2 MiB/);
  service.stat = async () => ({type:'file',size:10});
  await assert.rejects(readCourseHtml(service, '/workspace', 'file:///workspace/a.html'), /重新打开/);
});

test('工程预览地址保留相对资源路径并拒绝越界与无效票据', () => {
  const before=globalThis.location;
  globalThis.location={origin:'https://kuaixue-vibe.aicyld.com.cn'};
  try {
    const token='t'.repeat(43);
    assert.equal(
      previewUrlFor('/workspace','t'.repeat(43),'file:///workspace/pages/demo%20page.html'),
      `https://kuaixue-vibe.aicyld.com.cn/kuaixue/runtime/preview/${token}/pages/demo%20page.html`,
    );
    assert.equal(previewUrlFor('/workspace','bad','file:///workspace/index.html'),null);
    assert.equal(previewUrlFor('/workspace','t'.repeat(43),'file:///other/index.html'),null);
  } finally {
    if(before===undefined) delete globalThis.location;
    else globalThis.location=before;
  }
});
