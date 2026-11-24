const {createServer} = require('node:http');
const {createHash,randomBytes} = require('node:crypto');
const {once} = require('node:events');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {DatabaseSync} = require('node:sqlite');
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

function courseWorkspaceName(title, context) {
  const fallback='课程工程';
  const safe=String(title||fallback)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_')
    .replace(/[. ]+$/g,'')
    .replace(/\s+/g,' ')
    .trim()
    .slice(0,48)||fallback;
  return `${safe}-${hostKey(context).slice(0,8)}`;
}

function profileScore(directory) {
  let score=0;
  try {
    const db=new DatabaseSync(path.join(directory,'.zcode','v2','tasks-index.sqlite'),{readOnly:true});
    try {
      const hasProjects=db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table' AND name='projects'").get()?.n;
      const projects=hasProjects?db.prepare('SELECT count(*) n FROM projects').get().n:0;
      const hasTasks=db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table' AND name='tasks'").get()?.n;
      const tasks=hasTasks?db.prepare('SELECT count(*) n FROM tasks').get().n:0;
      score=Number(projects||0)*100000+Number(tasks||0)*100;
    } finally {db.close();}
  } catch {}
  return score;
}

const runtimeFingerprintByRoot=new Map();
function courseRuntimeFingerprint(resourceRoot) {
  const key=path.resolve(resourceRoot);
  const cached=runtimeFingerprintByRoot.get(key);
  if(cached)return cached;
  const hash=createHash('sha256');
  for(const relative of ['vibe-local-runtime/zcode.cjs','vibe-local-runtime/course-runtime.mjs']) {
    hash.update(relative);
    hash.update(fs.readFileSync(path.join(key,relative)));
  }
  const value=hash.digest('hex');
  runtimeFingerprintByRoot.set(key,value);
  return value;
}

async function reconcileCourseProfileRuntime(profile,resourceRoot) {
  if(!profile||!resourceRoot)return false;
  const fingerprint=courseRuntimeFingerprint(resourceRoot);
  const marker=path.join(profile,'.kuaixue-runtime.json');
  let previous=null;
  try {previous=JSON.parse(await fsp.readFile(marker,'utf8'))?.fingerprint||null;} catch {}
  if(previous===fingerprint)return false;
  const versionDir=path.join(profile,'.zcode','v2');
  const indexFiles=['tasks-index.sqlite','tasks-index.sqlite-wal','tasks-index.sqlite-shm'];
  const existing=[];
  for(const name of indexFiles) {
    const file=path.join(versionDir,name);
    if(await fsp.stat(file).then(value=>value.isFile(),()=>false))existing.push(file);
  }
  if(existing.length) {
    const archive=path.join(profile,'.zcode','legacy-task-index',
      `${Date.now()}-${String(previous||'unknown').slice(0,12)}`);
    await fsp.mkdir(archive,{recursive:true,mode:0o700});
    for(const file of existing)await fsp.rename(file,path.join(archive,path.basename(file)));
  }
  await fsp.writeFile(marker,JSON.stringify({fingerprint,updatedAt:new Date().toISOString()}),{mode:0o600});
  return existing.length>0;
}

async function legacyTaskIds(profile) {
  const root=path.join(profile,'.zcode','legacy-task-index');
  let entries=[];
  try {entries=(await fsp.readdir(root,{withFileTypes:true})).filter(entry=>entry.isDirectory());} catch {return [];}
  const ids=new Set();
  for(const entry of entries) {
    const filename=path.join(root,entry.name,'tasks-index.sqlite');
    if(!await fsp.stat(filename).then(value=>value.isFile(),()=>false))continue;
    try {
      const db=new DatabaseSync(filename,{readOnly:true});
      try {
        const hasTasks=db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table' AND name='tasks'").get()?.n;
        if(hasTasks)for(const row of db.prepare('SELECT task_id FROM tasks').all())if(row.task_id)ids.add(row.task_id);
      } finally {db.close();}
    } catch {}
  }
  return [...ids];
}

async function hideLegacyTasks(profile) {
  const ids=await legacyTaskIds(profile);
  if(!ids.length)return 0;
  const filename=path.join(profile,'.zcode','v2','tasks-index.sqlite');
  if(!await fsp.stat(filename).then(value=>value.isFile(),()=>false))return 0;
  try {
    const db=new DatabaseSync(filename);
    try {
      db.exec('PRAGMA busy_timeout=2000');
      const hasTasks=db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table' AND name='tasks'").get()?.n;
      if(!hasTasks)return 0;
      const statement=db.prepare('UPDATE tasks SET archived=1, deleted=1 WHERE task_id=?');
      let changed=0;
      for(const id of ids)changed+=Number(statement.run(id).changes||0);
      return changed;
    } finally {db.close();}
  } catch {return 0;}
}

