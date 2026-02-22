const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electron', {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  scanFolder: (path) => ipcRenderer.invoke('scan-folder', path),
  launchProject: (opts) => ipcRenderer.invoke('launch-project', opts),
  stopProject: (opts) => ipcRenderer.invoke('stop-project', opts),
  getRunning: () => ipcRenderer.invoke('get-running'),
  openBrowser: (url) => ipcRenderer.invoke('open-browser', url),

  scanPorts: (opts) => ipcRenderer.invoke('scan-ports', opts),
  killPortProcess: (opts) => ipcRenderer.invoke('kill-port-process', opts),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  getWslDistros: () => ipcRenderer.invoke('get-wsl-distros'),

  onProjectLog: (cb) => ipcRenderer.on('project-log', (_, data) => cb(data)),
  onProjectStopped: (cb) => ipcRenderer.on('project-stopped', (_, data) => cb(data)),

  removeProjectLogListener: () => ipcRenderer.removeAllListeners('project-log'),
  removeProjectStoppedListener: () => ipcRenderer.removeAllListeners('project-stopped'),

  onUpdateAvailable: (cb) => ipcRenderer.on('update-available', (_, info) => cb(info)),
  onUpdateDownloadProgress: (cb) => ipcRenderer.on('update-download-progress', (_, progress) => cb(progress)),
  onUpdateDownloaded: (cb) => ipcRenderer.on('update-downloaded', (_, info) => cb(info)),
  downloadUpdate: () => ipcRenderer.invoke('update-download'),
  installUpdate: () => ipcRenderer.invoke('update-install'),
  checkForUpdate: () => ipcRenderer.invoke('update-check'),
  removeUpdateListeners: () => {
    ipcRenderer.removeAllListeners('update-available')
    ipcRenderer.removeAllListeners('update-download-progress')
    ipcRenderer.removeAllListeners('update-downloaded')
  }
})
