const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fixMyselfDesktop', {
  platform: process.platform,
  loginLaunch: process.argv.includes('--login-launch'),
  status: () => ipcRenderer.invoke('desktop:status'),
  setStartup: (enabled) => ipcRenderer.invoke('desktop:set-startup', enabled),
  publishFocus: (focus) => ipcRenderer.invoke('desktop:focus', focus)
});