async function prepareCourseProfile(profiles,runId,profile,allowLegacyMigration=true) {
  const exists=await fsp.stat(profile).then(value=>value.isDirectory(),()=>false);
  if(exists)return profile;
  if(!allowLegacyMigration) {
    await fsp.mkdir(profile,{recursive:true,mode:0o700});
    return profile;
  }
  let candidates=[];
  try {
    candidates=(await fsp.readdir(profiles,{withFileTypes:true}))
      .filter(entry=>entry.isDirectory()&&entry.name.startsWith(`${runId}-`))
      .map(entry=>({path:path.join(profiles,entry.name),name:entry.name}));
  } catch {}
  const scored=await Promise.all(candidates.map(async candidate=>({
    ...candidate,
    score:profileScore(candidate.path),
    mtime:(await fsp.stat(candidate.path).catch(()=>null))?.mtimeMs||0,
  })));
  scored.sort((a,b)=>b.score-a.score||b.mtime-a.mtime);
  if(scored[0]) {
    await fsp.cp(scored[0].path,profile,{recursive:true,force:false,errorOnExist:false}).catch(()=>{});
  }
  await fsp.mkdir(profile,{recursive:true,mode:0o700});
  return profile;
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
  const workspace=path.join(hostRoot,courseWorkspaceName(run.course.title,context));
  const legacyWorkspace=path.join(hostRoot,hostKey(context),'workspace');
  await fsp.mkdir(workspace,{recursive:true});
  if(workspace!==legacyWorkspace&&!fs.existsSync(path.join(workspace,'index.html'))&&fs.existsSync(legacyWorkspace)) {
    await fsp.cp(legacyWorkspace,workspace,{recursive:true,force:false,errorOnExist:false});
  }
  try {await fsp.writeFile(path.join(workspace,'index.html'),run.work||starter,{flag:'wx'});}
  catch(error){if(error.code!=='EEXIST')throw error;}

  const token=randomBytes(32).toString('base64url');
  let child,profile,closed=false,lease=randomBytes(16).toString('hex');
  const previewRoots=new Map();
  const profiles=path.join(dataDirectory,'vibe-profiles');
  const web=createServer();
  const connections=new Set();
  web.on('connection',socket=>{connections.add(socket);socket.on('close',()=>connections.delete(socket));});
  const checkAccess=candidate=>candidate.runId===context.runId&&candidate.userId===context.userId&&
    candidate.versionId===context.versionId&&candidate.courseId===context.courseId&&candidate.mode==='VIBECODING';
  const broker=createRuntimeBroker({filename:':memory:',checkAccess,openWorkspace:async()=>({
    path:workspace,
    presets:run.course.classroomConfig?.vibeCoding?.presetPrompts||[],
    modelLabels:run.course.vibeModelLabels||{},
  })});

  async function discardProviderCredential() {
    if(process.env.KUAIXUE_QA_KEEP_PROFILE==='1') {
      console.error('本机 VibeCoding 测试配置目录',profile);
      return;
    }
    if(!profile)return;
    await fsp.rm(path.join(profile,'.zcode','v2','provider_config.json'),{force:true}).catch(()=>{});
  }
  function close() {
    if(closed)return;
    closed=true;
    for(const socket of connections)socket.destroy();
    web.close();
    if(child&&child.exitCode===null&&!child.signalCode)child.kill();
    void discardProviderCredential();
    previewRoots.clear();
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
        if(process.env.KUAIXUE_QA_WRAPPER==='1'&&req.method==='GET'&&url.pathname==='/kuaixue/workbench/qa-wrapper'){
          res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
          return res.end(`<!doctype html><meta charset="utf-8"><style>html,body,iframe{margin:0;width:100%;height:100%;border:0}</style><iframe sandbox="allow-scripts allow-same-origin"></iframe><script>const frame=document.querySelector('iframe');frame.src='/kuaixue/workbench/'+location.hash;addEventListener('message',event=>{if(event.source!==frame.contentWindow||event.data?.type!=='kuaixue-classroom-paths-request')return;const selected=new URLSearchParams(location.search).get('path');event.source.postMessage({type:'kuaixue-classroom-paths-result',requestId:event.data.requestId,paths:selected?[selected]:[]},event.origin)})</script>`);
        }
        const preview=/^\/kuaixue\/runtime\/preview\/([a-zA-Z0-9_-]{43})(\/.*)?$/.exec(url.pathname);
        if(preview&&['GET','HEAD'].includes(req.method)){
          try {
            const claimed=await broker.claimPreview(preview[1]);
            const previewRoot=previewRoots.get(preview[1]);
            if(!previewRoot)throw Error('预览授权无工程目录');
            return await servePreview({hostRoot,context:claimed,pathname:preview[2]||'/',
              publicPath:`/kuaixue/runtime/preview/${preview[1]}${preview[2]||'/'}`,req,res,
              workspaceRoot:previewRoot,frameAncestors:`kuaixue://classroom ${origin}`});
          } catch {res.writeHead(403);return res.end();}
        }
        const prefix='/kuaixue/workbench/';
        if(req.method!=='GET'||!url.pathname.startsWith(prefix)){res.writeHead(404);return res.end();}
        const name=decodeURIComponent(url.pathname.slice(prefix.length))||'index.html';
        const file=path.resolve(webRoot,name),relative=path.relative(webRoot,file);
        if(relative.startsWith('..')||path.isAbsolute(relative))throw Error();
        const content=await fsp.readFile(file);
        res.setHeader('Content-Type',mime[path.extname(name).slice(1)]||'application/octet-stream');
        res.setHeader('Cache-Control',path.extname(name)==='.html'?'no-store':'public, max-age=31536000, immutable');
        res.setHeader('Content-Security-Policy',`connect-src 'self' ${origin.replace('http:','ws:')}; object-src 'none'; form-action 'none'; base-uri 'self'`);
        res.end(content);
      } catch {if(!res.headersSent)res.writeHead(403);res.end();}
    });

    const reserve=createServer();
    const runtimePort=await listen(reserve);
    await new Promise(resolve=>reserve.close(resolve));
    const hostOrigin=`http://${loopback}:${runtimePort}`;
    await fsp.mkdir(profiles,{recursive:true,mode:0o700});
    profile=await prepareCourseProfile(
      profiles,run.id,path.join(profiles,`${hostKey(context)}-v2`),false,
    );
    await reconcileCourseProfileRuntime(profile,resourceRoot);
    if(process.env.KUAIXUE_QA_RUNTIME==='1') console.error('本机 VibeCoding 配置目录',profile);
    await provisionCourseProvider({
      profile,context,
      platform:{hasRuntimeAccess:async()=>!closed,detail:()=>({...run.course,vibeModelIds:gateway.modelIds})},
      gateway:{...context,...gateway},
    });
    const browser=findBrowser();
    const agentArgs=[path.join(runtimeDir,'zcode.cjs'),'app-server','--stdio'];
    const bundledAgentNode=path.join(runtimeDir,'node','node.exe');
    const agentNode=(process.env.KUAIXUE_AGENT_NODE_EXECUTABLE||'').trim()
      ||(fs.existsSync(bundledAgentNode)?bundledAgentNode:process.execPath);
    const providerConfig=path.join(runtimeDir,'provider','zcode-builtin.json');
    const runtimeHost=path.join(runtimeDir,'tools','runtime-host','zcode-runtime-host.exe');
    const childEnv=withRuntimeTools({
      ...process.env,
      ZCODE_DATA_BASE_DIR:profile,ZCODE_DESKTOP_HOME_DIR:profile,ZCODE_HOME:path.join(profile,'.zcode'),
      ZCODE_AGENT_SERVER_COMMAND:agentNode,ZCODE_AGENT_SERVER_ARGS_JSON:JSON.stringify(agentArgs),
      KUAIXUE_BROWSER_EXECUTABLE:browser||'',
      ZCODE_BUILTIN_PROVIDER_CONFIG_FILE:providerConfig,
      ZCODE_PERSONAL_PROVIDER_CONFIG_FILE:path.join(profile,'.zcode','v2','provider_config.json'),
      ...(fs.existsSync(runtimeHost)?{ZCODE_RUNTIME_HOST_PATH:runtimeHost,ZCODE_SERVER_RUNTIME_ROOT:runtimeDir}:{}),
      ELECTRON_RUN_AS_NODE:'1',ZCODE_SERVER_AUTH_TOKEN:token,PORT:String(runtimePort),
    },resourceRoot);
    child=spawn(process.execPath,[path.join(runtimeDir,'course-runtime.mjs')],{
      cwd:workspace,env:childEnv,stdio:process.env.KUAIXUE_QA_RUNTIME==='1'?['ignore','inherit','inherit']:'ignore',windowsHide:true,
    });
    child.once('error',error=>{console.error('[course-vibe] runtime spawn failed',error);close();});
    child.once('close',(code,signal)=>{
      console.error('[course-vibe] runtime exited',{code,signal});
      close();void discardProviderCredential();
    });
    await ready(hostOrigin,token,child);
    await hideLegacyTasks(profile);
    const accept=createScopedSocketAcceptor({WebSocketServer:WebSocket.WebSocketServer,WebSocket,checkAccess,
      resolveHost:async()=>({...context,token,origin:hostOrigin.replace('http:','ws:')})});
    web.on('upgrade',async(req,socket,head)=>{
      try {
        if(req.headers.origin!==origin||!req.url.startsWith('/kuaixue/runtime/ws/'))throw Error();
        const claimed=await broker.claimSocket(req.url.slice('/kuaixue/runtime/ws/'.length));
        await accept({req,socket,head,context:claimed});
      }catch(error){console.error('[course-vibe] websocket upgrade failed',error);socket.destroy();}
    });
    const ticket=await broker.issueRuntimeTicket(context);
    function htmlTarget(directory,file){
      const root=path.resolve(directory||workspace);
      const target=path.resolve(file||path.join(root,'index.html'));
      const relative=path.relative(root,target);
      if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||!/\.html?$/i.test(target)) {
        throw Error('请选择当前工程中的 HTML 文件');
      }
      return {root,target,relative};
    }
    function readHtml(directory) {
      const {target}=htmlTarget(directory);
      const stat=fs.statSync(target);
      if(!stat.isFile()||stat.size>4_000_000) throw Error('请检查本机工程中的 index.html');
      return fs.readFileSync(target,'utf8');
    }
    function snapshot(directory) {
      const root=path.resolve(directory||workspace);
      return {runId:run.id,directory:root,html:readHtml(root)};
    }
    async function authorizeWorkspace(directory) {
      const target=path.resolve(directory);
      try {
        const db=new DatabaseSync(path.join(profile,'.zcode','v2','tasks-index.sqlite'),{readOnly:true});
        try {
          const roots=[
            ...db.prepare('SELECT root_path path FROM project_roots').all(),
            ...db.prepare('SELECT DISTINCT workspace_path path FROM tasks').all(),
          ].map(row=>path.resolve(row.path)).filter(Boolean);
          return roots.some(root=>{
            const relative=path.relative(root,target);
            return relative===''||(!relative.startsWith('..')&&!path.isAbsolute(relative));
          });
        } finally {db.close();}
      } catch {return false;}
    }
    async function preview(directory,file,knownMtime=0) {
      const {root,target,relative}=htmlTarget(directory,file);
      const stat=await fsp.stat(target);
      if(!stat.isFile()||stat.size>4_000_000) throw Error('请先生成有效的 index.html');
      if(Number.isFinite(knownMtime)&&knownMtime===stat.mtimeMs) {
        return {runId:run.id,unchanged:true,file:target,mtimeMs:stat.mtimeMs,size:stat.size};
      }
      const previewToken=await broker.issuePreview(context);
      previewRoots.set(previewToken,root);
      const encoded=relative.split(path.sep).map(encodeURIComponent).join('/');
      return {
        runId:run.id,
        file:target,
        url:`${origin}/kuaixue/runtime/preview/${previewToken}/${encoded}`,
        mtimeMs:stat.mtimeMs,
        size:stat.size,
        unchanged:false,
      };
    }
    return {
      runId:run.id,runtime:'local',lease,directory:workspace,context,authorizeWorkspace,snapshot,preview,
      frameUrl:`${origin}/kuaixue/workbench/#${new URLSearchParams({
        run:run.id,ticket,usageLimit:String(gateway.usage.limit),usageUsed:String(gateway.usage.used),
      })}`,
      close,
    };
  } catch(error){close();throw error;}
}

module.exports={courseRuntimeFingerprint,courseWorkspaceName,hideLegacyTasks,legacyTaskIds,openCourseLocalVibe,prepareCourseProfile,profileScore,reconcileCourseProfileRuntime,runtimePythonDirectories,withRuntimeTools};
