// @vitest-environment node
import { it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import Module from 'module'

let directory, settings, encrypted
const originalLoad = Module._load
Module._load = function (request, parent) {
  if (parent?.filename.endsWith('deploy-state.js')) {
    if (request === 'electron') return { app: { getPath: () => directory }, safeStorage: {
      isEncryptionAvailable: () => encrypted,
      encryptString: text => Buffer.from('encrypted:' + text),
      decryptString: buffer => buffer.toString().replace(/^encrypted:/, '')
    } }
    if (request === './settings-store') return { loadSettings: () => settings, saveSettings: next => { settings = { ...settings, ...next } } }
  }
  return originalLoad.apply(this, arguments)
}
const { saveDeployState, getDeployState, saveDeployDraft, listDeployStates, writePrivate, readPrivate } = require('../../../electron/utils/deploy-state')
Module._load = originalLoad
const identity = { projectPath: '/projects/app', projectName: 'app', serverId: 'one', targetId: 'workflow', mode: 'github-direct' }
beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-storage-')); settings = {}; encrypted = true })
afterEach(() => fs.rmSync(directory, { recursive: true, force: true }))

it.each([true, false])('persists credentials with encrypted storage=%s without adding secrets to settings.json', available => {
  encrypted = available
  const record = saveDeployState({ profile: { ...identity, status: 'failed' }, input: { ...identity, envValues: { TOKEN: 'env-secret' } }, result: { secrets: [{ name: 'SSH_PRIVATE_KEY', value: 'private-key-secret' }] } })
  const loaded = getDeployState(identity)
  expect(loaded.input.envValues.TOKEN).toBe('env-secret')
  expect(loaded.result.secrets[0].value).toBe('private-key-secret')
  expect(loaded.result.profile.status).toBe('failed')
  expect(JSON.stringify(settings)).not.toMatch(/env-secret|private-key-secret/)
  const folder = path.join(directory, 'deploy-state')
  const file = path.join(folder, 'record-' + record.profile.id + '.json')
  expect(fs.statSync(folder).mode & 0o777).toBe(0o700)
  expect(fs.statSync(file).mode & 0o777).toBe(0o600)
  if (available) expect(fs.readFileSync(file, 'utf8')).not.toContain('private-key-secret')
  expect(fs.readdirSync(folder)).toHaveLength(1)
})

it('saves per-server drafts without discarding successful results or exposing another target', () => {
  saveDeployState({ profile: { ...identity, status: 'prepared', automation: 'workflow-required' }, result: { secrets: [{ value: 'existing-key' }] } })
  saveDeployDraft({ ...identity, domain: 'app.test', envValues: { PASSWORD: 'draft-value' } })
  saveDeployDraft({ ...identity, serverId: 'two', domain: 'other.test' })
  expect(getDeployState(identity)).toMatchObject({ profile: { status: 'prepared' }, input: { domain: 'app.test' }, result: { secrets: [{ value: 'existing-key' }] } })
  expect(getDeployState({ ...identity, serverId: 'two' })).toMatchObject({ profile: { status: 'draft' }, input: { domain: 'other.test' } })
  expect(getDeployState({ ...identity, targetId: 'other' })).toBeNull()
  expect(listDeployStates('/projects/app')).toHaveLength(2)
  expect(listDeployStates('/projects/other')).toEqual([])
})

it('keeps existing profiles and refuses to overwrite unreadable encrypted credentials', () => {
  settings.deploySetups = [{ ...identity, id: 'old-profile', tlsMode: 'certbot' }]
  expect(getDeployState(identity).input.tlsMode).toBe('certbot')
  const saved = saveDeployDraft({ ...identity, privateKey: 'preserve-me' })
  expect(saved.profile.id).toBe('old-profile')
  encrypted = false
  expect(() => saveDeployDraft({ ...identity, privateKey: 'replacement' })).toThrow('Unlock secure storage')
  encrypted = true
  expect(getDeployState(identity).input.privateKey).toBe('preserve-me')
})

it('persists keys independently of a setup outcome and rejects invalid storage paths', () => {
  writePrivate('key-abc', 'saved-private-key')
  expect(readPrivate('key-abc')).toBe('saved-private-key')
  expect(readPrivate('key-missing')).toBeNull()
  expect(() => writePrivate('../outside', 'data')).toThrow('identifier')
})
