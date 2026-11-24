const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { openFormalProvider, cookies } = require('./formal-provider.cjs');

const root = path.join(__dirname);
const dbPath = process.env.KUAIXUE_COURSE_DB;
const publicOrigin = process.env.KUAIXUE_PUBLIC_MAIN_ORIGIN || 'https://aicyld.com.cn';
if (!path.isAbsolute(dbPath || '')) throw new Error('KUAIXUE_COURSE_DB 必须是绝对路径');

const json = (res, status, payload, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(JSON.stringify(payload));
};
const readBody = async req => {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 128 * 1024) throw new Error('请求过大'); chunks.push(chunk); }
  try { const body = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error(); return body; }
  catch { throw new Error('无效的 JSON'); }
};
const allowedOrigins = ['kuaixue://classroom', publicOrigin];
const consentPage = fs.readFileSync(path.join(root, 'consent.html'), 'utf8');

async function main() {
  const [{ openCoursePlatform }, { createApiServer }, { createAccountReader }, { openTicketedCoursePlatform }, { mainSiteRuntimeFromEnv }, { canvasGenerationFromEnv }, { createMainSiteModelGateway }] = await Promise.all([
    import(pathToFileURL(path.join(root, 'apps/api/course-platform.mjs')).href),
    import(pathToFileURL(path.join(root, 'apps/api/server.mjs')).href),
    import(pathToFileURL(path.join(root, 'apps/api/account.mjs')).href),
    import(pathToFileURL(path.join(root, 'integrations/vibecoding/main-site-tickets.mjs')).href),
    import(pathToFileURL(path.join(root, 'apps/api/main-site-runtime.mjs')).href),
    import(pathToFileURL(path.join(root, 'apps/api/canvas-generation.mjs')).href),
    import(pathToFileURL(path.join(root, 'apps/api/main-site-model-gateway.mjs')).href),
  ]);
  const provider = openFormalProvider(process.env.KUAIXUE_AUTH_DB || dbPath);
  const {withCourseModels} = await import('./course-models.mjs');
  const runtime = mainSiteRuntimeFromEnv();
  const generation = canvasGenerationFromEnv();
  const modelGateway = createMainSiteModelGateway();
  const runtimeProvider = {
    ...provider,
    ...(provider.issueLocalModelGrant ? {} : { issueLocalModelGrant: runtime?.issueLocalModelGrant }),
    ...(provider.uploadLocalSnapshot ? {} : { uploadLocalSnapshot: runtime?.uploadLocalSnapshot }),
    ...(provider.downloadLocalSnapshot ? {} : { downloadLocalSnapshot: runtime?.downloadLocalSnapshot }),
    ...(provider.quoteGeneration ? {} : { quoteGeneration: generation?.quoteGeneration }),
    ...(provider.generateOrLookup ? {} : { generateOrLookup: generation?.generateOrLookup }),
    assetRoot: process.env.KUAIXUE_ASSET_ROOT,
  };
  const platform = withCourseModels(openTicketedCoursePlatform(openCoursePlatform, dbPath, runtimeProvider, process.env.KUAIXUE_RUNTIME_TICKET_DB), provider.identity, {modelGateway});
  const accountReader = createAccountReader({
    identity: provider.identity,
    listGrants: platform.listGrants,
    mainSite: process.env.KUAIXUE_INTERNAL_ORIGIN || process.env.KUAIXUE_MAIN_SITE_ORIGIN || 'http://127.0.0.1:3001',
  });
  const assetSigningSecret = process.env.KUAIXUE_ASSET_SIGNING_SECRET ||
    process.env.KUAIXUE_INTERNAL_SECRET || process.env.KUAIXUE_CANVAS_BILLING_SECRET || '';
  const catalog = createApiServer({
    platform, accountReader, identity: provider.identity, desktopAuth: provider.desktopAuth,
    allowedOrigins, assetSigningSecret,
  });

  function principal(req) {
    const session = cookies(req).kuaixue_session;
    return session ? provider.identity(session) : null;
  }

  async function authorize(req, res, url) {
    const params = url.searchParams;
    if (req.method === 'GET' && url.pathname === '/kuaixue/desktop/authorize') {
      const challenge = params.get('code_challenge');
      if (params.get('client_id') !== provider.desktopAuth.clientId || params.get('redirect_uri') !== provider.desktopAuth.redirectUri ||
          params.get('response_type') !== 'code' || params.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(challenge || '') ||
          !/^[A-Za-z0-9_-]{32,128}$/.test(params.get('state') || '')) return json(res, 400, { error: { code: 'INVALID_AUTH_REQUEST' } });
      const nonce = provider.desktopAuth.begin({ challenge, state: params.get('state') });
      const cookie = `kx_auth_flow=${nonce}; Path=/kuaixue/desktop/authorize; Max-Age=300; HttpOnly; Secure; SameSite=Lax`;
      if (params.get('ui') === 'kx-class-v1') {
        res.writeHead(303, { Location: '/kuaixue/sign-in/', 'Cache-Control': 'no-store',
          'Set-Cookie': cookie, 'Referrer-Policy': 'no-referrer' });
        return res.end();
      }
      const html = consentPage;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'", 'Set-Cookie': cookie });
      return res.end(html);
    }
    if (req.method === 'POST' && url.pathname === '/kuaixue/desktop/authorize/complete') {
      try {
        if (req.headers.origin !== publicOrigin || req.headers['content-type']?.split(';')[0] !== 'application/json') return json(res, 403, { error: { code: 'ORIGIN_DENIED' } });
        const body = await readBody(req);
        const result = await provider.desktopAuth.complete({ nonce: cookies(req).kx_auth_flow, mainToken: body.token });
        res.setHeader('Set-Cookie', 'kx_auth_flow=; Path=/kuaixue/desktop/authorize; Max-Age=0; HttpOnly; Secure; SameSite=Lax');
        return json(res, 200, { redirect: `${provider.desktopAuth.redirectUri}?code=${encodeURIComponent(result.code)}&state=${encodeURIComponent(result.state)}` });
      } catch (error) { return json(res, 401, { error: { code: 'AUTHORIZATION_FAILED', message: error.message } }); }
    }
    if (req.method === 'GET' && url.pathname === '/kuaixue/desktop/callback') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" });
      return res.end('<!doctype html><meta charset="utf-8"><title>授权完成</title><p>授权完成，请返回快学课堂客户端。</p>');
    }
    return false;
  }

  async function wallet(req, res, url) {
    if (req.method !== 'GET' || !url.pathname.startsWith('/api/v1/wallet/')) return false;
    if (req.headers.origin && !allowedOrigins.includes(req.headers.origin)) { json(res, 403, { error: { code: 'ORIGIN_DENIED' } }); return true; }
    const user = principal(req);
    if (!user) { json(res, 401, { error: { code: 'SESSION_REQUIRED' } }); return true; }
    if (url.pathname === '/api/v1/wallet/ledger') {
      try { json(res, 200, await provider.ledger(user.mainSiteToken, url.search ? url.search : '?limit=50&offset=0')); }
      catch { json(res, 502, { error: { code: 'WALLET_UNAVAILABLE' } }); }
      return true;
    }
    const match = url.pathname.match(/^\/api\/v1\/wallet\/orders\/([^/]+)$/);
    if (match) {
      try {
        const orderId = decodeURIComponent(match[1]);
        const local = platform.orderFor(user.userId, orderId);
        const data = local?.status === 'pending' ? (await provider.lookupOrder(orderId, user.userId) || local) : (local || await provider.lookupOrder(orderId, user.userId));
        json(res, data ? 200 : 404, data ? { data } : { error: { code: 'ORDER_NOT_FOUND' } });
      }
      catch { json(res, 502, { error: { code: 'WALLET_UNAVAILABLE' } }); }
      return true;
    }
    json(res, 404, { error: { code: 'NOT_FOUND' } });
    return true;
  }

  const app = http.createServer(async (req, res) => {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Referrer-Policy', 'no-referrer');
    let url;
    try { url = new URL(req.url || '/', 'http://127.0.0.1'); } catch { return json(res, 400, { error: { code: 'BAD_URL' } }); }
    if (url.pathname.startsWith('/kuaixue/desktop/')) {
      try { await authorize(req, res, url); if (res.writableEnded) return; } catch { return json(res, 400, { error: { code: 'BAD_REQUEST' } }); }
    }
    if (allowedOrigins.includes(req.headers.origin)) {
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin); res.setHeader('Access-Control-Allow-Credentials','true'); res.setHeader('Vary','Origin');
    }
    if (req.method === 'POST' && url.pathname === '/api/v1/course-purchases' && process.env.KUAIXUE_PURCHASES_ENABLED !== '1') {
      if (req.headers.origin && !allowedOrigins.includes(req.headers.origin)) return json(res,403,{error:{code:'ORIGIN_DENIED'}});
      if (!principal(req)) return json(res,401,{error:{code:'SESSION_REQUIRED'}});
      return json(res,423,{error:{code:'PURCHASES_DISABLED',message:'正式购课暂未开放'}});
    }
    if (await wallet(req, res, url)) return;
    if (req.method === 'GET' && url.pathname === '/healthz') return json(res, 200, { status: 'ok' });
    catalog.emit('request', req, res);
  });
  const host = process.env.KUAIXUE_BIND_HOST || '127.0.0.1';
  const port = Number(process.env.KUAIXUE_API_PORT || 4188);
  app.listen(port, host, () => console.log(`Kuaixue formal service listening on ${host}:${port}`));
  const close = () => { app.close(() => { platform.close(); provider.close(); process.exit(0); }); };
  process.on('SIGTERM', close); process.on('SIGINT', close);
}

main().catch(error => { console.error('[kuaixue-formal]', error.stack || error.message); process.exit(1); });
