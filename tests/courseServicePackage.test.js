import assert from 'node:assert/strict';
import {access} from 'node:fs/promises';
import {join} from 'node:path';
import test from 'node:test';
import {courseServiceFiles} from '../scripts/course-service-files.mjs';

test('course service package includes every admin runtime integration', async () => {
  const required = [
    'formal-server.cjs',
    'formal-provider.cjs',
    'integrations/main-site-admin/mountCourses.mjs',
    'integrations/main-site-admin/modelDirectory.mjs',
    'integrations/main-site-admin/KuaixueCourses.jsx',
    'integrations/main-site-admin/WorkspaceRecipe.jsx',
    'apps/api/main-site-model-gateway.mjs',
  ];
  for (const file of required) assert.ok(courseServiceFiles.includes(file), `${file} must be packaged`);
  for (const file of required) await access(join(process.cwd(), file));
});
