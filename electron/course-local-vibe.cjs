const {createServer} = require('node:http');
const {createHash,randomBytes} = require('node:crypto');
const {once} = require('node:events');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {findBrowser} = require('./local-capabilities.cjs');

const loopback='127.0.0.1';
const mime={html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',mjs:'text/javascript; charset=utf-8',
  css:'text/css; charset=utf-8',svg:'image/svg+xml',woff:'font/woff',woff2:'font/woff2',
  png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',ico:'image/x-icon',
  wasm:'application/wasm',json:'application/json; charset=utf-8'};
const starter='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>课程作品</title><h1>我的课程作品</h1></html>';

async function listen(server) {
  server.listen(0,loopback);
  await once(server,'listening');
  return server.address().port;
}

function hostKey(context) {
  return createHash('sha256').update(JSON.stringify([context.userId,context.courseId,context.versionId])).digest('hex');
}

async function ready(origin,token,child) {
  for(let attempt=0;attempt<120;attempt++) {
    if(child.exitCode!==null||child.signalCode) throw Error('本机 VibeCoding 服务已退出');
    try {
      const response=await fetch(`${origin}/api/server-info`,{headers:{Cookie:`zcode_lite_token=${token}`},signal:AbortSignal.timeout(400)});
      if(response.ok) return;
    } catch {}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw Error('本机 VibeCoding 服务启动超时');
}

function runtimePythonDirectories(resourceRoot){
  const bin=process.platform==='win32'?'Scripts':'bin';
  const candidates=[
    process.env.KUAIXUE_PYTHON_DIR,
    path.join(os.homedir(),'.vibe-coding','hermes-agent','venv',bin),
    path.join(resourceRoot,'python',bin),
    path.join(resourceRoot,'python'),
  ].filter(Boolean);
  return [...new Set(candidates.map(candidate=>path.resolve(candidate)).filter(candidate=>{
    try{return fs.statSync(candidate).isDirectory();}catch{return false;}
  }))];
}

function withRuntimeTools(env,resourceRoot){
  const pathKey=Object.keys(env).find(key=>key.toLowerCase()==='path')||'PATH';
  const pythonDirectories=runtimePythonDirectories(resourceRoot);
  return {
    ...env,
    ...(pythonDirectories.length?{[pathKey]:[...pythonDirectories,env[pathKey]||''].filter(Boolean).join(path.delimiter)}:{}),
    PYTHONUTF8:'1',
  };
}

async function openCourseLocalVibe({run,gateway,userId,resourceRoot,dataRoot}) {
  if(run?.mode!=='VIBECODING') throw Error('本机运行只支持 VibeCoding');
  const context={userId,courseId:run.course.id,versionId:run.course.versionId,runId:run.id,mode:'VIBECODING'};
  const [{createRuntimeBroker},{createScopedSocketAcceptor},{provisionCourseProvider},{servePreview}]=await Promise.all([
    import('../integrations/vibecoding/runtime-broker.mjs'),
    import('../integrations/vibecoding/scoped-socket.mjs'),
    import('../integrations/vibecoding/course-provider.mjs'),
    import('../integrations/vibecoding/gateway.mjs'),
  ]);
  const runtimeDir=path.join(resourceRoot,'vibe-local-runtime');
  const webRoot=path.join(resourceRoot,'vibe-course-web');
  const WebSocket=require(path.join(runtimeDir,'socket.cjs'));
  const dataDirectory=await fsp.realpath(dataRoot);
  const hostRoot=path.join(dataDirectory,'vibe-projects');
  const workspace=path.join(hostRoot,hostKey(context),'workspace');
  await fsp.mkdir(workspace,{recursive:true});
  try {await fsp.writeFile(path.join(workspace,'index.html'),run.work||starter,{flag:'wx'});}
  catch(error){if(error.code!=='EEXIST')throw error;}

  const token=randomBytes(32).toString('base64url');
  let child,profile,closed=false,lease=randomBytes(16).toString('hex');
  const profiles=path.join(dataDirectory,'vibe-profiles');
  const web=createServer();
  const connections=new Set();
  web.on('connection',socket=>{connections.add(socket);socket.on('close',()=>connections.delete(socket));});
  const checkAccess=candidate=>candidate.runId===context.runId&&candidate.userId===context.userId&&
    candidate.versionId===context.versionId&&candidate.courseId===context.courseId&&candidate.mode==='VIBECODING';
  const broker=createRuntimeBroker({filename:':memory:',checkAccess,openWorkspace:async()=>({
    path:workspace,presets:run.course.classroomConfig?.vibeCoding?.presetPrompts||[],
  })});

  async function discardProfile() {
    if(process.env.KUAIXUE_QA_KEEP_PROFILE==='1') {
      console.error('本机 VibeCoding 测试配置目录',profile);
      return;
    }
    if(!profile)return;
    const actual=await fsp.realpath(profile).catch(()=>null);
    if(actual&&path.dirname(actual)===profiles&&path.basename(actual).startsWith(`${run.id}-`)) {
      await fsp.rm(actual,{recursive:true,force:true,maxRetries:5,retryDelay:150}).catch(()=>{});
    }
  }
  function close() {
    if(closed)return;
    closed=true;
    for(const socket of connections)socket.destroy();
    web.close();
    if(child&&child.exitCode===null&&!child.signalCode)child.kill();
    else void discardProfile();
    broker.close();
  }

  try {
    const origin=`http://${loopback}:${await listen(web)}`;
    web.on('request',async(req,res)=>{
      try {
        if(`http://${req.headers.host}`!==origin){res.writeHead(403);return res.end();}
        const url=new URL(req.url,origin);
        if(req.method==='POST'&&url.pathname==='/kuaixue/runtime/exchange'&&req.headers.origin===origin){
          let body='';for await(const part of req){body+=part;if(body.length>2048)throw Error();}
          const result=await broker.exchange(JSON.parse(body));
          res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});
          return res.end(JSON.stringify(result));
        }
        const preview=/^\/kuaixue\/runtime\/preview\/([a-zA-Z0-9_-]{43})(\/.*)?$/.exec(url.pathname);
        if(preview&&['GET','HEAD'].includes(req.method)){
          try {
            const claimed=await broker.claimPreview(preview[1]);
            return await servePreview({hostRoot,context:claimed,pathname:preview[2]||'/',
              publicPath:`/kuaixue/runtime/preview/${preview[1]}${preview[2]||'/'}`,req,res});
          } catch {res.writeHead(403);return res.end();}
        }
        const prefix='/kuaixue/workbench/';
        if(req.method!=='GET'||!url.pathname.startsWith(prefix)){res.writeHead(404);return res.end();}
        const name=decodeURIComponent(url.pathname.slice(prefix.length))||'index.html';
        const file=path.resolve(webRoot,name),relative=path.relative(webRoot,file);
        if(relative.startsWith('..')||path.isAbsolute(relative))throw Error();
        const content=await fsp.readFile(file);
        res.setHeader('Content-Type',mime[path.extname(name).slice(1)]||'application/octet-stream');
        res.setHeader('Content-Security-Policy',`connect-src 'self' ${origin.replace('http:','ws:')}; object-src 'none'; form-action 'none'; base-uri 'self'`);
        res.end(content);
      } catch {if(!res.headersSent)res.writeHead(403);res.end();}
    });

    const reserve=createServer();
    const runtimePort=await listen(reserve);
    await new Promise(resolve=>reserve.close(resolve));
    const hostOrigin=`http://${loopback}:${runtimePort}`;
    await fsp.mkdir(profiles,{recursive:true});
    profile=await fsp.mkdtemp(path.join(profiles,`${run.id}-`));
    if(process.env.KUAIXUE_QA_RUNTIME==='1') console.error('本机 VibeCoding 配置目录',profile);
    await provisionCourseProvider({
      profile,context,
      platform:{hasRuntimeAccess:async()=>!closed,detail:()=>({...run.course,vibeModelIds:gateway.modelIds})},
      gateway:{...context,...gateway},
    });
    const browser=findBrowser();
    const agentArgs=[path.join(runtimeDir,'zcode.cjs'),'app-server','--stdio'];
    const providerConfig=path.join(runtimeDir,'provider','zcode-builtin.json');
    const childEnv=withRuntimeTools({
      ...process.env,
      ZCODE_DATA_BASE_DIR:profile,ZCODE_DESKTOP_HOME_DIR:profile,ZCODE_HOME:path.join(profile,'.zcode'),
      ZCODE_AGENT_SERVER_COMMAND:process.execPath,ZCODE_AGENT_SERVER_ARGS_JSON:JSON.stringify(agentArgs),
      KUAIXUE_BROWSER_EXECUTABLE:browser||'',
      ZCODE_BUILTIN_PROVIDER_CONFIG_FILE:providerConfig,
      ZCODE_PERSONAL_PROVIDER_CONFIG_FILE:path.join(profile,'.zcode','v2','provider_config.json'),
      ELECTRON_RUN_AS_NODE:'1',ZCODE_SERVER_AUTH_TOKEN:token,PORT:String(runtimePort),
    },resourceRoot);
    child=spawn(process.execPath,[path.join(runtimeDir,'course-runtime.mjs')],{
      cwd:workspace,env:childEnv,stdio:process.env.KUAIXUE_QA_RUNTIME==='1'?['ignore','ignore','inherit']:'ignore',windowsHide:true,
    });
    child.once('error',close);
    child.once('close',()=>{close();void discardProfile();});
    await ready(hostOrigin,token,child);
    const accept=createScopedSocketAcceptor({WebSocketServer:WebSocket.WebSocketServer,WebSocket,checkAccess,
      resolveHost:async()=>({...context,token,origin:hostOrigin.replace('http:','ws:')})});
    web.on('upgrade',async(req,socket,head)=>{
      try {
        if(req.headers.origin!==origin||!req.url.startsWith('/kuaixue/runtime/ws/'))throw Error();
        const claimed=await broker.claimSocket(req.url.slice('/kuaixue/runtime/ws/'.length));
        await accept({req,socket,head,context:claimed});
      }catch{socket.destroy();}
    });
    const ticket=await broker.issueRuntimeTicket(context);
    function readHtml() {
      const target=path.join(workspace,'index.html');
      const stat=fs.statSync(target);
      if(!stat.isFile()||stat.size>4_000_000) throw Error('请检查本机工程中的 index.html');
      return fs.readFileSync(target,'utf8');
    }
    function snapshot() {
      return {runId:run.id,directory:workspace,html:readHtml()};
    }
    return {
      runId:run.id,runtime:'local',lease,directory:workspace,context,snapshot,
      frameUrl:`${origin}/kuaixue/workbench/#${new URLSearchParams({run:run.id,ticket})}`,
      close,
    };
  } catch(error){close();throw error;}
}

module.exports={openCourseLocalVibe,runtimePythonDirectories,withRuntimeTools};
