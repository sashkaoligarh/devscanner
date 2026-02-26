const path = require('path')
const fs = require('fs')
const { app } = require('electron')

function getSettingsPath() {
  return path.join(app.getPath('userData'), 'settings.json')
}

function loadSettings() {
  try {
    const data = fs.readFileSync(getSettingsPath(), 'utf-8')
    return JSON.parse(data)
  } catch {
    return {}
  }
}

function saveSettings(settings) {
  try {
    const current = loadSettings()
    const merged = { ...current, ...settings }
    fs.writeFileSync(getSettingsPath(), JSON.stringify(merged, null, 2), 'utf-8')
  } catch {
    // silently fail
  }
}

function validateEnvFileName(fileName) {
  if (typeof fileName !== 'string') return false
  if (!fileName.startsWith('.env')) return false
  if (fileName.includes('/') || fileName.includes('\\')) return false
  if (fileName.includes('..')) return false
  return true
}

function validateEnvPath(projectPath, fileName) {
  const resolved = path.resolve(projectPath, fileName)
  const normalizedProject = path.resolve(projectPath)
  if (!resolved.startsWith(normalizedProject + path.sep) && resolved !== normalizedProject) return false
  return true
}

module.exports = {
  getSettingsPath,
  loadSettings,
  saveSettings,
  validateEnvFileName,
  validateEnvPath
}
