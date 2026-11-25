const {randomBytes,createHash} = require('node:crypto');

function begin(config) {
  const authorize = new URL(config.authorizeUrl);
  if (!['https://www.aicyld.com.cn','https://aicyld.com.cn'].includes(authorize.origin) || !config.clientId) throw Error('主站桌面授权尚未配置');
  const verifier = randomBytes(48).toString('base64url');
  const state = randomBytes(32).toString('base64url');
  const redirect = `${config.apiOrigin}/kuaixue/desktop/callback`;
  authorize.searchParams.set('ui', 'kx-class-v1');
  for (const [key,value] of Object.entries({client_id:config.clientId, redirect_uri:redirect,response_type:'code',state,
    code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url')})) authorize.searchParams.set(key,value);
  return {authorize,verifier,state,redirect};
}
function readCallback(url, flow) {
  const next = new URL(url);
  if (next.origin + next.pathname !== flow.redirect) return null;
  if (next.searchParams.get('state') !== flow.state || !next.searchParams.get('code')) throw Error('主站授权未完成，请重试');
  return next.searchParams.get('code');
}
function isCallbackUrl(url, flow) {
  try {
    const next = new URL(url);
    return next.origin + next.pathname === flow.redirect;
  } catch { return false; }
}
const active = new WeakMap();
function cancelLogin(parent) { active.get(parent)?.cancel(); }
async function desktopLogin(parent,config) {
  if (active.has(parent)) return active.get(parent).promise;
  const {WebContentsView,shell} = require('electron');
  const flow = begin(config);
  const view = new WebContentsView({webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,
    partition:'kuaixue-official-account',devTools:false,autoplayPolicy:'no-user-gesture-required'}});
  const contents = view.webContents;
  const accountStyled = require('./account-typography.cjs').applyAccountTypography(contents,flow.authorize.origin);
  const owner = parent.webContents;
  const controller = new AbortController();
  const {promise, resolve, reject} = Promise.withResolvers();
  let exchanging = false;
  let shown = false;
  const signIn = new URL('/kuaixue/sign-in/', flow.authorize.origin).href;
  const supportLinks = new Set(['/forgot-password','/pages/user-agreement/page-mr39n395-8bzp','/pages/user-agreement/page-mr39n7w0-y29q'].map(path => flow.authorize.origin + path));
  const cancel = () => { controller.abort(); resolve({cancelled:true}); };
  const cancelFromUI = () => { if (!exchanging) cancel(); };
  const fail = () => reject(Error('主站登录页无法打开，请重试'));
  function resize() {
    const [width,height] = parent.getContentSize();
    const top = Math.min(32, height);
    view.setBounds({x:0,y:top,width,height:height-top});
  }
  function ownerNavigated(event) { if (event.isMainFrame && !event.isSameDocument) cancel(); }
  async function navigate(event) {
      if (!event.isMainFrame) return;
      const href = event.url;
      try {
        const code = readCallback(href,flow);
        if (!code) {if (href !== signIn && href !== flow.authorize.href) {event.preventDefault();fail();} return;}
        event.preventDefault();
        if (exchanging || controller.signal.aborted) return;
        exchanging = true;
        const response = await owner.session.fetch(config.apiOrigin+'/api/v1/desktop/session',{
          method:'POST',credentials:'include',redirect:'error',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)]),headers:{'Content-Type':'application/json'},
          body:JSON.stringify({code,verifier:flow.verifier,redirectUri:flow.redirect,clientId:config.clientId}),
        });
        if (!response.ok || (await response.json()).data?.authenticated !== true) throw Error('快学会话建立失败');
        resolve({cancelled:false});
      } catch (error) {event.preventDefault();reject(error);}
  }
  active.set(parent,{promise,cancel:cancelFromUI});
  try {
    contents.setWindowOpenHandler(({url}) => {if (supportLinks.has(url)) void shell.openExternal(url); return {action:'deny'};});
    contents.on('did-finish-load', async () => {
      try {
        if (isCallbackUrl(contents.getURL(), flow)) return;
        if (contents.getURL() !== signIn || !await contents.executeJavaScript(`document.querySelector('meta[name="kx-sign-in"]')?.content === '1'`)) {
          reject(Error('主站尚未提供新版快学登录页')); return;
        }
        await accountStyled();
        if (!shown && !controller.signal.aborted && !contents.isDestroyed()) {
          parent.contentView.addChildView(view); shown = true; resize(); contents.focus();
        }
      } catch { fail(); }
    });
    contents.on('will-navigate',navigate);
    contents.on('will-redirect',navigate);
    contents.on('render-process-gone',fail);
    contents.on('did-fail-load',(_event,code,_description,_url,mainFrame) => {if (mainFrame && code !== -3) fail();});
    contents.once('destroyed',cancel);
    parent.once('closed',cancel);
    parent.on('resize',resize);
    owner.once('render-process-gone',cancel);
    owner.on('did-start-navigation',ownerNavigated);
    const loadTimeout = setTimeout(() => {if (!shown) fail();}, 20000);
    void contents.loadURL(flow.authorize.href).catch(error => {if (!exchanging && error.code !== 'ERR_ABORTED') fail();});
    try { return await promise; } finally { clearTimeout(loadTimeout); }
  } finally {
    active.delete(parent);
    parent.off('resize',resize);
    parent.off('closed',cancel);
    owner.off('render-process-gone',cancel);
    owner.off('did-start-navigation',ownerNavigated);
    if (shown && !parent.isDestroyed()) parent.contentView.removeChildView(view);
    if (!contents.isDestroyed()) contents.close();
    if (!owner.isDestroyed()) owner.focus();
  }
}
module.exports = {begin,readCallback,isCallbackUrl,desktopLogin,cancelLogin};
