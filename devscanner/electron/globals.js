const fs = require('fs')
const { exec } = require('child_process')

let mainWindow = null

const isRunningInsideWsl = (() => {
  try {
    if (process.platform !== 'linux') return false
    const version = fs.readFileSync('/proc/version', 'utf-8')
    return /microsoft|wsl/i.test(version)
  } catch { return false }
})()

let wslHostIp = null
const wslHostIpReady = isRunningInsideWsl
  ? new Promise(resolve => {
    exec('hostname -I', { encoding: 'utf-8', timeout: 2000 }, (err, stdout) => {
      if (!err && stdout) {
        wslHostIp = stdout.trim().split(' ')[0] || null
        console.log('[DevScanner] Running inside WSL, host IP:', wslHostIp)
      }
      resolve(wslHostIp)
    })
  })
  : Promise.resolve(null)

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
  get wslHostIp() { return wslHostIp },
  wslHostIpReady
}
