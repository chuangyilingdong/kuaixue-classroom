import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yazl from 'yazl';
import { openCoursePlatform } from '../apps/api/course-platform.mjs';
import { createApiServer } from '../apps/api/server.mjs';
import { loadCourseCatalog } from '../src/services/courseCatalog.js';
import { createCourseClient } from '../src/services/courseClient.js';
import { groupCourseWorks, canvasWorkAssets } from '../src/data/works.js';
import { defaultCatalogCategories, matchesCatalogCategory } from '../shared/catalog-categories.mjs';
import { readSnapshotPreview } from '../shared/work-preview.mjs';
import { mountKuaixueCourses } from '../integrations/main-site-admin/mountCourses.mjs';
import workshop from '../electron/workshop.cjs';
import savedWork from '../electron/saved-work.cjs';
import localProject from '../electron/local-project.cjs';
import localVibe from '../electron/course-local-vibe.cjs';
import { DatabaseSync } from 'node:sqlite';

const draft = {
  title: '课程作品', subtitle: '作品展示', price: 0, category: '视觉创作',
  permittedDeliveryModes: ['CANVAS', 'VIBECODING'], steps: [], thumbnailUrl: 'https://cdn.example/cover.png',
};

async function zipFiles(files) {
  const archive = new yazl.ZipFile();
  const bytes = [];
  const output = new Promise((resolve, reject) => {
    archive.outputStream.on('data', chunk => bytes.push(chunk));
    archive.outputStream.on('end', () => resolve(Buffer.concat(bytes)));
    archive.outputStream.on('error', reject);
  });
  for (const [name, value] of Object.entries(files)) archive.addBuffer(Buffer.from(value), name);
  archive.end();
  return output;
}

