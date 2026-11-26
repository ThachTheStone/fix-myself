const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fixMyselfDesktop', {
  platform: process.platform,
  loginLaunch: process.argv.includes('--login-launch'),
  status: () => ipcRenderer.invoke('desktop:status'),
  setStartup: (enabled) => ipcRenderer.invoke('desktop:set-startup', enabled),
  publishPlan: (snapshot) => ipcRenderer.invoke('desktop:plan', snapshot),
  chromeReports: () => ipcRenderer.invoke('desktop:chrome-reports'),
  setBackground: (enabled) => ipcRenderer.invoke('desktop:set-background', enabled),
  listApps: () => ipcRenderer.invoke('desktop:list-apps'),
  setAppLimit: (limit) => ipcRenderer.invoke('desktop:app-limit', limit),
  takeAppPass: (path, reason) => ipcRenderer.invoke('desktop:app-pass', path, reason),
  appCoverage: () => ipcRenderer.invoke('desktop:app-coverage'),
  onAppIntervention: (callback) => ipcRenderer.on('desktop:app-intervention', (_event, view) => callback(view)),
  onAppEvent: (callback) => ipcRenderer.on('desktop:app-event', (_event, record) => callback(record)),
  onAppCoverage: (callback) => ipcRenderer.on('desktop:app-coverage', (_event, coverage) => callback(coverage)),
  setMiniTimer: (view) => ipcRenderer.invoke('desktop:mini-timer', view),
  onMiniTimerToggle: (callback) => ipcRenderer.on('desktop:mini-toggle', () => callback()),
  onMiniTimerClosed: (callback) => ipcRenderer.on('desktop:mini-closed', () => callback()),
  show: () => ipcRenderer.invoke('desktop:show')
});
