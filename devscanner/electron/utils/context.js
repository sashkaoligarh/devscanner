const { execSync, spawn } = require('child_process')

function isWslPath(p) {
  return process.platform === 'win32' && /^\\\\wsl/i.test(p)
}

function parseWslPath(p) {
  // \\wsl$\Ubuntu\home\user → { distro: 'Ubuntu', linuxPath: '/home/user' }
  // \\wsl.localhost\Ubuntu\home\user → same
  const match = p.match(/^\\\\wsl(?:\$|\.localhost)\\([^\\]+)(.*)/i)
  if (!match) return null
  return {
    distro: match[1],
    linuxPath: match[2].replace(/\\/g, '/') || '/'
  }
}

function shellQuote(s) {
  if (/^[a-zA-Z0-9._\-\/=:@]+$/.test(s)) return s
  return "'" + s.replace(/'/g, "'\\''") + "'"
}

function execInContext(command, options) {
  if (options.cwd && isWslPath(options.cwd)) {
    const parsed = parseWslPath(options.cwd)
    if (parsed) {
      // Use bash -lic to get login shell with proper PATH (nvm, etc.)
      const escaped = command.replace(/"/g, '\\"')
      return execSync(
        `wsl.exe -d ${parsed.distro} --cd "${parsed.linuxPath}" -- bash -lic "${escaped}"`,
        { ...options, cwd: undefined }
      )
    }
  }
  return execSync(command, options)
}

function spawnInContext(command, args, options) {
  if (options?.cwd && isWslPath(options.cwd)) {
    const parsed = parseWslPath(options.cwd)
    if (parsed) {
      // Build command string for bash -lic (login shell for proper PATH)
      const envPrefix = []
      if (options.env) {
        for (const [k, v] of Object.entries(options.env)) {
          if (process.env[k] !== v) envPrefix.push(`export ${k}=${shellQuote(v)}`)
        }
      }
      const cmdParts = [command, ...args.map(shellQuote)]
      const fullCmd = envPrefix.length > 0
        ? envPrefix.join(' && ') + ' && ' + cmdParts.join(' ')
        : cmdParts.join(' ')

      const wslArgs = ['-d', parsed.distro, '--cd', parsed.linuxPath, '--', 'bash', '-lic', fullCmd]
      return spawn('wsl.exe', wslArgs, {
        ...options, cwd: undefined, env: undefined, shell: false
      })
    }
  }
  return spawn(command, args, options)
}

module.exports = {
  isWslPath,
  parseWslPath,
  shellQuote,
  execInContext,
  spawnInContext
}
