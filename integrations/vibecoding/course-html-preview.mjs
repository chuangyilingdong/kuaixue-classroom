const MAX_BYTES = 2 * 1024 * 1024;
const CHUNK_BYTES = 64 * 1024;

function normalizedPath(path, windows) {
  const value = (windows ? path.replaceAll('\\', '/') : path).replace(/\/$/, '');
  return windows ? value.toLowerCase() : value;
}

export async function readCourseHtml(fileService, workspacePath, url) {
  const file = new URL(url);
  const path = decodeURIComponent(file.pathname);
  const windows = /^[A-Za-z]:[\\/]/.test(workspacePath);
  const requested = windows && /^\/[A-Za-z]:\//.test(path) ? path.slice(1) : path;
  const within = (child, parent) => normalizedPath(child, windows).startsWith(normalizedPath(parent, windows) + '/');
  if (file.protocol !== 'file:' || file.host || !/\.html?$/i.test(requested) ||
      /[\u0000-\u001f]/.test(requested) || requested.split(/[\\/]/).some(part => part === '..') ||
      !within(requested, workspacePath)) throw Error('请选择当前课程工程中的 HTML 文件。');
  const [root, target] = await Promise.all([workspacePath, requested].map(path => fileService.resolvePath({path})));
  if (!within(target, root) || !/\.html?$/i.test(target)) throw Error('文件不在当前课程工程内。');
  const {size, type} = await fileService.stat({path:target});
  if (type !== 'file' || !Number.isSafeInteger(size) || size < 0) throw Error('未找到作品文件。');
  if (size > MAX_BYTES) throw Error('单文件预览支持 2 MiB 以内的 HTML。');
  const bytes = new Uint8Array(size);
  for (let offset = 0; offset < size;) {
    const length = Math.min(CHUNK_BYTES, size - offset);
    const chunk = await fileService.readFileRange({path:target, offset, length});
    if (!(chunk instanceof Uint8Array) || chunk.byteLength !== length) throw Error('文件已变化，请重新打开。');
    bytes.set(chunk, offset);
    offset += length;
  }
  return new TextDecoder().decode(bytes);
}

export function previewUrlFor(workspacePath, token, url) {
  if (typeof token !== 'string' || !/^[a-zA-Z0-9_-]{43}$/.test(token)) return null;
  const file = new URL(url);
  if (file.protocol !== 'file:' || file.host || !/\.html?$/i.test(file.pathname)) return null;
  const windows = /^[A-Za-z]:[\\/]/.test(workspacePath);
  const root = workspacePath.replaceAll('\\','/').replace(/\/$/,'');
  const target = decodeURIComponent(file.pathname).replaceAll('\\','/');
  const left = windows ? root.toLowerCase() : root;
  const right = windows ? target.toLowerCase() : target;
  if (!right.startsWith(left+'/')) return null;
  const relative = target.slice(root.length).replace(/^\/+/,'');
  const encoded = relative.split('/').map(part=>encodeURIComponent(part)).join('/');
  return `${location.origin}/kuaixue/runtime/preview/${token}/${encoded}`;
}

// Student scripts execute only inside an opaque-origin frame, separate from the course RPC client.
const htmlPreamble = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; media-src data:; font-src data:; form-action 'none'; base-uri 'none'">`;

export function createCourseHtmlPreview(fileService, workspacePath, previewToken) {
  return function openCourseHtmlPreview(url) {
    if (!/^file:.*\.html?(?:[?#].*)?$/i.test(url)) return false;
    const parsed = new URL(url);
    const file = decodeURIComponent(parsed.pathname).replace(/^\/(?=[A-Za-z]:\/)/,'');
    const selected=document.querySelector('[data-task-item-key].bg-selected');
    const key=selected?.getAttribute('data-task-item-key')?.trim()||'';
    const separator=key.lastIndexOf(':');
    const directory=document.querySelector('[data-testid="workspace-path"][data-workspace-abs-path]')
      ?.getAttribute('data-workspace-abs-path')?.trim() || (separator>1?key.slice(0,separator):'') || workspacePath;
    if (!directory || !file) return false;
    window.parent.postMessage({
      type:'kuaixue-open-html-preview',
      requestId:`html-${Date.now()}`,
      directory,
      file,
    }, '*');
    return true;
  };
}
