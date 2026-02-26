const fs = require('fs')
const { execSync } = require('child_process')

let mainWindow = null

const isRunningInsideWsl = (() => {
  try {
    if (process.platform !== 'linux') return false
    const version = fs.readFileSync('/proc/version', 'utf-8')
    return /microsoft|wsl/i.test(version)
  } catch { return false }
})()

let wslHostIp = null
if (isRunningInsideWsl) {
  try {
    wslHostIp = execSync('hostname -I', { encoding: 'utf-8', timeout: 2000 }).trim().split(' ')[0] || null
    console.log('[DevScanner] Running inside WSL, host IP:', wslHostIp)
  } catch { /* ok */ }
}

function getMainWindow() {
  return mainWindow
}

function setMainWindow(win) {
  mainWindow = win
}

module.exports = {
  getMainWindow,
  setMainWindow,
  isRunningInsideWsl,
  wslHostIp
}
