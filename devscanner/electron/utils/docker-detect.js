const { execSync } = require('child_process')
const { isWslPath, parseWslPath } = require('./context')

function isDockerAvailable() {
  try {
    execSync('docker --version', { encoding: 'utf-8', timeout: 3000, stdio: 'pipe' })
    return true
  } catch { return false }
}

function getDockerComposeCmd() {
  try {
    execSync('docker compose version', { encoding: 'utf-8', timeout: 3000, stdio: 'pipe' })
    return { cmd: 'docker', prefixArgs: ['compose'] }
  } catch {}
  try {
    execSync('docker-compose --version', { encoding: 'utf-8', timeout: 3000, stdio: 'pipe' })
    return { cmd: 'docker-compose', prefixArgs: [] }
  } catch {}
  return null
}

function isDockerAvailableInContext(projectPath) {
  if (process.platform === 'win32' && isWslPath(projectPath)) {
    const parsed = parseWslPath(projectPath)
    if (!parsed) return false
    try {
      execSync(
        `wsl.exe -d ${parsed.distro} -- bash -lic "docker --version"`,
        { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' }
      )
      return true
    } catch { return false }
  }
  return isDockerAvailable()
}

function getDockerComposeCmdInContext(projectPath) {
  if (process.platform === 'win32' && isWslPath(projectPath)) {
    const parsed = parseWslPath(projectPath)
    if (!parsed) return null
    try {
      execSync(
        `wsl.exe -d ${parsed.distro} -- bash -lic "docker compose version"`,
        { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' }
      )
      return { cmd: 'docker', prefixArgs: ['compose'] }
    } catch {}
    try {
      execSync(
        `wsl.exe -d ${parsed.distro} -- bash -lic "docker-compose --version"`,
        { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' }
      )
      return { cmd: 'docker-compose', prefixArgs: [] }
    } catch {}
    return null
  }
  return getDockerComposeCmd()
}

module.exports = {
  isDockerAvailable,
  getDockerComposeCmd,
  isDockerAvailableInContext,
  getDockerComposeCmdInContext
}
