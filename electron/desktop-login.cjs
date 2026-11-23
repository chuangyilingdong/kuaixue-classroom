const {randomBytes,createHash} = require('node:crypto');

function begin(config) {
  const authorize = new URL(config.authorizeUrl);
  if (!['https://www.aicyld.com.cn','https://aicyld.com.cn'].includes(authorize.origin) || !config.clientId) throw Error('主站桌面授权尚未配置');
  const verifier = randomBytes(48).toString('base64url');
  const state = randomBytes(32).toString('base64url');
  const redirect = `${config.apiOrigin}/kuaixue/desktop/callback`;
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
let active;
async function desktopLogin(parent,config) {
  if (active) return active;
  const {BrowserWindow} = require('electron');
  const flow = begin(config);
  const login = new BrowserWindow({parent,width:700,height:720,autoHideMenuBar:true,
    webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,partition:'kuaixue-official-account'}});
  login.webContents.setWindowOpenHandler(() => ({action:'deny'}));
  active = new Promise((resolve,reject) => {
    let exchanging = false;
    function navigate(event,address) {
      const href = typeof address === 'string' ? address : address.url;
      try {
        const code = readCallback(href,flow);
        if (!code) {if (new URL(href).origin !== flow.authorize.origin) event.preventDefault(); return;}
        event.preventDefault();
        if (exchanging) return;
        exchanging = true;
        // Session cookie belongs to the course API. Only the main process sees the verifier.
        parent.webContents.session.fetch(config.apiOrigin+'/api/v1/desktop/session',{
          method:'POST',credentials:'include',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json'},
          body:JSON.stringify({code,verifier:flow.verifier,redirectUri:flow.redirect,clientId:config.clientId}),
        }).then(response => {if (!response.ok) throw Error('快学会话建立失败'); resolve();}).catch(reject).finally(() => {if (!login.isDestroyed()) login.close();});
      } catch (error) {event.preventDefault();reject(error);login.close();}
    }
    login.webContents.on('will-navigate',navigate);
    login.webContents.on('will-redirect',navigate);
    login.on('closed',() => {if (!exchanging) reject(Error('已关闭主站登录'));});
    login.loadURL(flow.authorize.href).catch(() => {if (!exchanging) {reject(Error('授权页打开失败')); if (!login.isDestroyed()) login.close();}});
  }).finally(() => {active = null;});
  return active;
}
module.exports = {begin,readCallback,desktopLogin};
