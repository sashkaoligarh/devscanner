// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const {
  detectDeploySetup,
  buildInventory,
  buildSecretBundle,
  sanitizeLinuxUser
} = require('../../../electron/utils/deploy-setup')

const tempDirs = []

function makeProject(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`))
  tempDirs.push(dir)
  return dir
}

function write(filePath, content = '') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content, 'utf-8')
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('deploy setup utils', () => {
  it('detects GitHub direct workflows and keeps existing secret names', () => {
    const project = makeProject('ocp-front')
    write(path.join(project, 'deployment', 'vars.yml'), '$ANSIBLE_VAULT;1.1;AES256')
    write(path.join(project, '.github', 'workflows', 'ci-prod.yml'), `
      key: \${{ secrets.SSH_PRIVATE_KEY_PROD }}
      inventory: \${{ secrets.INVENTORY_PROD }}
      known_hosts: \${{ secrets.KNOW_HOSTS_PROD }}
      vault_password: \${{ secrets.ANSIBLE_VAULET }}
      strapi: \${{ vars.STRAPI_URL }}
    `)

    const setup = detectDeploySetup(project)

    expect(setup.mode).toBe('github-direct')
    expect(setup.hasDeploymentDir).toBe(true)
    expect(setup.secrets).toEqual(expect.arrayContaining([
      'SSH_PRIVATE_KEY_PROD',
      'INVENTORY_PROD',
      'KNOW_HOSTS_PROD',
      'ANSIBLE_VAULET'
    ]))
    expect(setup.variables).toEqual(['STRAPI_URL'])
  })

  it('detects private vpn autodeploy projects and server env keys', () => {
    const project = makeProject('kpcep')
    write(path.join(project, 'deploy', 'kpcep-autodeploy.sh'), '#!/usr/bin/env bash')
    write(path.join(project, 'deploy', 'server.env.example'), 'STRAPI_URL=\nTELEGRAM_BOT_TOKEN=\n')

    const setup = detectDeploySetup(project)

    expect(setup.mode).toBe('private-vpn')
    expect(setup.autodeployScript).toBe('kpcep-autodeploy.sh')
    expect(setup.serverEnvKeys).toEqual(['STRAPI_URL', 'TELEGRAM_BOT_TOKEN'])
  })

  it('builds generated deploy secret values', () => {
    const inventory = buildInventory({ host: '10.0.0.10', port: 2222, deployUser: 'deploy-app' })
    const secrets = buildSecretBundle({
      detectedSecrets: ['SSH_PRIVATE_KEY_PROD', 'KNOWN_HOSTS_PROD', 'DOCKER_PASSWORD'],
      mode: 'private-vpn',
      privateKey: 'PRIVATE',
      knownHosts: 'HOSTKEY',
      inventory,
      vaultPassword: 'VAULT'
    })

    expect(inventory).toContain('ansible_host=10.0.0.10')
    expect(secrets.find(s => s.name === 'SSH_PRIVATE_KEY_PROD')?.value).toBe('PRIVATE')
    expect(secrets.find(s => s.name === 'KNOWN_HOSTS_PROD')?.value).toBe('HOSTKEY')
    expect(secrets.find(s => s.name === 'INVENTORY_PROD')?.value).toContain('deploy-app')
    expect(secrets.find(s => s.name === 'DOCKER_PASSWORD')?.value).toBe('')
  })

  it('sanitizes deploy user names', () => {
    expect(sanitizeLinuxUser('Deploy App!!')).toBe('deploy-app')
    expect(sanitizeLinuxUser('123bad')).toBe('deploy')
  })
})
