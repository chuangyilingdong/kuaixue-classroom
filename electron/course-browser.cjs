const {session}=require('electron');
const {
  COURSE_BROWSER_PARTITION,
  isSafeCourseBrowserUrl,
  normalizeCourseBrowserPopup,
} = require('./course-browser-policy.cjs');

const {courseIabFor}=require('./course-iab.cjs');
const guests = new Map();

function installGuestPolicy(host, guest) {
  const session = guest.session;
  session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);

  const blockUnsafeNavigation = (event, url) => {
    if (!isSafeCourseBrowserUrl(url)) event.preventDefault();
  };
  guest.on('will-navigate', blockUnsafeNavigation);
  guest.on('will-redirect', blockUnsafeNavigation);
  guest.setWindowOpenHandler(details => {
    const request = normalizeCourseBrowserPopup(details);
    if (request && !host.isDestroyed()) host.send('browser:open-url', request);
    return {action:'deny'};
  });
}

function installCourseBrowserWindow(window) {
  const host = window.webContents;
  host.on('will-attach-webview', (event, webPreferences, params) => {
    const agentPartition=params.src==='about:blank' && courseIabFor(host)?.pending(params.partition);
    if ((!agentPartition && params.partition !== COURSE_BROWSER_PARTITION) || !isSafeCourseBrowserUrl(params.src)) {
      event.preventDefault();
      return;
    }
    // Browser 页面是任意第三方内容，不能获得课程壳层的 preload、Node 或同源能力。
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.nodeIntegrationInSubFrames = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.webSecurity = true;
    webPreferences.allowRunningInsecureContent = false;
    delete params.preload;
    delete params.nodeintegration;
    delete params.disablewebsecurity;
  });
  host.on('did-attach-webview', (_event, guest) => {
    guests.set(guest.id, {guest, host});
    installGuestPolicy(host, guest);
    // The main-process event is authoritative and cannot be missed if the
    // renderer's React effect subscribes after Electron attached the guest.
    const bridge=courseIabFor(host);
    for(const key of bridge?.pendingKeys?.() || []) {
      if(guest.session!==session.fromPartition(key))continue;
      bridge.attach(key,guest);
      break;
    }
    guest.once('destroyed', () => guests.delete(guest.id));
  });
  host.once('destroyed', () => {
    for (const [id, record] of guests) {
      if (record.host === host) guests.delete(id);
    }
  });
}

function registerCourseBrowserIpc({ipcMain, trustedWindow}) {
  ipcMain.handle('browser:attach-guest', (event, payload) => {
    trustedWindow(event);
    const record = guests.get(payload?.webContentsId);
    if (!record || record.host !== event.sender || typeof payload?.key !== 'string' || !payload.key) {
      return {ok:false, reason:'not-found', recoveryRequested:false};
    }
    if(payload.key.startsWith('kx-iab-')) {
      const bridge=courseIabFor(event.sender);
      if(!bridge?.pending(payload.key) || record.guest.session!==session.fromPartition(payload.key) || !bridge.attach(payload.key,record.guest)) return {ok:false};
    }
    return {ok:true, recoveryRequested:false};
  });
  ipcMain.handle('browser:detach-guest', (event, payload) => {
    trustedWindow(event);
    const record = guests.get(payload?.webContentsId);
    if (!record || record.host !== event.sender) return false;
    return true;
  });
  ipcMain.handle('browser:close-tab', (event) => {
    trustedWindow(event);
  });
  ipcMain.handle('browser:report-residency', (event) => {
    trustedWindow(event);
  });
  ipcMain.handle('browser:suspend-ready', (event) => {
    trustedWindow(event);
  });
  ipcMain.handle('browser:ensure-resident', (event) => {
    trustedWindow(event);
  });
  ipcMain.handle('browser:restore-tabs', (event) => {
    trustedWindow(event);
    return [];
  });
  ipcMain.handle('browser:update-viewport', (event) => {
    trustedWindow(event);
  });
  ipcMain.handle('browser:clear-data', async (event, mode) => {
    trustedWindow(event);
    if (!['cache','all'].includes(mode)) throw Error('浏览器数据清理模式无效');
    const browserSession = session.fromPartition(COURSE_BROWSER_PARTITION);
    if (mode === 'cache') await browserSession.clearCache();
    else await browserSession.clearStorageData();
    return {success:true};
  });
}

module.exports = {installCourseBrowserWindow, registerCourseBrowserIpc};
