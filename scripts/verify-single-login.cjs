// Local fixture only. Serve the built account page over loopback and exercise its real DOM.
const {app, BrowserWindow, session} = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {setTimeout:delay} = require('node:timers/promises');
const root = path.resolve(__dirname, '../release/kx-class-login-site/sign-in');
let completed = 0, phoneRequests = 0;
let sessions = 0, polls = 0, expiresIn = 20000, wxStatus = 'pending';
const widgetRequests = [];
const sessionModes = [];
let delayedPoll;
const server = http.createServer(async (req, res) => {
  const {pathname} = new URL(req.url, 'http://localhost');
  const json = (obj, status=200) => { res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(obj)); };
  if (pathname === '/fixture-official-widget') { res.setHeader('Content-Type','text/html'); res.end('<title>Official widget fixture</title>'); return; }
  if (pathname === '/api/auth/login-phone') {
    phoneRequests++;
    return phoneRequests === 1 ? json({error:'验证码错误'},400) : json({token:'local-fixture'});
  }
  if (pathname === '/api/auth/captcha/config') return json({sceneId:'',localFallback:false});
  if (pathname === '/api/auth/wechat/desktop-session') {
    sessionModes.push(new URL(req.url, 'http://localhost').searchParams.get('ui'));
    const state = (++sessions).toString(16).padStart(32, '0');
    return json({sessionId:state,qrUrl:`https://open.weixin.qq.com/connect/qrconnect?state=${state}`,expiresAt:new Date(Date.now()+expiresIn).toISOString()});
  }
  if (pathname.startsWith('/api/auth/wechat/poll/')) {
    polls++;
    if (wxStatus === 'delayed') { delayedPoll = () => json({status:'authorized',token:'old-fixture'}); return; }
    return json({status:wxStatus,token:'local-fixture',pendingToken:'local-binding'});
  }
  if (pathname === '/kuaixue/desktop/authorize/complete') { completed++; return json({redirect:'/kuaixue/desktop/callback?code=local&state=local'}); }
  if (pathname === '/kuaixue/desktop/callback') { res.end('local callback');return; }
  if (!pathname.startsWith('/kuaixue/sign-in/')) {res.writeHead(404); res.end(); return;}
  const file = path.resolve(root, pathname.slice('/kuaixue/sign-in/'.length) || 'index.html');
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) {res.writeHead(404);res.end();return;}
  res.writeHead(200,{'Content-Type':{'.html':'text/html;charset=utf-8','.js':'text/javascript','.css':'text/css','.webp':'image/webp'}[path.extname(file)]});
  res.end(fs.readFileSync(file));
});
app.whenReady().then(async () => {
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const origin = 'http://127.0.0.1:'+server.address().port;
  const isolated = session.fromPartition('local-login-qa');
  isolated.webRequest.onBeforeRequest((details,done) => {
    const url = new URL(details.url);
    if (details.resourceType === 'subFrame' && url.origin === 'https://open.weixin.qq.com' && url.pathname === '/connect/qrconnect') {
      widgetRequests.push(url); done({redirectURL:origin+'/fixture-official-widget'}); return;
    }
    done({cancel: !details.url.startsWith(origin+'/') && !details.url.startsWith('data:')});
  });
  const win = new BrowserWindow({show:false,width:1440,height:900,webPreferences:{session:isolated,sandbox:true,offscreen:true}});
  const js = expr => win.webContents.executeJavaScript(expr);
  const wait = async (test) => { for(let i=0; i<100; i++) {if(await test())return; await delay(60);} throw Error(String(test)); };
  const tab = i => js(`document.querySelectorAll('.kx-tabs button')[${i}].click()`);
  const open = () => win.loadURL(origin+'/kuaixue/sign-in/');
  try {
    await open(); await wait(()=>js('!!document.querySelector("input[name=phone]")'));
    assert.equal(await js('document.querySelector("#agree").checked'),false);
    assert.equal(await js('getComputedStyle(document.body).fontFamily'),'"Noto Sans SC", "Source Han Sans SC", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif');
    if(process.env.KX_LOGIN_QA_SCREENSHOT) {
      const debuggerSession = win.webContents.debugger;
      debuggerSession.attach();
      await debuggerSession.sendCommand('Emulation.setDeviceMetricsOverride',{width:1440,height:868,deviceScaleFactor:1,mobile:false});
      await delay(200);
      const {data} = await debuggerSession.sendCommand('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
      fs.writeFileSync(process.env.KX_LOGIN_QA_SCREENSHOT,Buffer.from(data,'base64'));
      debuggerSession.detach();
    }
    await tab(1);
    await js('document.querySelector("[name=email]").value="fixture@example.invalid";document.querySelector("[name=password]").value="fixture";document.querySelector("#agree").click();document.querySelector(".kx-submit").click()');
    await wait(()=>js('document.body.textContent.includes("关闭并重试")'));
    await js('[...document.querySelectorAll("button")].find(el=>el.textContent==="关闭并重试").click()');
    await tab(0); await js('document.querySelector("#agree").click();document.querySelector("[name=phone]").value="13800000000";document.querySelector("[name=code]").value="123456";document.querySelector(".kx-submit").click()');
    assert.equal(await js('document.activeElement.id'),'agree'); assert.equal(phoneRequests,0);
    await js('document.querySelector("#agree").click();document.querySelector(".kx-submit").click()');
    await wait(()=>js('document.querySelector("[role=status]").textContent === "验证码错误"')); assert.equal(completed,0);
    await js('document.querySelector(".kx-submit").click()'); await wait(()=>win.webContents.getURL().includes('/callback?')); assert.equal(completed,1);
    const hasQr = () => widgetRequests.at(-1)?.searchParams.get('state') === sessions.toString(16).padStart(32,'0') && js('!!document.querySelector(".kx-code-frame iframe") && !document.querySelector(".kx-code-frame img")');
    const consent = () => js('document.querySelector("#agree").click()');
    const gated = () => js('!document.querySelector("#agree").checked && !document.querySelector(".kx-scan iframe,.kx-scan button") && document.body.textContent.includes("请先勾选")');
    await open(); await tab(2); await wait(gated); await delay(1900);
    assert.deepEqual([sessions,polls,widgetRequests.length,completed],[0,0,0,1]);
    wxStatus='delayed'; await consent(); await wait(hasQr); await wait(()=>!!delayedPoll);
    const qrLayout = () => js(`(()=>{
      const frame=document.querySelector('.kx-code-frame').getBoundingClientRect();
      const widget=document.querySelector('.kx-code-frame iframe').getBoundingClientRect();
      return [widget.width, widget.height, widget.left-frame.left, widget.top-frame.top, frame.right-widget.right, frame.bottom-widget.bottom].map(Math.round);
    })()`);
    assert.deepEqual(await qrLayout(),[160,160,12,12,12,12]);
    assert.equal(widgetRequests[0].searchParams.get('login_type'),'jssdk');
    assert.equal(widgetRequests[0].searchParams.get('self_redirect'),'true');
    await consent(); await wait(gated); delayedPoll(); await delay(1950);
    assert.deepEqual([sessions,polls,completed],[1,1,1]);
    wxStatus='pending'; await consent(); await wait(hasQr);
    assert.notEqual(widgetRequests[0].searchParams.get('state'), widgetRequests[1].searchParams.get('state'));
    await tab(1); const previousPolls = polls; wxStatus='authorized'; await delay(1900);
    assert.equal(polls,previousPolls); assert.equal(completed,1);
    expiresIn=-1; await tab(2); await wait(()=>js('document.body.textContent.includes("二维码已过期")'));
    assert.equal(sessions,3); expiresIn=20000; wxStatus='pending';
    await js('document.querySelector(".kx-code-frame button").click()'); await wait(hasQr); assert.equal(sessions,4);
    wxStatus='authorized'; await wait(()=>win.webContents.getURL().includes('/callback?')); assert.equal(completed,2);
    await open(); await js('document.querySelector("#agree").click()'); wxStatus='wechat_pending'; await tab(2);
    await wait(()=>js('!!document.querySelector("input[name=phone]") && document.body.textContent.includes("绑定并登录")'));
    assert.equal(completed,2); assert.equal(BrowserWindow.getAllWindows().length,1);
    assert.ok(sessionModes.every(mode => mode === 'kx-class-v1'));
    console.log('PASS phone/email, consent before session and widget, withdrawal during poll, fresh QR, tab cancellation, expiry, confirmed callback, phone binding');
    app.exit(0);
  } catch (error) {console.error(error);app.exit(1);}
});
setTimeout(()=>app.exit(2),35000).unref();
