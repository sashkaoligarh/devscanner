// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'
import { privateProject, directProject, write } from '../../fixtures/deploy-project'
const { importProjectEnv, detectDeploySetup, selectTarget, buildInventory, buildSecretBundle, parseEnv, serializeEnv, generateEnvSecrets, readProjectFile } = require('../../../electron/utils/deploy-setup')
const dirs = []
function project() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-test-')); dirs.push(dir); return dir }
afterEach(() => dirs.splice(0).forEach(d => fs.rmSync(d, { recursive: true, force: true })))

describe('project-aware deploy analysis', () => {
  it('isolates target credentials and build dependencies, ignoring commented deployment steps', () => {
    const root = project(); directProject(root)
    write(root, 'deployment/vars-dev.yml', '$ANSIBLE_VAULT;1.1;AES256\nunrelated-vault')
    const setup = detectDeploySetup(root)
    expect(setup.targets).toHaveLength(2)
    const ua = setup.targets[0]
    expect(ua.bindings).toEqual({ privateKey: 'SSH_PRIVATE_KEY_PROD', inventory: 'INVENTORY_PROD_UA', knownHosts: 'KNOWN_HOSTS_PROD_UA', vault: 'ANSIBLE_VAULT_PROD' })
    expect(ua.secrets).toContain('DOCKER_PASSWORD')
    expect(ua.secrets).not.toContain('INVENTORY_PROD_NL')
    expect(setup.secrets).not.toContain('INVENTORY_PROD_PL')
    expect(ua.vaultFiles).toEqual(['deployment/vars-prod.yml'])
    expect(() => selectTarget(setup)).toThrow('Choose')
    expect(() => selectTarget(setup, 'stale')).toThrow('Choose')
  })
  it('recognizes shell updater layout, required env and runtime image refs', () => {
    const root = project(); privateProject(root)
    const setup = detectDeploySetup(root)
    expect(setup.mode).toBe('private-vpn')
    expect(setup.baseVariable).toBe('APP_BASE_DIR')
    expect(setup.managesReleaseState).toBe(true)
    expect(setup.requiredKeys).toEqual(['POSTGRES_PASSWORD', 'CMS_IMAGE_REPO'])
    expect(setup.serverEnvKeys).not.toContain('CMS_IMAGE_REF')
    expect(setup.envFields.find(f => f.key === 'POSTGRES_PASSWORD').value).toBe('')
    expect(setup.secrets).not.toContain('GITHUB_TOKEN')
  })
  it('generates only the exact selected workflow bindings and never invents a vault password', () => {
    const root = project(); directProject(root)
    const target = detectDeploySetup(root).targets[1]
    const inventory = buildInventory({ host: '10.0.0.10', port: 2222, deployUser: 'deploy-app' })
    const bundle = buildSecretBundle({ detectedSecrets: target.secrets, target, mode: 'github-direct', privateKey: 'PRIVATE', knownHosts: 'HOSTKEY', inventory })
    expect(bundle.find(s => s.name === 'INVENTORY_PROD_NL').value).toContain('ansible_port=2222')
    expect(bundle.find(s => s.name === 'SSH_PRIVATE_KEY_PROD').value).toBe('PRIVATE')
    expect(bundle.find(s => s.name === 'ANSIBLE_VAULT_PROD').value).toBe('')
    expect(bundle.find(s => s.name === 'ANSIBLE_VAULT_PROD').description).toContain('Existing')
    expect(bundle.map(s => s.name)).not.toContain('INVENTORY_PROD')
  })
  it('keeps VPN credentials to publishing requirements and supplies matching env values', () => {
    const bundle = buildSecretBundle({ detectedSecrets: ['GITHUB_TOKEN', 'STRAPI_URL'], mode: 'private-vpn', envValues: { STRAPI_URL: 'http://cms:1337' } })
    expect(bundle).toHaveLength(1)
    expect(bundle[0].value).toBe('http://cms:1337')
  })
  it('rejects malformed YAML instead of silently reporting an empty project', () => {
    const root = project(); write(root, '.github/workflows/ci.yml', 'jobs: [}')
    expect(() => detectDeploySetup(root)).toThrow('Invalid YAML')
  })
  it('refuses files that escape the project through symlinks', () => {
    const root = project(); const outside = project(); write(outside, 'secret.env', 'SECRET=hidden')
    fs.symlinkSync(path.join(outside, 'secret.env'), path.join(root, '.env'))
    expect(detectDeploySetup(root).envSources).not.toContain('.env')
    expect(() => readProjectFile(root, '.env')).toThrow('inside the project')
  })
})

describe('env handling', () => {
  it('roundtrips secrets without expanding shell substitutions, dollars or quotes', () => {
    const values = { PASSWORD: "p'a$$ $(touch /tmp/devscanner-test-injection) `echo no` # end", URL: 'https://host/path?a=b&c=d' }
    const text = serializeEnv(values)
    expect(parseEnv(text)).toEqual(values)
    const output = execFileSync('bash', ['-c', text + 'printf "%s" "$PASSWORD"'], { encoding: 'utf8' })
    expect(output).toBe(values.PASSWORD)
    expect(fs.existsSync('/tmp/devscanner-test-injection')).toBe(false)
  })
  it('accepts common dotenv assignments and rejects executable lines', () => {
    expect(parseEnv('export KEY="a=b"\nEMPTY=\nVALUE=hello # comment\n')).toEqual({ KEY: 'a=b', EMPTY: '', VALUE: 'hello' })
    expect(() => parseEnv('source other.env')).toThrow('line 1')
    expect(() => serializeEnv({ KEY: 'line\nbreak' })).toThrow('Invalid env')
  })
  it('maps a service local env through Compose environment names', () => {
    const root = project(); privateProject(root)
    write(root, 'deploy/stack.yml', 'services:\n  cms:\n    image: cms:latest\n    environment:\n      DATABASE_PASSWORD: ${POSTGRES_PASSWORD}\n')
    write(root, 'cms/.env', 'DATABASE_PASSWORD=local-database-secret\nUNRELATED_KEY=leave-out\n')
    expect(importProjectEnv(root, 'cms/.env')).toEqual({ POSTGRES_PASSWORD: 'local-database-secret' })
    expect(() => importProjectEnv(root, '../secret.env')).toThrow('detected env')
  })
  it('generates app secrets only, leaving provider credentials for the user', () => {
    const generated = generateEnvSecrets(['APP_KEYS', 'JWT_SECRET', 'POSTGRES_PASSWORD', 'OPENAI_KEY', 'GHCR_TOKEN'])
    expect(generated.APP_KEYS.split(',')).toHaveLength(4)
    expect(generated.JWT_SECRET).toHaveLength(64)
    expect(generated).not.toHaveProperty('OPENAI_KEY')
    expect(generated).not.toHaveProperty('GHCR_TOKEN')
  })
})
