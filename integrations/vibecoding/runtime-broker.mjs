import {randomBytes,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';

// Used by the course service and the runtime gateway on a shared staging host.
// Only digests are stored. Tokens disappear before any asynchronous provider work.
export function createRuntimeBroker({filename, checkAccess, openWorkspace, now=Date.now}) {
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=4000;
    CREATE TABLE IF NOT EXISTS kx_runtime_tokens(digest TEXT PRIMARY KEY, kind TEXT NOT NULL, run TEXT NOT NULL, context TEXT NOT NULL, expires INTEGER NOT NULL);`);
  const digest = token => createHash('sha256').update(token).digest('hex');
  function issue(kind,context,ttl) {
    const token = randomBytes(32).toString('base64url');
    db.prepare('DELETE FROM kx_runtime_tokens WHERE expires<=?').run(now());
    db.prepare('INSERT INTO kx_runtime_tokens VALUES(?,?,?,?,?)').run(digest(token),kind,context.runId,JSON.stringify(context),now()+ttl);
    return token;
  }
  function claim(kind,token,runId) {
    if (typeof token !== 'string' || !/^[a-zA-Z0-9_-]{43}$/.test(token)) throw Error('运行授权无效');
    const row = db.prepare(`DELETE FROM kx_runtime_tokens WHERE digest=? AND kind=? AND expires>? AND (? IS NULL OR run=?) RETURNING context`)
      .get(digest(token),kind,now(),runId,runId);
    if (!row) throw Error('运行授权已过期或已使用');
    return JSON.parse(row.context);
  }
  async function validate(context) {
    if (context.mode !== 'VIBECODING' || !await checkAccess(context)) throw Error('课程工作区授权已失效');
  }
  return {
    async issueRuntimeTicket(context) {
      await validate(context); return issue('launch',context,60000);
    },
    async exchange({runId,ticket}) {
      if (!runId || typeof runId !== 'string') throw Error('缺少运行编号');
      const context = claim('launch',ticket,runId);
      await validate(context);
      // The location comes from a course-scoped host, never from the learner's request.
      const workspace = await openWorkspace(context);
      if (typeof workspace?.path !== 'string' || !workspace.path) throw Error('工作区未准备好');
      return {runId,workspacePath:workspace.path,workspaceIdentity:workspace.identity,presets:workspace.presets ?? [],socketId:issue('socket',context,30000)};
    },
    async claimSocket(id) {
      const context = claim('socket',id,null); await validate(context); return context;
    },close:()=>db.close(),
  };
}

// HTTPS gateway mount. acceptScopedSocket attaches the Lingdong RPC services for this run only.
export function mountRuntimeRoutes({router,server,origin,broker,acceptScopedSocket}) {
  router.post('/kuaixue/runtime/exchange',async (req,res)=>{
    res.set('Cache-Control','no-store');
    if (req.headers.origin !== origin) return res.sendStatus(403);
    try {res.json(await broker.exchange(req.body));} catch {res.sendStatus(403);}
  });
  server.on('upgrade',async (req,socket,head)=>{
    if (!req.url?.startsWith('/kuaixue/runtime/ws/')) return;
    try {
      if (req.headers.origin !== origin) throw Error();
      const id = req.url.slice('/kuaixue/runtime/ws/'.length);
      const context = await broker.claimSocket(id);
      await acceptScopedSocket({req,socket,head,context});
    } catch {socket.destroy();}
  });
}
