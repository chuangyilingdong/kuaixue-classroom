import { createServer } from 'node:http';
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { createConnection } from 'node:net';
import { openSync, closeSync, constants, fstatSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { createRuntimeBroker } from './runtime-broker.mjs';
import { createScopedSocketAcceptor } from './scoped-socket.mjs';

export const origin = 'https://kuaixue-vibe.aicyld.com.cn';
class HostUnavailable extends Error {}
const mime = new Map(Object.entries({
  '.html':'text/html; charset=utf-8','.htm':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8',
  '.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8',
  '.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif',
  '.webp':'image/webp','.avif':'image/avif','.ico':'image/x-icon','.woff':'font/woff','.woff2':'font/woff2',
  '.ttf':'font/ttf','.otf':'font/otf','.mp4':'video/mp4','.webm':'video/webm','.mp3':'audio/mpeg',
  '.wav':'audio/wav','.ogg':'audio/ogg','.wasm':'application/wasm','.pdf':'application/pdf',
  '.txt':'text/plain; charset=utf-8','.xml':'application/xml; charset=utf-8','.webmanifest':'application/manifest+json',
}));

function requestedRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header));
  if (!match || (!match[1] && !match[2])) return false;
  let start = match[1] ? Number(match[1]) : null;
  let end = match[2] ? Number(match[2]) : null;
  if (start === null) {
    if (!end || end <= 0) return false;
    start = Math.max(0,size-end);
    end = size-1;
  } else end = end === null ? size-1 : Math.min(end,size-1);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return false;
  return {start,end};
}

// Each parent directory is administrator-owned. Only the leaf socket directory is writable by the host.
function resolveHost(root, context) {
  const key = hostKey(context);
  try {
    const dir = join(root, key);
    const token = readFileSync(join(dir, 'token'), 'utf8').trim();
    if (!/^[\w-]{32,256}$/.test(token)) throw Error();
    const socketPath = join(dir, 'ipc', 'rpc.sock');
    if (!statSync(socketPath).isSocket()) throw Error();
    return {...context, origin:'ws://127.0.0.1', path:'/workspace', socketPath, token};
  } catch { throw new HostUnavailable(); }
}

function hostKey(context) {
  return createHash('sha256').update(JSON.stringify([context.userId, context.courseId, context.versionId])).digest('hex');
}

export async function servePreview({hostRoot,context,pathname,publicPath,req,res,workspaceRoot,frameAncestors=''}) {
  const root = workspaceRoot || join(hostRoot,hostKey(context),'workspace');
  let parts;
  try {
    parts = pathname.split('/').filter(Boolean).map(part=>decodeURIComponent(part));
  } catch {res.writeHead(400);return res.end();}
  if (parts.some(part=>part==='.'||part==='..'||part.includes('\\')||part.includes('\0'))) {
    res.writeHead(403);return res.end();
  }
  let target = resolve(root,...parts);
  const within = candidate => {
    const value = relative(resolve(root),resolve(candidate));
    return value !== '..' && !value.startsWith(`..${sep}`) && !isAbsolute(value);
  };
  if (!within(target)) {res.writeHead(403);return res.end();}
  try {
    const canonicalRoot = await realpath(root);
    const fileStat = await stat(target);
    if (fileStat.isDirectory()) {
      if (!pathname.endsWith('/')) {
        res.writeHead(308,{Location:`${publicPath}/`});return res.end();
      }
      target = join(target,'index.html');
    }
    const canonical = await realpath(target);
    const canonicalRelative = relative(canonicalRoot,canonical);
    if (canonicalRelative === '..' || canonicalRelative.startsWith(`..${sep}`) || isAbsolute(canonicalRelative)) {
      res.writeHead(403);return res.end();
    }
    const finalStat = await stat(canonical);
    if (!finalStat.isFile()) {res.writeHead(404);return res.end();}
    const extension = extname(canonical).toLowerCase();
    const contentType = mime.get(extension) || 'application/octet-stream';
    const range = requestedRange(req.headers.range,finalStat.size);
    if (range === false) {
      res.writeHead(416,{'Content-Range':`bytes */${finalStat.size}`,'Accept-Ranges':'bytes'});return res.end();
    }
    const headers = {
      'Content-Type':contentType,
      'Content-Length':String(range ? range.end-range.start+1 : finalStat.size),
      'Cache-Control':extension==='.html'||extension==='.htm'?'no-store':'private, max-age=300',
      'Access-Control-Allow-Origin':'*',
      'Cross-Origin-Resource-Policy':'cross-origin',
      'Referrer-Policy':'no-referrer',
      'X-Content-Type-Options':'nosniff',
      'Accept-Ranges':'bytes',
      ...(range ? {'Content-Range':`bytes ${range.start}-${range.end}/${finalStat.size}`} : {}),
    };
    if (extension==='.html'||extension==='.htm') {
      headers['Content-Security-Policy']=`default-src 'self' data: blob: https:; script-src 'self' 'unsafe-inline' 'unsafe-eval' https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: blob: https:; media-src 'self' data: blob: https:; font-src 'self' data: https:; connect-src 'self' https:; object-src 'none'; frame-ancestors 'self' ${frameAncestors}; base-uri 'self'`;
    }
    res.writeHead(range ? 206 : 200,headers);
    if (req.method==='HEAD') return res.end();
    createReadStream(canonical,range ? {start:range.start,end:range.end} : undefined).on('error',()=>res.destroy()).pipe(res);
  } catch {
    res.writeHead(404);res.end();
  }
}

