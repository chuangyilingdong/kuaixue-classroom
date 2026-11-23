const { app, BrowserWindow, ipcMain, shell, protocol, net } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { openOfficialAccount } = require("./official-account.cjs");
const classroomWindows = new Set();
const dist = path.resolve(__dirname, '../dist');
const {readFileSync} = require('node:fs');
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
ipcMain.handle('account:login',async event => {
  trustedWindow(event,classroomWindows);
  if (!config.integrated) throw Error('此版本使用演示学员');
  return require('./desktop-login.cjs').desktopLogin(BrowserWindow.fromWebContents(event.sender),config);
});
ipcMain.handle("account:open-official", async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!classroomWindows.has(win) || event.senderFrame !== event.sender.mainFrame ||
      event.senderFrame.url.split(/[?#]/)[0] !== classroomEntry) throw new Error("Unavailable outside the classroom");
  await openOfficialAccount(win);
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
    backgroundColor: "#171822", title: "快学课堂", autoHideMenuBar: true,
    ...(integrated ? { titleBarStyle: "hidden", titleBarOverlay: overlay("dark") } : {}),
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const windows = classroomWindows;
  windows.add(window);
  const owner = window.webContents.id;
  window.on("closed", () => {endHost(owner);windows.delete(window);});
  window.webContents.on("render-process-gone", () => endHost(owner));
  window.setMenuBarVisibility(false);
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  const devUrl = process.env.KUAIXUE_DEV_URL;
  if (devUrl) void window.loadURL(devUrl);
  else {
    const accountRequested = process.argv.includes("--open-account");
    void window.loadURL(classroomEntry + (accountRequested ? "#account" : ""))
      .then(() => accountRequested && openOfficialAccount(window))
      .catch(error => console.error("Unable to open classroom window:", error.message));
  }
}
app.whenReady().then(() => {
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