test('分类配置持久化、校验重复名称和并发覆盖，并由课程目录返回客户端', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'kx-categories-'));
  const filename = join(directory, 'courses.sqlite');
  let platform = openCoursePlatform(filename);
  t.after(() => { platform.close(); rmSync(directory, { recursive: true, force: true }); });
  assert.deepEqual(platform.catalogCategories(), { revision: 0, items: defaultCatalogCategories });
  const items = [
    { id: 'vibe', label: 'VibeCoding', mode: 'VIBECODING' },
    { id: 'visual', label: '视觉创作', category: '视觉创作' },
  ];
  assert.deepEqual(platform.saveCatalogCategories('admin', { revision: 0, items }), { revision: 1, items });
  assert.throws(() => platform.saveCatalogCategories('admin', { revision: 0, items }), { status: 409 });
  assert.throws(() => platform.saveCatalogCategories('admin', { revision: 1, items: [items[0], { ...items[0], id: 'duplicate' }] }), { status: 400 });
  platform.close();
  platform = openCoursePlatform(filename);
  assert.deepEqual(platform.catalogCategories(), { revision: 1, items });
  platform.publish('admin', draft);
  const server = createApiServer({ platform });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const catalog = await loadCourseCatalog({ baseUrl: `http://127.0.0.1:${server.address().port}` });
  assert.deepEqual(catalog.categories, items);
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/catalog/categories`);
  const publicConfig = await response.json();
  assert.deepEqual(publicConfig.data.entries.map(entry => entry.label), items.map(item => item.label));
  assert.equal(matchesCatalogCategory(catalog.courses[0], items[0]), true);
  assert.equal(matchesCatalogCategory(catalog.courses[0], items[1]), true);
  assert.equal(matchesCatalogCategory(catalog.courses[0], { category: '其他' }), false);
});

test('分类管理复用后台读取、发布权限和 CSRF 中间件', () => {
  const routes = [];
  const csrf = () => {};
  const router = {
    get: (...args) => routes.push(['GET', ...args]),
    post: (...args) => routes.push(['POST', ...args]),
  };
  mountKuaixueCourses(router, {
    platform: {}, requirePermission: value => value, requireCsrf: csrf, actorId: () => 'admin',
  });
  const path = '/api/admin/kuaixue/courses/categories';
  const get = routes.find(route => route[0] === 'GET' && route[1] === path);
  const post = routes.find(route => route[0] === 'POST' && route[1] === path);
  assert.equal(get[2], 'kuaixue.read');
  assert.equal(post[2], 'kuaixue.publish');
  assert.equal(post[3], csrf);
});

test('作品展示只读取已保存内容，校验身份、课程权益和保存的工作区类型', async t => {
  const platform = openCoursePlatform(':memory:');
  t.after(() => platform.close());
  const course = platform.publish('admin', draft);
  const context = { courseId: course.id, versionId: course.versionId, mode: 'CANVAS' };
  await platform.purchase('alice', context);
  const run = await platform.start('alice', context);
  await assert.rejects(platform.workPreview('alice', context), { status: 404 });
  const work = { nodes: [{ id: 'image', type: 'image', data: { assetUrl: 'https://cdn.example/work.png' } }], edges: [] };
  platform.save('alice', { ...run, work });
  const server = createApiServer({ platform, identity: session => session ? { userId: session } : null });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = name => createCourseClient({
    base, fetchImpl: (url, options) => fetch(url, {
      ...options, headers: { ...options.headers, Cookie: `kuaixue_session=${name}` },
    }),
  });
  assert.deepEqual(await client('alice').workPreview(context), { mode: 'CANVAS', work });
  await assert.rejects(client('bob').workPreview(context), { status: 403 });
  await assert.rejects(client('alice').workPreview({ ...context, mode: 'VIBECODING' }), { status: 404 });
  const noSession = await fetch(`${base}/api/v1/course-runs/preview`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(context),
  });
  assert.equal(noSession.status, 401);
  assert.equal(platform.works('alice')[0].thumbnailUrl, draft.thumbnailUrl);
  assert.equal((await platform.start('alice', context)).revision, 1);
});

test('VibeCoding 作品预览包含工程首页及其 CSS、脚本和图片资源', async t => {
  const bytes = await zipFiles({
    'index.html': '<html><head><link rel="stylesheet" href="assets/site.css"></head><body>我的作品<script src="assets/site.js"></script></body></html>',
    'assets/site.css': 'body {color: green}',
    'assets/site.js': 'document.body.dataset.ready = "yes";',
    'assets/cover.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
  });
  const files = await readSnapshotPreview(bytes);
  assert.deepEqual(files.map(file => file.path).sort(), ['assets/cover.svg', 'assets/site.css', 'assets/site.js', 'index.html']);
  assert.match(Buffer.from(files.find(file => file.path === 'index.html').base64, 'base64').toString(), /我的作品/);
  const platform = openCoursePlatform(':memory:', {
    downloadLocalSnapshot: async ({ runId }) => ({
      runId, bytes, revision: 1, sha256: 'a'.repeat(64), capturedAt: '2026-11-25T00:00:00Z',
    }),
  });
  t.after(() => platform.close());
  const course = platform.publish('admin', draft);
  const context = { courseId: course.id, versionId: course.versionId, mode: 'VIBECODING' };
  await platform.purchase('alice', context);
  const run = await platform.start('alice', context);
  platform.save('alice', run);
  assert.deepEqual((await platform.workPreview('alice', context)).files, files);
});

test('同一课程的画布和 VibeCoding 合并一张卡片，展示已保存的媒体和文字', () => {
  const groups = groupCourseWorks([
    { courseId: 'course', versionId: 'v2', mode: 'CANVAS', title: '课程' },
    { courseId: 'course', versionId: 'v1', mode: 'CANVAS', title: '旧课程' },
    { courseId: 'course', versionId: 'v1', mode: 'VIBECODING', title: '课程' },
  ], [{ id: 'course', thumbnailUrl: '/cover.png' }]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].thumbnailUrl, '/cover.png');
  assert.equal(groups[0].items.length, 2);
  assert.equal(groups[0].items[0].versionId, 'v2');
  assert.deepEqual(canvasWorkAssets({ nodes: [
    { id: 'image', type: 'image', data: { assetUrl: '/image.png', previewUrl: '/preview.png' } },
    { id: 'video', type: 'animation', data: { assetUrl: '/video.mp4' } },
    { id: 'text', type: 'prompt', data: { generatedText: '保存的文字' } },
    { id: 'empty', type: 'image', data: {} },
  ] }).map(item => [item.id, item.kind]), [['image', 'image'], ['video', 'video'], ['text', 'text']]);
});

test('本机离线作品也能直接预览已保存的画布和 HTML', () => {
  const store = workshop.createWorkshop(':memory:');
  try {
    const course = store.publish(draft);
    store.purchase(course.id, course.versionId);
    const run = store.start(course.id, course.versionId, 'VIBECODING');
    store.save({ ...run, work: '<h1>保存的作品</h1>' });
    assert.deepEqual(store.workPreview({ courseId: course.id, versionId: course.versionId, mode: 'VIBECODING' }), {
      mode: 'VIBECODING', html: '<h1>保存的作品</h1>',
    });
  } finally { store.close(); }
});

test('本机展示读取保存时的预览，并恢复旧客户端所选的外部工程', async t => {
  const root = mkdtempSync(join(tmpdir(), 'kx-saved-preview-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const context = { userId: 'learner', courseId: 'course-a', versionId: 'v1', runId: 'run-a', title: '作品' };
  const directory = join(root, 'external');
  mkdirSync(directory);
  writeFileSync(join(directory, 'index.html'), '<h1>已保存作品</h1>');
  writeFileSync(join(directory, 'style.css'), 'body{color:red}');
  await savedWork.saveWorkPreview(root, context, directory);
  writeFileSync(join(directory, 'index.html'), '<h1>之后的修改</h1>');
  const preview = await savedWork.readSavedWorkPreview(root, context);
  assert.deepEqual(await savedWork.readSavedWorkPreview(root, { ...context, runId: '' }), preview);
  assert.match(Buffer.from(preview.files.find(file => file.path === 'index.html').base64, 'base64').toString(), /已保存作品/);
  assert.equal(await savedWork.readSavedWorkPreview(root, { ...context, userId: 'other' }), null);
  const historical = { ...context, versionId: 'old' };
  const key = localProject.projectKey(historical);
  const profile = join(root, 'vibe-profiles', `${key}-v2`, '.zcode', 'v2');
  mkdirSync(profile, { recursive: true });
  const db = new DatabaseSync(join(profile, 'tasks-index.sqlite'));
  db.exec('CREATE TABLE tasks(workspace_path TEXT); CREATE TABLE project_roots(root_path TEXT)');
  db.prepare('INSERT INTO tasks VALUES(?)').run(directory);
  db.close();
  const defaultDirectory = join(root, 'vibe-projects', localVibe.courseWorkspaceName(historical.title, historical));
  mkdirSync(defaultDirectory, { recursive: true });
  writeFileSync(join(defaultDirectory, 'index.html'), '<h1>默认空工程</h1>');
  const recovered = await savedWork.readSavedWorkPreview(root, historical);
  assert.match(Buffer.from(recovered.files.find(file => file.path === 'index.html').base64, 'base64').toString(), /之后的修改/);
});

test('VibeCoding 作品入口校验账户权益并优先读取本机保存的预览', async () => {
  const previous = globalThis.kuaixueDesktop;
  let requested;
  globalThis.kuaixueDesktop = { vibe: { readSavedWork: async context => {
    requested = context;
    return { mode: 'VIBECODING', files: [] };
  } } };
  const item = { id: 'run-a', courseId: 'course-a', versionId: 'v1', mode: 'VIBECODING', title: '作品' };
  const client = createCourseClient({
    base: 'https://example.invalid',
    account: async () => ({ user: { id: 'learner' }, entitlements: [{ courseId: 'course-a', status: 'active' }] }),
    fetchImpl: () => assert.fail('本机预览可用时无需下载工程'),
  });
  try {
    assert.deepEqual(await client.workPreview(item), { mode: 'VIBECODING', files: [] });
    assert.equal(requested.userId, 'learner');
    assert.equal(requested.runId, item.id);
    await assert.rejects(client.workPreview({ ...item, courseId: 'another' }), /权益/);
  } finally { globalThis.kuaixueDesktop = previous; }
});
