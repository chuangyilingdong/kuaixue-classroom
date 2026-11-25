const { randomUUID } = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { projectPaths } = require('./local-project.cjs');
const { courseWorkspaceName } = require('./course-local-vibe.cjs');
const { DatabaseSync } = require('node:sqlite');

function projectDirectories(dataRoot, key) {
  let db;
  try {
    db = new DatabaseSync(path.join(dataRoot, 'vibe-profiles', `${key}-v2`, '.zcode', 'v2', 'tasks-index.sqlite'), { readOnly: true });
    return [...db.prepare('SELECT DISTINCT workspace_path path FROM tasks ORDER BY rowid DESC').all(),
      ...db.prepare('SELECT root_path path FROM project_roots ORDER BY rowid DESC').all()]
      .map(row => row.path).filter(value => typeof value === 'string' && path.isAbsolute(value));
  } catch { return []; }
  finally { db?.close(); }
}

async function saveWorkPreview(dataRoot, context, directory) {
  const { readDirectoryPreview } = await import('../shared/work-preview.mjs');
  const files = await readDirectoryPreview(directory);
  const paths = projectPaths(dataRoot, context);
  await fsp.mkdir(paths.root, { recursive: true });
  const temporary = path.join(paths.root, `preview-${randomUUID()}.json`);
  await fsp.writeFile(temporary, JSON.stringify({ runId: context.runId, files }), { flag: 'wx' });
  const target = path.join(paths.root, 'saved-preview.json');
  await fsp.rename(temporary, target).catch(async error => {
    await fsp.rm(temporary, { force: true });
    throw error;
  });
}

async function readSavedWorkPreview(dataRoot, request) {
  if (!['userId', 'courseId', 'versionId'].every(key =>
    typeof request?.[key] === 'string' && request[key].length > 0 && request[key].length <= 160) ||
      request.runId && (typeof request.runId !== 'string' || request.runId.length > 160)) {
    throw new Error('本机作品参数无效');
  }
  const paths = projectPaths(dataRoot, request);
  try {
    const preview = JSON.parse(await fsp.readFile(path.join(paths.root, 'saved-preview.json'), 'utf8'));
    if ((!request.runId || preview.runId === request.runId) && Array.isArray(preview.files)) return { mode: 'VIBECODING', files: preview.files };
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  // Earlier clients saved the project in place without a separate preview.
  const current = path.join(dataRoot, 'vibe-projects', courseWorkspaceName(request.title, request));
  const legacy = paths.workspace;
  const { readDirectoryPreview } = await import('../shared/work-preview.mjs');
  const directories = projectDirectories(dataRoot, path.basename(paths.root));
  for (const directory of [...new Set([...directories, current, legacy])]) {
    try { return { mode: 'VIBECODING', files: await readDirectoryPreview(directory) }; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return null;
}

module.exports = { saveWorkPreview, readSavedWorkPreview };
