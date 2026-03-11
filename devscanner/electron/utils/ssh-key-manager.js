const crypto = require('crypto')
const { safeStorage } = require('electron')
const { utils: sshUtils } = require('ssh2')

function validateSSHKey(privateKeyData, passphrase) {
  try {
    const parsed = sshUtils.parseKey(privateKeyData, passphrase || undefined)
    if (parsed instanceof Error) {
      // Check if it's a passphrase error
      if (parsed.message && parsed.message.includes('passphrase')) {
        return { valid: false, error: 'Invalid passphrase' }
      }
      return { valid: false, error: 'Invalid SSH key format' }
    }

    // parseKey can return array for multiple keys
    const key = Array.isArray(parsed) ? parsed[0] : parsed
    if (!key) return { valid: false, error: 'Invalid SSH key format' }

    const keyType = detectKeyType(key.type)
    const fingerprint = computeFingerprint(key)

    return { valid: true, keyType, fingerprint }
  } catch (err) {
    if (err.message && err.message.includes('passphrase')) {
      return { valid: false, error: 'Invalid passphrase' }
    }
    return { valid: false, error: 'Invalid SSH key format' }
  }
}

function detectKeyType(type) {
  if (!type) return 'unknown'
  const t = type.toLowerCase()
  if (t.includes('rsa')) return 'rsa'
  if (t.includes('ed25519')) return 'ed25519'
  if (t.includes('ecdsa')) return 'ecdsa'
  return 'unknown'
}

function computeFingerprint(parsedKey) {
  try {
    const pubKeyData = parsedKey.getPublicSSH()
    if (!pubKeyData) return ''
    const hash = crypto.createHash('sha256').update(pubKeyData).digest('base64').replace(/=+$/, '')
    return `SHA256:${hash}`
  } catch {
    return ''
  }
}

function encryptKeyData(privateKeyData) {
  if (!safeStorage.isEncryptionAvailable()) return privateKeyData
  return safeStorage.encryptString(privateKeyData).toString('base64')
}

function decryptKeyData(encryptedBase64) {
  if (!safeStorage.isEncryptionAvailable()) return encryptedBase64
  return safeStorage.decryptString(Buffer.from(encryptedBase64, 'base64'))
}

function encryptPassphrase(passphrase) {
  if (!passphrase || !safeStorage.isEncryptionAvailable()) return null
  return safeStorage.encryptString(passphrase).toString('base64')
}

function decryptPassphrase(encryptedBase64) {
  if (!encryptedBase64 || !safeStorage.isEncryptionAvailable()) return null
  return safeStorage.decryptString(Buffer.from(encryptedBase64, 'base64'))
}

module.exports = {
  validateSSHKey,
  encryptKeyData,
  decryptKeyData,
  encryptPassphrase,
  decryptPassphrase
}
