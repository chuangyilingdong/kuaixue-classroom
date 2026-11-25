import { inspectSnapshotZip } from './local-snapshot.mjs';
import yauzl from 'yauzl';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const previewTypes = {
  html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript',
  json: 'application/json', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', ico: 'image/x-icon',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf',
  mp3: 'audio/mpeg', wav: 'audio/wav', mp4: 'video/mp4', webm: 'video/webm',
};
const maxPreviewBytes = 24 * 1024 * 1024;

export async function readDirectoryPreview(root) {
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('作品工程目录不可读取');
  const files = [];
  let size = 0;
  async function visit(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const absolute = join(directory, entry.name);
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) { await visit(absolute, path); continue; }
      const type = previewTypes[entry.name.split('.').at(-1).toLowerCase()];
      if (!entry.isFile() || !type) continue;
      const info = await lstat(absolute);
      size += info.size;
      if (size > maxPreviewBytes || files.length >= 1500) {
        throw Object.assign(new Error('作品预览资源较大，请打开创作工作区查看'), { status: 413 });
      }
      files.push({ path, type, base64: (await readFile(absolute)).toString('base64') });
    }
  }
  await visit(root);
  if (!files.some(file => file.path === 'index.html')) throw new Error('已保存工程缺少 index.html');
  return files;
}

export async function readSnapshotPreview(bytes) {
  await inspectSnapshotZip(bytes);
  const zip = await new Promise((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true }, (error, value) => error ? reject(error) : resolve(value));
  });
  return new Promise((resolve, reject) => {
    const files = [];
    let size = 0;
    const fail = error => { zip.close(); reject(error); };
    zip.on('error', fail);
    zip.on('entry', entry => {
      const type = previewTypes[entry.fileName.split('.').at(-1).toLowerCase()];
      if (!type || entry.fileName.endsWith('/')) { zip.readEntry(); return; }
      size += entry.uncompressedSize;
      if (size > maxPreviewBytes || files.length >= 1500) {
        fail(Object.assign(new Error('作品预览资源较大，请打开创作工作区查看'), { status: 413 }));
        return;
      }
      zip.openReadStream(entry, (error, stream) => {
        if (error) { fail(error); return; }
        const chunks = [];
        stream.on('data', chunk => chunks.push(chunk));
        stream.on('error', fail);
        stream.on('end', () => {
          files.push({ path: entry.fileName, type, base64: Buffer.concat(chunks).toString('base64') });
          zip.readEntry();
        });
      });
    });
    zip.on('end', () => resolve(files));
    zip.readEntry();
  });
}
