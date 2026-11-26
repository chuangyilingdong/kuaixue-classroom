const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("kuaixueDesktop", Object.freeze({
  workshop: Object.fromEntries(['catalog','detail','account','purchase','start','save','works','workPreview','exportProject','readVibe','closeVibe'].map(name => [name, (...args) => ipcRenderer.invoke(`workshop:${name}`, ...args)])),
  vibe: Object.fromEntries(['startLocal','saveLocal','saveWorkPreview','readSavedWork','previewLocal','packLocal','recordLocalSnapshot','restoreLocal','closeLocal','localStatus','openLocalFolder','selectPaths'].map(name => [name, (...args) => ipcRenderer.invoke(`vibe:${name}`, ...args)])),
  browser: Object.freeze({
    attachGuest: payload => ipcRenderer.invoke('browser:attach-guest', payload),
    detachGuest: payload => ipcRenderer.invoke('browser:detach-guest', payload),
    closeTab: payload => ipcRenderer.invoke('browser:close-tab', payload),
    reportResidency: payload => ipcRenderer.invoke('browser:report-residency', payload),
    suspendReady: payload => ipcRenderer.invoke('browser:suspend-ready', payload),
    ensureResident: payload => ipcRenderer.invoke('browser:ensure-resident', payload),
    restoreTabs: payload => ipcRenderer.invoke('browser:restore-tabs', payload),
    updateViewport: payload => ipcRenderer.invoke('browser:update-viewport', payload),
    clearData: mode => ipcRenderer.invoke('browser:clear-data', mode),
    onAgentTab: handler => {
      const listener=(_event,payload)=>handler(payload);
      ipcRenderer.on('browser:agent-tab',listener);
      return ()=>ipcRenderer.removeListener('browser:agent-tab',listener);
    },
    onOpenUrl: handler => {
      if (typeof handler !== 'function') return () => {};
      const listener = (_event, payload) => handler(payload);
      ipcRenderer.on('browser:open-url', listener);
      return () => ipcRenderer.removeListener('browser:open-url', listener);
    },
  }),
  platform: process.platform,
  catalogCategories: () => ipcRenderer.invoke('catalog:categories'),
  downloadMedia: request => ipcRenderer.invoke('media:download', request),
  login: () => ipcRenderer.invoke("account:login"),
  cancelLogin: () => ipcRenderer.invoke('account:cancel-login'),
  setTheme: (theme) => { if (theme === "dark" || theme === "light") ipcRenderer.send("window:theme", theme); },
  version: "0.1.1",
}));

