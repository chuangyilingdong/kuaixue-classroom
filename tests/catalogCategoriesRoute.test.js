import test from 'node:test';
import assert from 'node:assert/strict';
import { openCoursePlatform } from '../apps/api/course-platform.mjs';
import { createApiServer } from '../apps/api/server.mjs';

test('public category route returns the shared database settings in client order', async t => {
  const platform = openCoursePlatform(':memory:');
  const server = createApiServer({ platform });
  t.after(() => platform.close());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const first = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/catalog/categories`);
  assert.equal(first.status, 200);
  const initial = await first.json();
  assert.deepEqual(initial.data.entries.map(entry => entry.id), ['canvas', 'vibecoding']);
  assert.ok(!initial.data.entries.some(entry => entry.id === 'all'));

  const saved = platform.saveCatalogCategories('admin', {
    revision: 0,
    items: [
      { id: 'visual', label: '视觉创作', category: '视觉创作' },
      { id: 'canvas', label: '画布课程', mode: 'CANVAS' },
    ],
  });
  assert.equal(saved.revision, 1);

  const updated = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/catalog/categories`);
  assert.deepEqual((await updated.json()).data.entries.map(entry => entry.id), ['visual', 'canvas']);
  assert.throws(() => platform.saveCatalogCategories('admin', {
    revision: 1,
    items: [{ id: 'all', label: '全部课程', mode: 'CANVAS' }],
  }), { status: 400 });
});
