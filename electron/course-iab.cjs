const {randomUUID}=require('node:crypto');
const {isSafeCourseBrowserUrl}=require('./course-browser-policy.cjs');
// Only main-issued, session-owned tabs are controllable. Human tabs are never claimed.
const byHost=new WeakMap();
const failed=(message,code='backend_unavailable')=>({ok:false,error:{code,message},elapsedMs:0});
const ok=fields=>({ok:true,elapsedMs:0,...fields});
function createCourseIab({host,lease,executePage}) {
  const id=`iab:${randomUUID()}`, tabs=new Map();
  const send=(action,key)=>{if(!host.isDestroyed())host.send('browser:agent-tab',{lease,action,key});};
  let closed=false;
  function remove(key,notify=true){
    const row=tabs.get(key); if(!row)return;
    tabs.delete(key); row.abort.abort(); row.finish?.(null);
    if(notify)send('close',key);
  }
  async function summary(row){
    const guest=row.guest;
    const viewport=await guest.executeJavaScript('({width:innerWidth,height:innerHeight})');
    return {tabId:row.key,url:guest.getURL(),title:guest.getTitle(),viewport};
  }
  const bridge={id,
    pending(key){return !!tabs.get(key)?.finish;},
    pendingKeys(){return [...tabs.values()].filter(row=>row.finish).map(row=>row.key);},
    attach(key,guest){
      const row=tabs.get(key); if(!row?.finish)return false;
      row.guest=guest; guest.once('destroyed',()=>remove(key,false)); row.finish(guest);return true;
    },
    async execute(input){
      if(closed || input?.browserId!==id || input.browserGeneration!==1 || !input.sessionId || !input.command) return failed('侧栏会话无效');
      const {sessionId,command}=input;
      const owned=()=>[...tabs.values()].filter(row=>row.sessionId===sessionId);
      if(command.method==='list')return ok({tabs:await Promise.all(owned().filter(row=>row.guest).map(summary))});
      if(command.method==='listUserTabs')return ok({userTabs:[]});
      if(command.method==='closeSession'){for(const row of owned())remove(row.key);return ok();}
      if(command.method==='turnEnded')return ok();
      if(command.method==='newTab'){
        if(tabs.size>=24)return failed('课程侧栏标签页已达上限');
        const key=`kx-iab-${randomUUID()}`, row={key,sessionId,abort:new AbortController()};
        tabs.set(key,row);
        const attached=await new Promise(resolve=>{
          const timer=setTimeout(()=>remove(key),10000);
          row.finish=guest=>{clearTimeout(timer);delete row.finish;resolve(guest);};
          send('new',key);
        });
        return attached ? ok({tab:await summary(row)}) : failed('未收到课程侧栏标签就绪确认');
      }
      const row=tabs.get(command.tabId);
      if(!row?.guest || row.sessionId!==sessionId)return failed('当前任务没有这个侧栏标签');
      if(command.method==='activateTab'){send('activate',row.key);return ok({tab:await summary(row)});}
      if(command.method==='close'){remove(row.key);return ok();}
      if(command.method==='navigate' && !isSafeCourseBrowserUrl(command.url))return failed('侧栏只支持 HTTP/HTTPS 网页','execution_error');
      // The upstream executor accepts typed page commands, not arbitrary debugger commands.
      const guest=row.guest;
      const view={webContents:guest,cdp:{send:(method,params,session)=>{
        if(row.abort.signal.aborted)throw Error('侧栏标签已关闭');
        if(!guest.debugger.isAttached())guest.debugger.attach('1.3');
        return guest.debugger.sendCommand(method,params,session);
      }},captureViewportScreenshot:async()=>(await guest.capturePage()).toPNG().toString('base64')};
      return executePage(view,command,{signal:row.abort.signal});
    },
    close(){closed=true;for(const key of tabs.keys())remove(key);if(byHost.get(host)===bridge)byHost.delete(host);},
  };
  byHost.get(host)?.close();byHost.set(host,bridge);return bridge;
}
module.exports={createCourseIab,courseIabFor:host=>byHost.get(host)};
