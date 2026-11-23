const { BrowserWindow, session } = require('electron');

const origin = 'https://aicyld.com.cn';
const loginUrl = `${origin}/login?redirect=%2Fpoints`;
let accountWindow;
let officialSession;
let openedWallet = false;

function trustedNavigation(address) {
  try { return new URL(address).origin === origin; } catch { return false; }
}

async function openOfficialAccount(parent) {
  if (accountWindow && !accountWindow.isDestroyed()) {
    if (accountWindow.isMinimized()) accountWindow.restore();
    accountWindow.focus();
    return;
  }
  if (!officialSession) {
    officialSession = session.fromPartition('kuaixue-official-account');
    officialSession.setPermissionRequestHandler((_contents, _permission, respond) => respond(false));
    officialSession.setPermissionCheckHandler(() => false);
    officialSession.on('will-download', event => event.preventDefault());
    officialSession.webRequest.onCompleted({ urls: [`${origin}/api/points/wallet*`] }, details => {
      if (details.webContentsId === accountWindow?.webContents.id && details.method === 'GET') {
        openedWallet = details.statusCode === 200;
      }
    });
  }
  const win = new BrowserWindow({ parent, width: 1080, height: 800,
    title: '创易灵动账号 · aicyld.com.cn', autoHideMenuBar: true,
    webPreferences: { session: officialSession, sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false },
  });
  accountWindow = win;
  win.on('closed', () => { accountWindow = undefined; });
  win.on('page-title-updated', event => event.preventDefault());
  const contents = win.webContents;
  for (const eventName of ['will-navigate', 'will-redirect']) {
    contents.on(eventName, (event, url) => { if (!trustedNavigation(url)) event.preventDefault(); });
  }
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  try {
    await win.loadURL(openedWallet ? `${origin}/points` : loginUrl);
  } catch (error) {
    if (!win.isDestroyed()) win.close();
    throw error;
  }
}
module.exports = { openOfficialAccount };
