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
  getHostInfo: () => ipcRenderer.invoke('get-host-info'),
  getWslDistros: () => ipcRenderer.invoke('get-wsl-distros'),
  selectWslFolder: (distro) => ipcRenderer.invoke('select-wsl-folder', distro),

  onProjectLog: (cb) => ipcRenderer.on('project-log', (_, data) => cb(data)),
  onProjectStopped: (cb) => ipcRenderer.on('project-stopped', (_, data) => cb(data)),
  onProjectPortChanged: (cb) => ipcRenderer.on('project-port-changed', (_, data) => cb(data)),

  removeProjectLogListener: () => ipcRenderer.removeAllListeners('project-log'),
  removeProjectStoppedListener: () => ipcRenderer.removeAllListeners('project-stopped'),
  removeProjectPortChangedListener: () => ipcRenderer.removeAllListeners('project-port-changed'),

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
  },

  checkDocker: () => ipcRenderer.invoke('check-docker'),
  dockerListContainers: () => ipcRenderer.invoke('docker-list-containers'),
  dockerContainerAction: (opts) => ipcRenderer.invoke('docker-container-action', opts),
  dockerStreamLogs: (opts) => ipcRenderer.invoke('docker-stream-logs', opts),
  dockerStopLogs: (opts) => ipcRenderer.invoke('docker-stop-logs', opts),

  onDockerLog: (cb) => ipcRenderer.on('docker-log', (_, data) => cb(data)),
  onDockerLogEnd: (cb) => ipcRenderer.on('docker-log-end', (_, data) => cb(data)),
  removeDockerLogListeners: () => {
    ipcRenderer.removeAllListeners('docker-log')
    ipcRenderer.removeAllListeners('docker-log-end')
  },

  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  windowMaximize: () => ipcRenderer.invoke('window-maximize'),
  windowClose: () => ipcRenderer.invoke('window-close'),
  windowIsMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  onWindowMaximized: (cb) => ipcRenderer.on('window-maximized', (_, val) => cb(val)),
  removeWindowListeners: () => ipcRenderer.removeAllListeners('window-maximized')
})
