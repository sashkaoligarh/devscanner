const { sshExec, sshExecSudo } = require('./ssh-pool')

async function ensureNginx(client, password) {
  const { code } = await sshExec(client, 'nginx -v 2>&1')
  if (code === 0) return { installed: true, wasInstalled: true }
  await sshExecSudo(client, 'apt-get update -qq', password, 30000)
  const install = await sshExecSudo(client, 'apt-get install -y -qq nginx', password, 60000)
  if (install.code !== 0) throw new Error(`Failed to install nginx: ${install.stderr}`)
  return { installed: true, wasInstalled: false }
}

async function ensureNode(client, password) {
  const { code } = await sshExec(client, 'node --version 2>&1')
  if (code === 0) return { installed: true, wasInstalled: true }
  await sshExecSudo(client, 'apt-get update -qq', password, 30000)
  await sshExecSudo(client, 'apt-get install -y -qq ca-certificates curl gnupg', password, 30000)
  await sshExecSudo(client, 'mkdir -p /etc/apt/keyrings', password, 5000)
  await sshExecSudo(client, 'curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg --yes', password, 15000)
  await sshExecSudo(client, 'echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list > /dev/null', password, 5000)
  await sshExecSudo(client, 'apt-get update -qq', password, 30000)
  const install = await sshExecSudo(client, 'apt-get install -y -qq nodejs', password, 60000)
  if (install.code !== 0) throw new Error(`Failed to install Node.js: ${install.stderr}`)
  return { installed: true, wasInstalled: false }
}

async function ensurePM2(client, password) {
  const { code } = await sshExec(client, 'pm2 --version 2>&1')
  if (code === 0) return { installed: true, wasInstalled: true }
  await ensureNode(client, password)
  const install = await sshExecSudo(client, 'npm install -g pm2', password, 60000)
  if (install.code !== 0) throw new Error(`Failed to install PM2: ${install.stderr}`)
  return { installed: true, wasInstalled: false }
}

async function pm2Start(client, { appDir, entryFile, name }) {
  await sshExec(client, `pm2 delete ${name} 2>/dev/null`, 10000)
  const result = await sshExec(client, `cd ${appDir} && pm2 start ${entryFile} --name ${name}`, 15000)
  if (result.code !== 0) throw new Error(`PM2 start failed: ${result.stderr || result.stdout}`)
  return result
}

async function pm2Stop(client, name) {
  return sshExec(client, `pm2 stop ${name} 2>/dev/null`, 10000)
}

async function pm2Status(client, name) {
  const { stdout, code } = await sshExec(client, 'pm2 jlist 2>/dev/null', 10000)
  if (code !== 0 || !stdout.trim()) return null
  try {
    const list = JSON.parse(stdout)
    return list.find(p => p.name === name) || null
  } catch { return null }
}

module.exports = { ensureNginx, ensureNode, ensurePM2, pm2Start, pm2Stop, pm2Status }
