const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('widget', {
  init: () => ipcRenderer.invoke('init'),
  onEvents: (cb) => ipcRenderer.on('events', (_e, payload) => cb(payload)),
  refresh: () => ipcRenderer.send('refresh'),
  setTheme: (t) => ipcRenderer.send('set-theme', t),
  togglePin: () => ipcRenderer.send('toggle-pin'),
  hide: () => ipcRenderer.send('hide'),
  openGuide: () => ipcRenderer.send('open-guide'),
  openExternal: (url) => ipcRenderer.send('open-external', url),
  log: (level, msg) => ipcRenderer.send('log', level, msg),
});
