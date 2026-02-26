const fs = require('fs')
const path = require('path')
const { execInContext, isWslPath, spawnInContext } = require('../utils/context')
const {
  runningProcesses,
  getProcessEntry,
  setProcessEntry,
  attachProcessListeners,
  updateBadgeCount
} = require('../utils/process')

function registerVcsHandlers(ipcMain, ctx) {
  ipcMain.handle('git-info', async (event, { projectPath }) => {
    try {
      const gitDir = path.join(projectPath, '.git')
      if (!fs.existsSync(gitDir)) return null
      let branch = 'unknown', changed = 0, ahead = 0, behind = 0
      try {
        branch = execInContext('git rev-parse --abbrev-ref HEAD', {
          cwd: projectPath, encoding: 'utf-8', timeout: 3000, stdio: 'pipe'
        }).trim()
      } catch { /* ok */ }
      try {
        const status = execInContext('git status --porcelain', {
          cwd: projectPath, encoding: 'utf-8', timeout: 3000, stdio: 'pipe'
        })
        changed = status.trim().split('\n').filter(Boolean).length
      } catch { /* ok */ }
      try {
        const upstream = execInContext('git rev-parse --abbrev-ref @{u}', {
          cwd: projectPath, encoding: 'utf-8', timeout: 3000, stdio: 'pipe'
        }).trim()
        if (upstream) {
          const counts = execInContext(`git rev-list --left-right --count HEAD...${upstream}`, {
            cwd: projectPath, encoding: 'utf-8', timeout: 3000, stdio: 'pipe'
          }).trim()
          const [a, b] = counts.split('\t').map(Number)
          ahead = a || 0; behind = b || 0
        }
      } catch { /* no upstream */ }
      return { branch, changed, ahead, behind }
    } catch { return null }
  })

  ipcMain.handle('git-fetch', async (event, { projectPath }) => {
    try {
      execInContext('git fetch', { cwd: projectPath, encoding: 'utf-8', timeout: 20000, stdio: 'pipe' })
      return { success: true }
    } catch (err) { return { success: false, error: err.message } }
  })

  ipcMain.handle('git-pull', async (event, { projectPath }) => {
    try {
      const out = execInContext('git pull', { cwd: projectPath, encoding: 'utf-8', timeout: 30000, stdio: 'pipe' })
      return { success: true, output: out }
    } catch (err) { return { success: false, error: err.message } }
  })

  ipcMain.handle('get-npm-scripts', async (event, { projectPath }) => {
    try {
      const pkgPath = path.join(projectPath, 'package.json')
      if (!fs.existsSync(pkgPath)) return { success: false, error: 'No package.json' }
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
      const scripts = pkg.scripts || {}
      return { success: true, data: Object.entries(scripts).map(([name, cmd]) => ({ name, cmd })) }
    } catch (err) { return { success: false, error: err.message } }
  })

  ipcMain.handle('run-npm-script', async (event, { projectPath, scriptName, instanceId, port }) => {
    try {
      if (getProcessEntry(projectPath, instanceId)) {
        return { success: false, error: `Instance "${instanceId}" is already running` }
      }
      const useWsl = isWslPath(projectPath)
      const npmCmd = process.platform === 'win32' && !useWsl ? 'npm.cmd' : 'npm'
      const portNum = port ? parseInt(port, 10) : null
      const args = ['run', scriptName]
      const proc = spawnInContext(npmCmd, args, {
        cwd: projectPath,
        env: { ...process.env, ...(portNum ? { PORT: String(portNum) } : {}) },
        shell: process.platform === 'win32' && !useWsl
      })
      attachProcessListeners(proc, projectPath, instanceId)
      setProcessEntry(projectPath, instanceId, {
        process: proc, port: portNum, method: 'npm', pid: proc.pid,
        cwd: projectPath, startedAt: Date.now()
      })
      updateBadgeCount()
      return { success: true, data: { pid: proc.pid, port: portNum } }
    } catch (err) { return { success: false, error: err.message } }
  })
}

module.exports = { registerVcsHandlers }
