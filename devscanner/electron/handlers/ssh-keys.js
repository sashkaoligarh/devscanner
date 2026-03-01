const crypto = require('crypto')
const { safeStorage } = require('electron')
const { getSSHClient, sshExec, sshExecSudo, getServerPassword } = require('../utils/ssh-pool')
const { loadSettings, saveSettings } = require('../utils/settings-store')

function fingerprint(keyData) {
  try {
    const buf = Buffer.from(keyData, 'base64')
    const hash = crypto.createHash('sha256').update(buf).digest('base64').replace(/=+$/, '')
    return `SHA256:${hash}`
  } catch {
    return ''
  }
}

function parseAuthorizedKeys(raw) {
  return raw.split('\n').filter(l => l.trim() && !l.trim().startsWith('#')).map((line, index) => {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 2) return null
    const type = parts[0]
    const keyData = parts[1]
    const comment = parts.slice(2).join(' ')
    return { index, type, keyData, comment, fingerprint: fingerprint(keyData), raw: line.trim() }
  }).filter(Boolean)
}

function registerSshKeysHandlers(ipcMain) {
  // --- Authorized Keys ---

  ipcMain.handle('ssh-authorized-keys-list', async (_, { serverId }) => {
    try {
      const client = getSSHClient(serverId)
      if (!client) return { success: false, error: 'Not connected' }
      const { stdout, code } = await sshExec(client, 'cat ~/.ssh/authorized_keys 2>/dev/null')
      if (code !== 0 || !stdout.trim()) return { success: true, data: [] }
      return { success: true, data: parseAuthorizedKeys(stdout) }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('ssh-authorized-keys-add', async (_, { serverId, publicKey }) => {
    try {
      const client = getSSHClient(serverId)
      if (!client) return { success: false, error: 'Not connected' }
      const key = publicKey.trim()
      if (!key) return { success: false, error: 'Empty key' }
      // Ensure ~/.ssh exists with correct permissions
      await sshExec(client, 'mkdir -p ~/.ssh && chmod 700 ~/.ssh')
      await sshExec(client, 'touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys')
      // Append key
      const escaped = key.replace(/'/g, "'\\''")
      await sshExec(client, `echo '${escaped}' >> ~/.ssh/authorized_keys`)
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('ssh-authorized-keys-remove', async (_, { serverId, lineIndex }) => {
    try {
      const client = getSSHClient(serverId)
      if (!client) return { success: false, error: 'Not connected' }
      // lineIndex is 0-based, sed uses 1-based
      const lineNum = lineIndex + 1
      await sshExec(client, `sed -i '${lineNum}d' ~/.ssh/authorized_keys`)
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // --- Deploy Keys ---

  ipcMain.handle('deploy-keys-list', async () => {
    try {
      const settings = loadSettings()
      const keys = (settings.deployKeys || []).map(k => ({
        id: k.id,
        name: k.name,
        publicKey: k.publicKey,
        createdAt: k.createdAt
      }))
      return { success: true, data: keys }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('deploy-keys-save', async (_, { name, privateKey, publicKey, generate }) => {
    try {
      const settings = loadSettings()
      const deployKeys = settings.deployKeys || []
      const id = crypto.randomUUID()
      let privKey = privateKey
      let pubKey = publicKey

      if (generate) {
        // Generate ed25519 key pair using ssh-keygen
        const { execSync } = require('child_process')
        const os = require('os')
        const path = require('path')
        const fs = require('fs')
        const tmpDir = os.tmpdir()
        const tmpPath = path.join(tmpDir, `deploy_key_${id}`)
        try {
          execSync(`ssh-keygen -t ed25519 -f "${tmpPath}" -N "" -C "${name || 'deploy-key'}"`, { timeout: 10000 })
          privKey = fs.readFileSync(tmpPath, 'utf-8')
          pubKey = fs.readFileSync(`${tmpPath}.pub`, 'utf-8').trim()
          fs.unlinkSync(tmpPath)
          fs.unlinkSync(`${tmpPath}.pub`)
        } catch (e) {
          // Cleanup on error
          try { fs.unlinkSync(tmpPath) } catch {}
          try { fs.unlinkSync(`${tmpPath}.pub`) } catch {}
          return { success: false, error: `Key generation failed: ${e.message}` }
        }
      }

      if (!privKey || !pubKey) return { success: false, error: 'Private and public key are required' }

      let encryptedPrivateKey = privKey
      if (safeStorage.isEncryptionAvailable()) {
        encryptedPrivateKey = safeStorage.encryptString(privKey).toString('base64')
      }

      deployKeys.push({
        id,
        name: name || 'Untitled',
        encryptedPrivateKey,
        publicKey: pubKey.trim(),
        createdAt: new Date().toISOString()
      })

      saveSettings({ deployKeys })
      return {
        success: true,
        data: { id, name: name || 'Untitled', publicKey: pubKey.trim(), createdAt: deployKeys[deployKeys.length - 1].createdAt }
      }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('deploy-keys-delete', async (_, { id }) => {
    try {
      const settings = loadSettings()
      const deployKeys = (settings.deployKeys || []).filter(k => k.id !== id)
      saveSettings({ deployKeys })
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })
}

module.exports = { registerSshKeysHandlers }
