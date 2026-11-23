const { DatabaseSync } = require('node:sqlite');
const { createCipheriv, createDecipheriv, createHash, randomBytes } = require('node:crypto');

const text = value => String(value ?? '');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const validOpaque = value => typeof value === 'string' && /^[A-Za-z0-9_-]{32,256}$/.test(value);
const validVerifier = value => typeof value === 'string' && /^[A-Za-z0-9._~-]{43,128}$/.test(value);

function secretKey(value) {
  const digest = createHash('sha256').update(text(value)).digest();
  if (!value || digest.length !== 32) throw new Error('KUAIXUE_SESSION_SECRET 未配置');
  return digest;
}

function protect(value, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}

function reveal(value, key) {
  const packed = Buffer.from(value, 'base64url');
  if (packed.length < 28) throw new Error('会话凭据无效');
  const decipher = createDecipheriv('aes-256-gcm', key, packed.subarray(0, 12));
  decipher.setAuthTag(packed.subarray(12, 28));
  return Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString('utf8');
}

function cookies(req) {
  return Object.fromEntries(text(req.headers.cookie).split(';').map(item => item.trim()).filter(Boolean).map(item => {
    const at = item.indexOf('=');
    return at < 0 ? [item, ''] : [item.slice(0, at), item.slice(at + 1)];
  }));
}

