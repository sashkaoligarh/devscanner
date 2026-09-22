const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { app, safeStorage } = require('electron')
const { loadSettings, saveSettings } = require('./settings-store')

// Keep credentials out of settings.json. On systems without a keyring, use the
// same OS file permissions as SSH private keys, including a private directory.
function storagePath(id) {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error('Invalid deployment storage identifier')
  return path.join(app.getPath('userData'), 'deploy-state', id + '.json')
}
function writePrivate(id, value) {
  const file = storagePath(id), directory = path.dirname(file)
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  fs.chmodSync(directory, 0o700)
  const encrypted = safeStorage.isEncryptionAvailable()
  const data = JSON.stringify({ encrypted, data: encrypted ? safeStorage.encryptString(JSON.stringify(value)).toString('base64') : value })
  const temporary = file + '.' + crypto.randomBytes(8).toString('hex') + '.tmp'
  try {
    fs.writeFileSync(temporary, data, { mode: 0o600, flag: 'wx' })
    fs.renameSync(temporary, file)
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary) }
}
function readPrivate(id) {
  const file = storagePath(id)
  let text
  try { text = fs.readFileSync(file, 'utf8') } catch (err) { if (err.code === 'ENOENT') return null; throw err }
  const stored = JSON.parse(text)
  if (!stored.encrypted) return stored.data
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Unlock secure storage to read the saved deployment credentials')
  return JSON.parse(safeStorage.decryptString(Buffer.from(stored.data, 'base64')))
}
const sameTarget = (a, b) => a.projectPath === b.projectPath && a.serverId === b.serverId && (a.targetId || '') === (b.targetId || '') && a.mode === b.mode
function listDeployStates(projectPath) {
  return (loadSettings().deploySetups || []).filter(p => p.projectPath === projectPath).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
}
function getDeployState(identity) {
  const profile = listDeployStates(identity.projectPath).find(p => sameTarget(p, identity))
  if (!profile) return null
  const saved = readPrivate('record-' + profile.id)
  return saved ? { ...saved, profile } : { profile, input: { ...profile } }
}
function saveDeployState(record) {
  const current = loadSettings().deploySetups || []
  const previous = current.find(p => sameTarget(p, record.profile))
  const id = previous?.id || crypto.createHash('sha256').update(JSON.stringify([record.profile.projectPath, record.profile.serverId, record.profile.targetId || '', record.profile.mode])).digest('hex').slice(0, 24)
  const profile = { ...previous, ...record.profile, id, updatedAt: new Date().toISOString() }
  const saved = { ...record, profile, ...(record.result ? { result: { ...record.result, profile } } : {}) }
  writePrivate('record-' + id, saved)
  saveSettings({ deploySetups: [...current.filter(p => p.id !== id), profile] })
  if (JSON.stringify(loadSettings().deploySetups?.find(p => p.id === id)) !== JSON.stringify(profile)) throw new Error('Could not save deployment status')
  return saved
}
function saveDeployDraft(input) {
  if (!input.projectPath || !input.serverId || !['private-vpn', 'github-direct'].includes(input.mode)) throw new Error('Choose a project, server and deployment mode before saving')
  const previous = getDeployState(input)
  return saveDeployState({ ...previous, input, profile: {
    ...previous?.profile, projectPath: input.projectPath, projectName: path.basename(input.projectPath), serverId: input.serverId,
    targetId: input.targetId, mode: input.mode, status: previous?.profile.status || 'draft'
  } })
}

module.exports = { listDeployStates, getDeployState, saveDeployState, saveDeployDraft, writePrivate, readPrivate }
