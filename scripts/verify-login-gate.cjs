const {app, session, BrowserWindow, protocol} = require('electron');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const {setTimeout:delay} = require('node:timers/promises');
const path = require('node:path');
app.setPath('userData',require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(),'kx-gate-')));
let legacy=true, signed=false, exchanges=0, query;
const json = (body,status=200) => new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'kuaixue://classroom','Access-Control-Allow-Credentials':'true'}});
app.whenReady().then(()=>{
  app.userAgentFallback = 'KuaixueDesktopQA/1.0';
  session.fromPartition('kuaixue-official-account').setUserAgent(app.userAgentFallback);
  protocol.handle('https',async req=>{
    switch(new URL(req.url).pathname) {
      case '/api/v1/me': return signed ? json({data:{user:{id:'fixture',name:'Fixture'},points:1,entitlements:[]}}) : json({},401);
      case '/api/v1/desktop/session': {
        const body=await req.json(); assert.equal(body.code,'fixture');
        assert.equal(createHash('sha256').update(body.verifier).digest('base64url'),query.get('code_challenge'));
        exchanges++;signed=true;return json({data:{authenticated:true}});
      }
      case '/api/v1/catalog/courses': return json({data:{items:[],page:{total:0,limit:20,nextCursor:null}}});
      default: return json({},404);
    }
  });
  const account = session.fromPartition('kuaixue-official-account');
  account.protocol.handle('https',req=>{
    const url=new URL(req.url);
    if(url.pathname === '/kuaixue/desktop/authorize') {
      query=url.searchParams; assert.equal(query.get('ui'),'kx-class-v1');
      if(!legacy) return Response.redirect(url.origin+'/kuaixue/sign-in/',303);
      return new Response('<h1>授权快学课堂</h1>',{headers:{'Content-Type':'text/html;charset=utf-8'}});
    }
    if(url.pathname !== '/kuaixue/sign-in/') return json({},404);
    const callback=query.get('redirect_uri')+'?code=fixture&amp;state='+query.get('state');
    return new Response(`<meta name="kx-sign-in" content="1"><a href="${callback}">模拟本人完成登录</a>`, {headers:{'Content-Type':'text/html;charset=utf-8'}});
  });
});
require('../electron/main.cjs');
app.once('browser-window-created',(_,win)=>win.webContents.once('did-finish-load',async()=>{
  const js=expr=>win.webContents.executeJavaScript(expr);
  const remote=()=>win.contentView.children.find(child=>child.webContents && child.webContents!==win.webContents)?.webContents;
  const wait=async(test)=>{for(let tries=0;tries<100;tries++){if(await test())return;await delay(60);}throw Error(String(test));};
  try {
    await wait(()=>js('document.body.textContent.includes("尚未在主站启用")'));assert.equal(remote(),undefined);
    legacy=false; await js('document.querySelector(".kx-submit").click()');await wait(()=>!!remote());
    await js('document.querySelector(".kx-back").click()');await wait(()=>!remote());await wait(()=>js('!!document.querySelector(".kx-submit")'));assert.equal(exchanges,0);
    await js('document.querySelector(".kx-submit").click()');await wait(()=>!!remote());assert.equal(await remote().executeJavaScript('typeof window.kuaixueDesktop'),'undefined');
    await remote().executeJavaScript('document.querySelector("a").click()');await wait(()=>js('!!document.querySelector(".desktop[data-view=home]")'));
    assert.equal(exchanges,1);assert.equal(BrowserWindow.getAllWindows().length,1);
    win.webContents.reload();await delay(300);await wait(()=>js('!!document.querySelector(".desktop[data-view=home]")'));assert.equal(exchanges,1);
    console.log('PASS desktop: legacy refused, direct trusted view, cancel/retry, one window, PKCE exchange, home, session reuse');app.exit(0);
  }catch(error){console.error(error);app.exit(1);}
}));
setTimeout(()=>app.exit(2),35000).unref();