function openFormalProvider(filename, env = process.env) {
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=4000;
    CREATE TABLE IF NOT EXISTS kx_auth_flows (nonce TEXT PRIMARY KEY, challenge TEXT NOT NULL, state TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS kx_auth_codes (code TEXT PRIMARY KEY, user_id TEXT NOT NULL, main_token TEXT NOT NULL, challenge TEXT NOT NULL, redirect_uri TEXT NOT NULL, client_id TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS kx_sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, main_token TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS kx_sessions_expiry ON kx_sessions(expires);`);

  const clientId = env.KUAIXUE_CLIENT_ID || 'kuaixue-desktop';
  const redirectUri = env.KUAIXUE_REDIRECT_URI || 'https://aicyld.com.cn/kuaixue/desktop/callback';
  const serverMainOrigin = (env.KUAIXUE_INTERNAL_ORIGIN || env.KUAIXUE_MAIN_SITE_ORIGIN || 'http://127.0.0.1:3001').replace(/\/$/, '');
  const publicMainOrigin = (env.KUAIXUE_PUBLIC_MAIN_ORIGIN || 'https://aicyld.com.cn').replace(/\/$/, '');
  const sessionKey = secretKey(env.KUAIXUE_SESSION_SECRET);
  const walletSecret = text(env.KUAIXUE_WALLET_SECRET);

  function atomic(work) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = work(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }

  function cleanup() {
    const now = Date.now();
    db.prepare('DELETE FROM kx_auth_flows WHERE expires<=?').run(now);
    db.prepare('DELETE FROM kx_auth_codes WHERE expires<=?').run(now);
    db.prepare('DELETE FROM kx_sessions WHERE expires<=?').run(now);
  }

  function identity(session) {
    cleanup();
    if (!validOpaque(session)) return null;
    const row = db.prepare('SELECT user_id AS userId, main_token AS protectedToken FROM kx_sessions WHERE token=? AND expires>?').get(sha256(session), Date.now());
    if (!row) return null;
    return { userId: row.userId, mainSiteToken: reveal(row.protectedToken, sessionKey) };
  }

  const desktopAuth = {
    clientId,
    redirectUri,
    publicMainOrigin,
    begin: ({ challenge, state }) => atomic(() => {
      cleanup();
      const nonce = randomBytes(32).toString('base64url');
      db.prepare('INSERT INTO kx_auth_flows VALUES(?,?,?,?)').run(sha256(nonce), challenge, state, Date.now() + 5 * 60 * 1000);
      return nonce;
    }),
    complete: async ({ nonce, mainToken }) => {
      if (!validOpaque(nonce) || typeof mainToken !== 'string' || mainToken.length > 32_000) throw new Error('授权流程已失效');
      const response = await fetch(`${serverMainOrigin}/api/auth/me`, { headers: { Accept: 'application/json', Authorization: `Bearer ${mainToken}` }, redirect: 'error', signal: AbortSignal.timeout(7000) });
      if (!response.ok) throw new Error('主站登录态无效');
      const profile = await response.json();
      if (!profile?.id || typeof profile.id !== 'string') throw new Error('主站账号信息无效');
      return atomic(() => {
        const flow = db.prepare('DELETE FROM kx_auth_flows WHERE nonce=? AND expires>? RETURNING challenge,state').get(sha256(nonce), Date.now());
        if (!flow) throw new Error('授权流程已失效');
        const code = randomBytes(40).toString('base64url');
        db.prepare('INSERT INTO kx_auth_codes VALUES(?,?,?,?,?,?,?)').run(
          sha256(code), profile.id, protect(mainToken, sessionKey), flow.challenge, redirectUri, clientId, Date.now() + 90 * 1000,
        );
        return { code, state: flow.state };
      });
    },
    exchange: ({ code, verifier, redirectUri: redirect, clientId: client }) => atomic(() => {
      cleanup();
      if (client !== clientId || redirect !== redirectUri || !validOpaque(code) || !validVerifier(verifier)) throw new Error('授权无效');
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      const row = db.prepare('DELETE FROM kx_auth_codes WHERE code=? AND challenge=? AND redirect_uri=? AND client_id=? AND expires>? RETURNING user_id,main_token').get(
        sha256(code), challenge, redirectUri, clientId, Date.now(),
      );
      if (!row) throw new Error('授权无效');
      const session = randomBytes(48).toString('base64url');
      db.prepare('INSERT INTO kx_sessions VALUES(?,?,?,?)').run(sha256(session), row.user_id, row.main_token, Date.now() + 8 * 60 * 60 * 1000);
      return session;
    }),
    revokeSession: session => db.prepare('DELETE FROM kx_sessions WHERE token=?').run(sha256(session)),
  };

  async function mainRequest(path, options = {}, origin = serverMainOrigin) {
    const response = await fetch(`${origin}${path}`, {
      ...options,
      headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) },
      redirect: 'error', signal: AbortSignal.timeout(7000),
    });
    const body = await response.json().catch(() => null);
    return { response, body };
  }

  async function debitOrLookup(order) {
    if (!walletSecret) throw new Error('钱包服务密钥未配置');
    const { response, body } = await mainRequest('/internal/kuaixue/wallet/debit', {
      method: 'POST', headers: { 'x-kuaixue-wallet-secret': walletSecret }, body: JSON.stringify(order),
    }, serverMainOrigin);
    if (response.status === 402) return { status: 'insufficient' };
    if (response.status === 423) return { status: 'disabled' };
    if (!response.ok || !body?.data) throw new Error(body?.error?.message || '钱包服务暂不可用');
    return body.data;
  }

  async function lookupOrder(orderId, userId) {
    if (!walletSecret) throw new Error('钱包服务密钥未配置');
    const path = `/internal/kuaixue/wallet/orders/${encodeURIComponent(orderId)}?userId=${encodeURIComponent(userId)}`;
    const { response, body } = await mainRequest(path, { headers: { 'x-kuaixue-wallet-secret': walletSecret } }, serverMainOrigin);
    if (response.status === 404) return null;
    if (!response.ok || !body?.data) throw new Error(body?.error?.message || '订单服务暂不可用');
    return body.data;
  }

  async function ledger(mainToken, query = '') {
    const { response, body } = await mainRequest(`/api/points/ledger${query}`, { headers: { Authorization: `Bearer ${mainToken}` } });
    if (!response.ok) throw new Error('流水服务暂不可用');
    return body;
  }

  return {
    identity,
    desktopAuth,
    debitOrLookup,
    lookupOrder,
    ledger,
    close: () => db.close(),
  };
}

module.exports = { openFormalProvider, cookies };
