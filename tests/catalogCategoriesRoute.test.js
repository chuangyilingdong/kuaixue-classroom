import test from 'node:test';
import assert from 'node:assert/strict';
import { openCoursePlatform } from '../apps/api/course-platform.mjs';
import { createApiServer } from '../apps/api/server.mjs';
import { defaultCourseCategories } from '../shared/catalog-categories.mjs';

test('public category route returns the shared database settings in client order', async t => {
  const platform = openCoursePlatform(':memory:');
  const server = createApiServer({ platform });
  t.after(() => platform.close());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const first = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/catalog/categories`);
  assert.equal(first.status, 200);
  const initial = await first.json();
  assert.deepEqual(initial.data.entries.map(entry => entry.label), defaultCourseCategories);
  assert.deepEqual(initial.data.categories, defaultCourseCategories);
  assert.ok(!initial.data.entries.some(entry => entry.id === 'all'));

  const saved = platform.saveCatalogCategories('admin', {
    revision: 0,
    courseCategories: ['视觉创作', '创作实训', '画布课程'],
  });
  assert.equal(saved.revision, 1);

  const updated = await fetch(`http://127.0.0.1:${server.address().port}/api/v1/catalog/categories`);
  const updatedData = (await updated.json()).data;
  assert.deepEqual(updatedData.entries.map(entry => entry.label), ['视觉创作', '创作实训', '画布课程']);
  assert.deepEqual(updatedData.categories, ['视觉创作', '创作实训', '画布课程']);
  assert.throws(() => platform.saveCatalogCategories('admin', {
    revision: 1,
    courseCategories: ['创作实训', '创作实训'],
  }), { status: 400 });
});
