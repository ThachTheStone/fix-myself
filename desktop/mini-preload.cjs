const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fixMyselfMini', {
  onView: (callback) => ipcRenderer.on('mini:view', (_event, view) => callback(view))
});