// Pin the actual Linux socket inode. A project process cannot redirect the trusted gateway
// to another path by substituting a symlink between inspection and connect.
function connectHost(target) {
  const linuxOPath = 0o10000000;
  const fd = openSync(target.socketPath, linuxOPath | constants.O_NOFOLLOW);
  try {
    if (!fstatSync(fd).isSocket()) throw new HostUnavailable();
    const socket = createConnection({path:`/proc/self/fd/${fd}`});
    let closed = false;
    const release = () => {if (!closed) {closed = true; closeSync(fd);}};
    socket.once('connect', release); socket.once('close', release);
    return socket;
  } catch(error) {closeSync(fd); throw error;}
}

export function createGateway({courseFile, ticketFile, hostRoot, WebSocket}) {
  for (const file of [courseFile, ticketFile]) {
    if (!isAbsolute(file) || !statSync(file).isFile()) throw Error('运行配置文件不可用');
  }
  if (!isAbsolute(hostRoot) || !statSync(hostRoot).isDirectory()) throw Error('工程目录未配置');
  const db = new DatabaseSync(courseFile, {readOnly:true});
  const lookup = db.prepare(`SELECT v.body FROM kx_runs r JOIN kx_versions v ON v.version=r.version
    JOIN kx_orders o ON o.version=r.version AND o.user=r.user
    WHERE r.id=? AND r.user=? AND v.course=? AND r.version=? AND o.status='confirmed'`);
  function course(context) {
    if (context.mode !== 'VIBECODING') return null;
    const row = lookup.get(context.runId, context.userId, context.courseId, context.versionId);
    const value = row && JSON.parse(row.body);
    return value?.permittedDeliveryModes?.includes(context.mode) ? value : null;
  }
  const checkAccess = context => Boolean(course(context));
  const hostFor = context => resolveHost(hostRoot, context);
  const broker = createRuntimeBroker({filename:ticketFile, checkAccess, openWorkspace(context) {
    const plan = course(context);
    if (!plan) throw Error('课程权益已撤销');
    return {path:hostFor(context).path, identity:context.runId,
      presets:plan.classroomConfig?.vibeCoding?.presetPrompts ?? [],
      modelLabels:plan.vibeModelLabels ?? {}};
  }});
  const accept = createScopedSocketAcceptor({WebSocketServer:WebSocket.WebSocketServer, WebSocket, resolveHost:hostFor, connectHost, checkAccess});
  const server = createServer({requestTimeout:10000, headersTimeout:10000}, async (req,res) => {
    const previewMatch = /^\/kuaixue\/runtime\/preview\/([a-zA-Z0-9_-]{43})(\/.*)?$/.exec(req.url || '');
    if (previewMatch && ['GET','HEAD'].includes(req.method)) {
      try {
        const context = await broker.claimPreview(previewMatch[1]);
        return await servePreview({hostRoot,context,pathname:previewMatch[2] || '/',publicPath:previewMatch[0],req,res,frameAncestors:origin});
      } catch {
        res.writeHead(403);return res.end();
      }
    }
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Type','application/json');
    const finish = (status, data) => {res.writeHead(status); res.end(JSON.stringify(data));};
    if (req.url !== '/kuaixue/runtime/exchange') return finish(404,{});
    if (req.method !== 'POST') return finish(405,{});
    if (req.headers.origin !== origin) return finish(403,{});
    if (req.headers['content-type']?.split(';')[0] !== 'application/json') return finish(415,{});
    try {
      let size = 0; const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 2048) return finish(413,{});
        chunks.push(chunk);
      }
      const runtime = await broker.exchange(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      finish(200,runtime);
    } catch (error) {finish(error instanceof HostUnavailable ? 503 : 403,{});}
  });
  server.on('upgrade', async (req,socket,head) => {
    try {
      const match = /^\/kuaixue\/runtime\/ws\/([\w-]{43})$/.exec(req.url);
      if (req.method !== 'GET' || !match || req.headers.origin !== origin) throw Error();
      const context = await broker.claimSocket(match[1]);
      await accept({req,socket,head,context});
    } catch {socket.destroy();}
  });
  server.on('close', () => {broker.close(); db.close();});
  return server;
}
