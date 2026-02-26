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
  checkWslLocalhost: () => ipcRenderer.invoke('check-wsl-localhost'),
  fixWslLocalhost: () => ipcRenderer.invoke('fix-wsl-localhost'),
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

  checkDocker: (opts) => ipcRenderer.invoke('check-docker', opts),
  dockerListContainers: (opts) => ipcRenderer.invoke('docker-list-containers', opts),
  dockerContainerAction: (opts) => ipcRenderer.invoke('docker-container-action', opts),
  dockerStreamLogs: (opts) => ipcRenderer.invoke('docker-stream-logs', opts),
  dockerStopLogs: (opts) => ipcRenderer.invoke('docker-stop-logs', opts),
  gitInfo: (opts) => ipcRenderer.invoke('git-info', opts),
  gitFetch: (opts) => ipcRenderer.invoke('git-fetch', opts),
  gitPull: (opts) => ipcRenderer.invoke('git-pull', opts),
  getNpmScripts: (opts) => ipcRenderer.invoke('get-npm-scripts', opts),
  runNpmScript: (opts) => ipcRenderer.invoke('run-npm-script', opts),
  readEnvFile: (opts) => ipcRenderer.invoke('read-env-file', opts),
  saveEnvFile: (opts) => ipcRenderer.invoke('save-env-file', opts),
  listEnvFiles: (opts) => ipcRenderer.invoke('list-env-files', opts),

  dockerServicesCatalog: () => ipcRenderer.invoke('docker-services-catalog'),
  dockerServicesConfig: (opts) => ipcRenderer.invoke('docker-services-config', opts),
  dockerServicesSave: (opts) => ipcRenderer.invoke('docker-services-save', opts),
  dockerServicesStart: (opts) => ipcRenderer.invoke('docker-services-start', opts),
  dockerServicesStop: (opts) => ipcRenderer.invoke('docker-services-stop', opts),
  dockerServicesStatus: (opts) => ipcRenderer.invoke('docker-services-status', opts),
  dockerServicesInjectEnv: (opts) => ipcRenderer.invoke('docker-services-inject-env', opts),
  onDockerServicesHealth: (cb) => ipcRenderer.on('docker-services-health', (_, data) => cb(data)),
  removeDockerServicesHealthListener: () => ipcRenderer.removeAllListeners('docker-services-health'),

  onDockerLog: (cb) => ipcRenderer.on('docker-log', (_, data) => cb(data)),
  onDockerLogEnd: (cb) => ipcRenderer.on('docker-log-end', (_, data) => cb(data)),
  removeDockerLogListeners: () => {
    ipcRenderer.removeAllListeners('docker-log')
    ipcRenderer.removeAllListeners('docker-log-end')
  },

  sshConnect: (opts) => ipcRenderer.invoke('ssh-connect', opts),
  sshDisconnect: (opts) => ipcRenderer.invoke('ssh-disconnect', opts),
  sshDiscover: (opts) => ipcRenderer.invoke('ssh-discover', opts),
  sshExec: (opts) => ipcRenderer.invoke('ssh-exec', opts),
  sshSaveServer: (opts) => ipcRenderer.invoke('ssh-save-server', opts),
  sshDeleteServer: (opts) => ipcRenderer.invoke('ssh-delete-server', opts),
  sshGetServers: () => ipcRenderer.invoke('ssh-get-servers'),

  // Remote project launch (Phase 3)
  sshAnalyzeProject: (opts) => ipcRenderer.invoke('ssh-analyze-project', opts),
  sshLaunchProject: (opts) => ipcRenderer.invoke('ssh-launch-project', opts),
  sshStopProject: (opts) => ipcRenderer.invoke('ssh-stop-project', opts),
  sshGetRemoteRunning: (opts) => ipcRenderer.invoke('ssh-get-remote-running', opts),
  onRemoteProjectLog: (cb) => ipcRenderer.on('remote-project-log', (_, data) => cb(data)),
  onRemoteProjectStopped: (cb) => ipcRenderer.on('remote-project-stopped', (_, data) => cb(data)),
  removeRemoteProjectLogListener: () => ipcRenderer.removeAllListeners('remote-project-log'),
  removeRemoteProjectStoppedListener: () => ipcRenderer.removeAllListeners('remote-project-stopped'),

  // Nginx manager (Phase 4)
  sshNginxList: (opts) => ipcRenderer.invoke('ssh-nginx-list', opts),
  sshNginxRead: (opts) => ipcRenderer.invoke('ssh-nginx-read', opts),
  sshNginxSave: (opts) => ipcRenderer.invoke('ssh-nginx-save', opts),
  sshNginxEnable: (opts) => ipcRenderer.invoke('ssh-nginx-enable', opts),
  sshNginxDisable: (opts) => ipcRenderer.invoke('ssh-nginx-disable', opts),
  sshNginxDelete: (opts) => ipcRenderer.invoke('ssh-nginx-delete', opts),
  sshNginxTest: (opts) => ipcRenderer.invoke('ssh-nginx-test', opts),
  sshNginxReload: (opts) => ipcRenderer.invoke('ssh-nginx-reload', opts),
  sshNginxInstall: (opts) => ipcRenderer.invoke('ssh-nginx-install', opts),
  sshCertbotInstall: (opts) => ipcRenderer.invoke('ssh-certbot-install', opts),
  sshCertbotRun: (opts) => ipcRenderer.invoke('ssh-certbot-run', opts),

  // Service management (Phase 6)
  sshPm2Action: (opts) => ipcRenderer.invoke('ssh-pm2-action', opts),
  sshPm2Logs: (opts) => ipcRenderer.invoke('ssh-pm2-logs', opts),
  sshDockerAction: (opts) => ipcRenderer.invoke('ssh-docker-action', opts),
  sshDockerLogs: (opts) => ipcRenderer.invoke('ssh-docker-logs', opts),
  sshSystemdAction: (opts) => ipcRenderer.invoke('ssh-systemd-action', opts),
  sshSystemdLogs: (opts) => ipcRenderer.invoke('ssh-systemd-logs', opts),

  // Quick deploy (Phase 5)
  selectDeployFolder: () => ipcRenderer.invoke('select-deploy-folder'),
  sshUploadFolder: (opts) => ipcRenderer.invoke('ssh-upload-folder', opts),
  sshQuickDeploy: (opts) => ipcRenderer.invoke('ssh-quick-deploy', opts),
  sshFullDeploy: (opts) => ipcRenderer.invoke('ssh-full-deploy', opts),
  sshRemoveProject: (opts) => ipcRenderer.invoke('ssh-remove-project', opts),
  sshUndeploy: (opts) => ipcRenderer.invoke('ssh-undeploy', opts),
  onUploadProgress: (cb) => ipcRenderer.on('upload-progress', (_, data) => cb(data)),
  removeUploadProgressListener: () => ipcRenderer.removeAllListeners('upload-progress'),
  onDeployLog: (cb) => ipcRenderer.on('deploy-log', (_, data) => cb(data)),
  removeDeployLogListener: () => ipcRenderer.removeAllListeners('deploy-log'),

  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  windowMaximize: () => ipcRenderer.invoke('window-maximize'),
  windowClose: () => ipcRenderer.invoke('window-close'),
  windowIsMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  onWindowMaximized: (cb) => ipcRenderer.on('window-maximized', (_, val) => cb(val)),
  removeWindowListeners: () => ipcRenderer.removeAllListeners('window-maximized')
})
