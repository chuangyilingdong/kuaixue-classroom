const {createServer} = require('node:http');
const net = require('node:net');
const {spawn} = require('node:child_process');
const {randomBytes} = require('node:crypto');
const {once} = require('node:events');
const fs = require('node:fs/promises');
const path = require('node:path');
const files = require('node:fs');
const {prepareNativeProject} = require('./native-project.cjs');

const mime = {html:'text/html',js:'text/javascript',css:'text/css',svg:'image/svg+xml',woff2:'font/woff2',png:'image/png',wasm:'application/wasm',json:'application/json'};
const loopback = '127.0.0.1';
const starter = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>课程作品</title><h1>我的课程作品</h1></html>';
async function listen(server) {
  server.listen(0,loopback);
  await once(server,'listening');
  return server.address().port;
}
async function ready(origin,token,child) {
  for (let n=0;n<90;n++) {
    if (child.exitCode !== null || child.signalCode) throw Error('灵动课程运行服务已退出');
    try {
      const response = await fetch(`${origin}/api/server-info`,{headers:{Cookie:`zcode_lite_token=${token}`},signal:AbortSignal.timeout(300)});
      if (response.ok) return;
    } catch {}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw Error('灵动课程运行服务启动超时');
}
async function openLocalVibe({run,store,resourceRoot,dataRoot}) {
  const [{createRuntimeBroker},{createScopedSocketAcceptor},{provisionCourseProvider}] = await Promise.all([
    import('../integrations/vibecoding/runtime-broker.mjs'), import('../integrations/vibecoding/scoped-socket.mjs'), import('../integrations/vibecoding/course-provider.mjs'),
  ]);
  const runtimeDir = path.join(resourceRoot,'vibe-local-runtime');
  const webRoot = path.join(resourceRoot,'vibe-course-web');
  const WebSocket = require(path.join(runtimeDir,'socket.cjs'));
  const root = await fs.realpath(dataRoot);
  const directory = await prepareNativeProject(path.join(root,'demo-vibe-projects'),{runId:run.id,html:run.work ?? starter,course:run.course});
  const context = {userId:'preview-learner',courseId:run.course.id,versionId:run.course.versionId,runId:run.id,mode:'VIBECODING'};
  const checkAccess = candidate => candidate.runId === run.id && candidate.userId === context.userId && candidate.versionId === context.versionId && store.start(context.courseId,context.versionId,'VIBECODING').id === run.id;
  const broker = createRuntimeBroker({filename:':memory:',checkAccess,openWorkspace:async()=>({path:directory,presets:run.course.classroomConfig?.vibeCoding?.presetPrompts ?? []})});
  const token = randomBytes(32).toString('base64url');
  const web = createServer();
  let child,profile,closed = false;
  const profiles = path.join(root,'demo-vibe-profiles');
  async function discardProfile() {
    if (!profile) return;
    const actual = await fs.realpath(profile).catch(() => null);
    if (actual && path.dirname(actual) === profiles && path.basename(actual).startsWith(`${run.id}-`)) {
      await fs.rm(actual,{recursive:true,force:true,maxRetries:4,retryDelay:150}).catch(() => {});
    }
  }
  const connections = new Set();
  web.on('connection', socket=>{connections.add(socket);socket.on('close',()=>connections.delete(socket));});
  function close() {
    if (closed) return;
    closed = true;
    for (const socket of connections) socket.destroy();
    web.close();
    if (child && child.exitCode === null && !child.signalCode) child.kill();
    else void discardProfile();
    broker.close();
  }
  try {
    const origin = `http://${loopback}:${await listen(web)}`;
    web.on('request',async (req,res)=>{
      try {
        if (`http://${req.headers.host}` !== origin) {res.writeHead(403);return res.end();}
        const url = new URL(req.url,origin);
        if (url.pathname.startsWith('/demo-model/')) {
          res.writeHead(503,{'Content-Type':'application/json'});
          return res.end(JSON.stringify({error:{message:'本机演示使用课程工程。真实 AI 生成需登录联网课程服务。'}}));
        }
        if (req.method === 'POST' && url.pathname === '/kuaixue/runtime/exchange' && req.headers.origin === origin) {
          let body='';for await(const part of req){body+=part;if(body.length>2048) throw Error();}
          const result = await broker.exchange(JSON.parse(body));
          res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});return res.end(JSON.stringify(result));
        }
        const prefix='/kuaixue/workbench/';
        if (req.method !== 'GET' || !url.pathname.startsWith(prefix)) {res.writeHead(404);return res.end();}
        const name=decodeURIComponent(url.pathname.slice(prefix.length)) || 'index.html';
        const file=path.resolve(webRoot,name),relative=path.relative(webRoot,file);
        if (relative.startsWith('..') || path.isAbsolute(relative)) throw Error();
        const content=await fs.readFile(file);
        res.setHeader('Content-Type',mime[path.extname(name).slice(1)] || 'application/octet-stream');
        res.setHeader('Content-Security-Policy',`connect-src 'self' ${origin.replace('http:', 'ws:')}; object-src 'none'; form-action 'none'; base-uri 'self'`);
        res.end(content);
      } catch {if (!res.headersSent) res.writeHead(403);res.end();}
    });
    const reserve=net.createServer();const runtimePort=await listen(reserve);await new Promise(r=>reserve.close(r));
    const hostOrigin=`http://${loopback}:${runtimePort}`;
    await fs.mkdir(profiles,{recursive:true});
    // A host lease has a private profile, while editable files stay in the persistent course folder.
    profile=await fs.mkdtemp(path.join(profiles,`${run.id}-`));
    const demoModel='kuaixue-local-preview';
    await provisionCourseProvider({profile,context,platform:{hasRuntimeAccess:checkAccess,detail:()=>({...run.course,vibeModelIds:[demoModel]})},gateway:{...context,token:'local-preview-only',baseUrl:origin+'/demo-model/v1',modelIds:[demoModel],expiresAt:Date.now()+86400000}});
    const childEnv={PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,TEMP:profile,TMP:profile,HOME:profile,USERPROFILE:profile,LOCALAPPDATA:profile,APPDATA:profile,ZCODE_DATA_BASE_DIR:profile,ZCODE_DESKTOP_HOME_DIR:profile,ZCODE_HOME:path.join(profile,'.zcode'),ELECTRON_RUN_AS_NODE:'1',ZCODE_SERVER_AUTH_TOKEN:token,PORT:String(runtimePort)};
    child=spawn(process.execPath,[path.join(runtimeDir,'course-runtime.mjs')],{cwd:directory,env:childEnv,stdio:process.env.KUAIXUE_QA_RUNTIME === '1' ? ['ignore','ignore','inherit'] : 'ignore',windowsHide:true});
    child.once('error',close);
    child.once('close',() => {close();void discardProfile();});
    await ready(hostOrigin,token,child);
    const accept=createScopedSocketAcceptor({WebSocketServer:WebSocket.WebSocketServer,WebSocket,checkAccess,resolveHost:async()=>({...context,token,origin:hostOrigin.replace('http:','ws:')})});
    web.on('upgrade',async(req,socket,head)=>{
      try {
        if (req.headers.origin!==origin || !req.url.startsWith('/kuaixue/runtime/ws/')) throw Error();
        const claim=await broker.claimSocket(req.url.slice('/kuaixue/runtime/ws/'.length));
        await accept({req,socket,head,context:claim});
      }catch{socket.destroy();}
    });
    const ticket=await broker.issueRuntimeTicket(context);
    const htmlPath=path.join(directory,'index.html');
    function readHtml() {
      if (closed || files.realpathSync(htmlPath) !== htmlPath || files.statSync(htmlPath).size > 4_000_000) throw Error('请检查课程工程中的 index.html');
      return files.readFileSync(htmlPath,'utf8');
    }
    function save(update) {
      if (update.id !== run.id || update.mode !== 'VIBECODING') throw Error('工作区与课程不符');
      const previous = readHtml();
      const next = update.edited ? update.work : previous;
      if (typeof next !== 'string' || Buffer.byteLength(next) > 4_000_000) throw Error('作品超过 4 MB');
      if (update.edited && previous !== update.original) throw Error('工程文件已更新，请重新打开作品编辑');
      if (next !== previous) files.writeFileSync(htmlPath,next);
      try {return store.save({...update,work:next});}
      catch (error) {if (next !== previous) files.writeFileSync(htmlPath,previous);throw error;}
    }
    return {runId:run.id,readHtml,save,lease:randomBytes(16).toString('hex'),frameUrl:`${origin}/kuaixue/workbench/#${new URLSearchParams({run:run.id,ticket})}`,close};
  } catch(error){close();throw error;}
}
module.exports={openLocalVibe};
