const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("kuaixueDesktop", Object.freeze({
  workshop: Object.fromEntries(['catalog','detail','account','purchase','start','save','works','exportProject','readVibe','closeVibe'].map(name => [name, (...args) => ipcRenderer.invoke(`workshop:${name}`, ...args)])),
  vibe: Object.fromEntries(['startLocal','saveLocal','packLocal','recordLocalSnapshot','restoreLocal','closeLocal','localStatus','openLocalFolder'].map(name => [name, (...args) => ipcRenderer.invoke(`vibe:${name}`, ...args)])),
  platform: process.platform,
  login: () => ipcRenderer.invoke("account:login"),
  cancelLogin: () => ipcRenderer.invoke('account:cancel-login'),
  setTheme: (theme) => { if (theme === "dark" || theme === "light") ipcRenderer.send("window:theme", theme); },
  version: "0.1.0",
}));

