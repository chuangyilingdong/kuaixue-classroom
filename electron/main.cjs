const { app, BrowserWindow, dialog, ipcMain, shell, protocol, net } = require("electron");
const path = require("node:path");
const {createHash}=require('node:crypto');
const { pathToFileURL } = require("node:url");
const {localProjectStatus,projectPaths,writeSnapshotMetadata}=require('./local-project.cjs');
const classroomWindows = new Set();
const dist = path.resolve(__dirname, '../dist');
const {readFileSync} = require('node:fs');
const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [window] = BrowserWindow.getAllWindows();
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });
}
const configFile = path.join(dist,'desktop-service.json');
const config = require('node:fs').existsSync(configFile) ? JSON.parse(readFileSync(configFile,'utf8')) : {};
const classroomEntry = config.integrated ? 'kuaixue://classroom/index.html' : pathToFileURL(path.join(dist,'index.html')).href;
if (config.integrated) protocol.registerSchemesAsPrivileged([{scheme:'kuaixue', privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}}]);

let store;
function workshop() {
  if (config.integrated) throw Error('联网模式使用课程服务');
  store ??= require('./workshop.cjs').createWorkshop(path.join(app.getPath('userData'), 'workshop-demo.sqlite'));
  return store;
}
function trustedWindow(event, windows) {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!windows.has(win) || event.senderFrame !== event.sender.mainFrame ||
      event.senderFrame.url.split(/[?#]/)[0] !== classroomEntry) throw new Error('仅限本地快学窗口');
}
function register(scope, windows, handlers) {
  for (const [action, handle] of Object.entries(handlers)) {
    ipcMain.handle(`${scope}:${action}`, (event, ...args) => {
      trustedWindow(event, windows);
      return handle(...args);
    });
  }
}
register('workshop', classroomWindows, {
  catalog: () => workshop().catalog(), detail: (id, v) => workshop().detail(id, v), account: () => workshop().account(),
  purchase: (id, v) => workshop().purchase(id, v),
  works: () => workshop().works(),
  exportProject: async id => {
    const { mkdir, mkdtemp, writeFile } = require('node:fs/promises');
    const project = workshop().projectFile(id);
    const root = path.join(app.getPath('userData'), 'demo-projects', project.runId);
    await mkdir(root, { recursive:true });
    const dir = await mkdtemp(path.join(root, `revision-${project.revision}-`));
    await writeFile(path.join(dir, 'index.html'), project.html, {flag:'wx'});
    const error = await shell.openPath(dir);
    if (error) throw new Error(`工程已导出至 ${dir}`);
    return dir;
  },
});
const localHosts = new Map();
const courseLocalHosts = new Map();
function endHost(owner, lease) {
  const current = localHosts.get(owner);
  if (current && (!lease || current.host?.lease === lease)) {
    localHosts.delete(owner);
    current.host?.close();
  }
}
function requireHost(owner, lease) {
  const host = localHosts.get(owner)?.host;
  if (!lease || !host || host.lease !== lease) throw Error('工作区已关闭，请从课程重新进入');
  return host;
}
ipcMain.handle('workshop:start', async (event,id,version,mode) => {
  trustedWindow(event,classroomWindows);
  const owner = event.sender.id;
  const run = workshop().start(id,version,mode);
  endHost(owner);
  if (run.mode !== 'VIBECODING') return run;
  const current = {};
  localHosts.set(owner,current);
  try {
    const host = await require('./local-vibe.cjs').openLocalVibe({run,store:workshop(),
      resourceRoot:app.isPackaged ? process.resourcesPath : path.resolve(__dirname,'../release'),dataRoot:app.getPath('userData')});
    if (localHosts.get(owner) !== current) {host.close();throw Error('课程工作区已关闭');}
    current.host = host;
    return {...run,frameUrl:host.frameUrl,lease:host.lease,work:host.readHtml()};
  } catch (error) {if (localHosts.get(owner) === current) endHost(owner);throw error;}
});
ipcMain.handle('workshop:readVibe', (event,lease) => {
  trustedWindow(event,classroomWindows);
  return requireHost(event.sender.id,lease).readHtml();
});
ipcMain.handle('workshop:closeVibe', (event,lease) => {
  trustedWindow(event,classroomWindows);
  if (lease) endHost(event.sender.id,lease);
});
ipcMain.handle('workshop:save', (event,run) => {
  trustedWindow(event,classroomWindows);
  if (!run.lease) return workshop().save(run);
  return requireHost(event.sender.id,run.lease).save(run);
});
function endCourseLocal(owner,lease) {
  const current=courseLocalHosts.get(owner);
  if(current&&(!lease||current.host?.lease===lease)) {
    courseLocalHosts.delete(owner);
    current.host?.close();
  }
}
function requireCourseLocal(owner,lease) {
  const host=courseLocalHosts.get(owner)?.host;
  if(!host||!lease||host.lease!==lease) throw Error('本机工作区已关闭，请从课程重新进入');
  return host;
}
ipcMain.handle('vibe:startLocal',async(event,request)=>{
  trustedWindow(event,classroomWindows);
  if(!config.integrated) throw Error('演示版使用本机工程入口');
  const run=request?.run;
  if(!run||run.mode!=='VIBECODING'||!run.id||!run.course?.id||!run.course?.versionId||
      !request?.gateway||typeof request?.userId!=='string') throw Error('本机运行参数无效');
  const owner=event.sender.id;
  endCourseLocal(owner);
  const current={};
  courseLocalHosts.set(owner,current);
  try {
    const host=await require('./course-local-vibe.cjs').openCourseLocalVibe({
      run,gateway:request.gateway,userId:request.userId,
      resourceRoot:app.isPackaged?process.resourcesPath:path.resolve(__dirname,'../release'),
      dataRoot:app.getPath('userData'),
    });
    if(courseLocalHosts.get(owner)!==current){host.close();throw Error('本机工作区已关闭');}
    current.host=host;
    return {runtime:'local',frameUrl:host.frameUrl,lease:host.lease,directory:host.directory};
  } catch(error) {
    if(courseLocalHosts.get(owner)===current) endCourseLocal(owner);
    throw error;
  }
});
ipcMain.handle('vibe:saveLocal',(event,request)=>{
  trustedWindow(event,classroomWindows);
  const host=requireCourseLocal(event.sender.id,request?.lease);
  if(request?.runId!==host.runId) throw Error('本机工作区与课程不符');
  return host.snapshot();
});
ipcMain.handle('vibe:packLocal',async(event,request)=>{
  trustedWindow(event,classroomWindows);
  const host=requireCourseLocal(event.sender.id,request?.lease);
  if(request?.runId!==host.runId)throw Error('本机工作区与课程不符');
  const {createSnapshotZip}=await import('../shared/local-snapshot.mjs');
  const snapshot=await createSnapshotZip(host.directory);
  const status=await localProjectStatus(app.getPath('userData'),host.context);
  return {...snapshot,bytes:new Uint8Array(snapshot.bytes),baseRevision:status.revision};
});
ipcMain.handle('vibe:recordLocalSnapshot',async(event,request)=>{
  trustedWindow(event,classroomWindows);
  const host=requireCourseLocal(event.sender.id,request?.lease);
  if(request?.runId!==host.runId)throw Error('本机工作区与课程不符');
  if(!Number.isSafeInteger(request?.revision)||request.revision<1||
      typeof request?.sha256!=='string'||!/^[a-f0-9]{64}$/.test(request.sha256)||
      typeof request?.capturedAt!=='string'||Number.isNaN(Date.parse(request.capturedAt)))throw Error('云端快照回执无效');
  const paths=projectPaths(app.getPath('userData'),host.context);
  await writeSnapshotMetadata(paths,{revision:request.revision,sha256:request.sha256,capturedAt:request.capturedAt});
  return {revision:request.revision,sha256:request.sha256,capturedAt:request.capturedAt};
});
ipcMain.handle('vibe:closeLocal',(event,lease)=>{
  trustedWindow(event,classroomWindows);
  if(lease) endCourseLocal(event.sender.id,lease);
});
ipcMain.handle('vibe:localStatus',async(event,request)=>{
  trustedWindow(event,classroomWindows);
  if(!request?.userId||!request?.courseId||!request?.versionId) throw Error('本机工程参数无效');
  const context={userId:String(request.userId),courseId:String(request.courseId),versionId:String(request.versionId)};
  return localProjectStatus(app.getPath('userData'),context);
});
ipcMain.handle('vibe:restoreLocal',async(event,request)=>{
  trustedWindow(event,classroomWindows);
  const context={
    userId:String(request?.userId||''),courseId:String(request?.courseId||''),versionId:String(request?.versionId||''),
  };
  if(!context.userId||!context.courseId||!context.versionId)throw Error('本机工程参数无效');
  const paths=projectPaths(app.getPath('userData'),context);
  for(const current of courseLocalHosts.values()){
    if(current.host?.directory===paths.workspace)throw Error('请先关闭本机工作区再恢复云端工程');
  }
  const bytes=Buffer.from(request?.bytes||[]);
  if(!bytes.length)throw Error('云端工程快照为空');
  const digest=createHash('sha256').update(bytes).digest('hex');
  if(digest!==request?.sha256)throw Error('云端工程快照摘要不一致');
  if(!Number.isSafeInteger(request?.revision)||request.revision<1||
      typeof request?.capturedAt!=='string'||Number.isNaN(Date.parse(request.capturedAt)))throw Error('云端工程快照回执无效');
  const {replaceWorkspaceFromSnapshot}=await import('../shared/local-snapshot.mjs');
  const restored=await replaceWorkspaceFromSnapshot(bytes,paths.workspace,{backupRoot:paths.backups});
  await writeSnapshotMetadata(paths,{revision:request.revision,sha256:request.sha256,capturedAt:request.capturedAt});
  return {exists:true,directory:paths.workspace,revision:request.revision,sha256:request.sha256,
    capturedAt:request.capturedAt,backup:restored.backup};
});
ipcMain.handle('vibe:openLocalFolder',async(event,request)=>{
  trustedWindow(event,classroomWindows);
  if(!request?.directory||!path.isAbsolute(request.directory)) throw Error('本机工程目录无效');
  const error=await shell.openPath(request.directory);
  if(error) throw Error(error);
  return true;
});
ipcMain.handle('vibe:selectPaths',async(event,request)=>{
  trustedWindow(event,classroomWindows);
  const kind=request?.kind;
  if(!['directory','file'].includes(kind)) throw Error('文件选择类型无效');
  const multiple=request?.multiple===true;
  const properties=kind==='directory'
    ? ['openDirectory','createDirectory']
    : [...(multiple?['multiSelections']:[]),'openFile'];
  const choice=await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender),{
    title:kind==='directory'?'选择工作区文件夹':'选择文件',
    properties,
  });
  return choice.canceled?{cancelled:true,paths:[]}:{cancelled:false,paths:choice.filePaths};
});
ipcMain.handle('media:download',async(event,request)=>{
  trustedWindow(event,classroomWindows);
  const win=BrowserWindow.fromWebContents(event.sender);
  let target;
  try {target=new URL(String(request?.url||''),config.apiOrigin);} catch {throw Error('下载地址无效');}
  if(target.protocol!=='https:'||target.username||target.password)throw Error('仅支持下载 HTTPS 素材');
  const fallback=request?.kind==='video'?'.mp4':request?.kind==='audio'?'.mp3':'.png';
  const fromUrl=path.extname(target.pathname).toLowerCase();
  const base=String(request?.name||'课程素材').replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').trim().slice(0,120)||'课程素材';
  const filename=/\.[a-z0-9]{2,6}$/i.test(base)?base:base+(/^\.[a-z0-9]{2,6}$/.test(fromUrl)?fromUrl:fallback);
  const choice=await dialog.showSaveDialog(win,{defaultPath:path.join(app.getPath('downloads'),filename)});
  if(choice.canceled||!choice.filePath)return {cancelled:true};
  const response=await win.webContents.session.fetch(target.href,{credentials:'include',redirect:'follow'});
  if(!response.ok||!response.body)throw Error(`素材下载失败（${response.status}）`);
  const {Readable}=require('node:stream');
  const {pipeline}=require('node:stream/promises');
  await pipeline(Readable.fromWeb(response.body),require('node:fs').createWriteStream(choice.filePath));
  return {cancelled:false,filePath:choice.filePath};
});
ipcMain.handle('account:login',async event => {
  trustedWindow(event,classroomWindows);
  if (!config.integrated) throw Error('此版本使用演示学员');
  return require('./desktop-login.cjs').desktopLogin(BrowserWindow.fromWebContents(event.sender),config);
});
ipcMain.handle('account:cancel-login',event => {
  trustedWindow(event,classroomWindows);
  require('./desktop-login.cjs').cancelLogin(BrowserWindow.fromWebContents(event.sender));
});
app.setName("快学课堂");
if (!app.commandLine.hasSwitch("user-data-dir")) {
  app.setPath("userData", path.join(app.getPath("appData"), "KuaixueClassroom"));
}
const integrated = process.platform === "win32";
function overlay(theme) {
  return { color: "#00000000", symbolColor: theme === "light" ? "#777b85" : "#d3d5dd", height: 32 };
}
ipcMain.on("window:theme", (event, theme) => {
  if (!integrated || !["light", "dark"].includes(theme) || event.senderFrame !== event.sender.mainFrame) return;
  BrowserWindow.fromWebContents(event.sender)?.setTitleBarOverlay(overlay(theme));
});
function createWindow() {
  const window = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1040, minHeight: 680,
    backgroundColor: "#0b0c0d", title: "快学课堂", autoHideMenuBar: true,
    ...(integrated ? { titleBarStyle: "hidden", titleBarOverlay: overlay("dark") } : {}),
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const windows = classroomWindows;
  windows.add(window);
  const owner = window.webContents.id;
  window.on("closed", () => {endHost(owner);endCourseLocal(owner);windows.delete(window);});
  window.webContents.on("render-process-gone", () => {endHost(owner);endCourseLocal(owner);});
  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  const devUrl = process.env.KUAIXUE_DEV_URL;
  if (devUrl) void window.loadURL(devUrl);
  else {
    const accountRequested = process.argv.includes("--open-account");
    void window.loadURL(classroomEntry + (accountRequested ? "#account" : ""))
      .catch(error => console.error("Unable to open classroom window:", error.message));
  }
}
if (singleInstance) app.whenReady().then(() => {
  if (config.integrated) protocol.handle('kuaixue', request => {
    const url = new URL(request.url);
    if (url.host !== 'classroom' || request.method !== 'GET') return new Response(null,{status:404});
    const file = path.resolve(dist,'.' + decodeURIComponent(url.pathname));
    const relative = path.relative(dist,file);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return new Response(null,{status:404});
    return net.fetch(pathToFileURL(file).href);
  });
  createWindow();
  app.on("activate", () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
