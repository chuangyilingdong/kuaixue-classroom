const { mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');

// Keep the same native workspace for a course run. Reopening must preserve edits made in the host.
async function prepareNativeProject(root, project) {
  const directory = path.join(root, project.runId, 'workspace');
  await mkdir(directory, { recursive: true });
  async function writeOnce(name, content) {
    try { await writeFile(path.join(directory, name), content, { flag: 'wx' }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  await writeOnce('index.html', project.html);
  return directory;
}
module.exports = { prepareNativeProject };
