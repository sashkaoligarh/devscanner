// @vitest-environment node
import { it, expect, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawnSync } from 'child_process'
const { envSecrets, redactDeployOutput, firstDeployCommand, deploymentDiagnosticsCommand, deploymentFailure } = require('../../../electron/utils/deploy-output')
const roots = []
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })))

it('persists stdout/stderr privately, preserves exit status and replaces the previous attempt log', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deploy output 'test-")); roots.push(root)
  fs.mkdirSync(path.join(root, 'bin')); fs.mkdirSync(path.join(root, 'run'))
  const launcher = path.join(root, 'bin/devscanner-deploy')
  fs.writeFileSync(launcher, '#!/bin/bash\necho pull-failed\necho registry-denied >&2\nexit 17\n', { mode: 0o700 })
  const command = 'set -e\n' + firstDeployCommand(root)
  const failed = spawnSync('bash', ['-c', command], { encoding: 'utf8' })
  expect(failed.status).toBe(17)
  expect(failed.stdout).toContain('registry-denied')
  const logfile = path.join(root, 'run/first-deploy.log')
  expect(fs.readFileSync(logfile, 'utf8')).toBe('pull-failed\nregistry-denied\n')
  expect(fs.statSync(logfile).mode & 0o777).toBe(0o600)
  fs.writeFileSync(launcher, '#!/bin/bash\necho deploy-ready\n')
  const passed = spawnSync('bash', ['-c', command], { encoding: 'utf8' })
  expect(passed.status).toBe(0)
  expect(passed.stdout).toContain('deploy-ready')
  expect(fs.readFileSync(logfile, 'utf8')).not.toContain('registry-denied')
})

it('explains deployment failures without exposing credentials or hiding the remote error', () => {
  const message = deploymentFailure({ code: 1, stdout: 'failed to get bearer token for example/cms\ncurl: 403 DENIED\nPassword=secret-password\nknown-sensitive-value\nAuthorization: Bearer abc123' }, { ghcr: true, secrets: ['known-sensitive-value'], logPath: '/opt/app/run/first-deploy.log' })
  expect(message).toContain('403 DENIED')
  expect(message).toContain('personal access token (classic)')
  expect(message).toContain('read:packages')
  expect(message).not.toMatch(/secret-password|known-sensitive-value|abc123/)
  expect(message).toContain('/opt/app/run/first-deploy.log')
  expect(deploymentFailure({ stderr: 'manifest unknown' })).toContain('release tag')
  expect(deploymentFailure({ stderr: 'cms is unhealthy' })).toContain('health status')
  expect(deploymentFailure({ error: 'SSH sudo timeout' })).toContain('SSH sudo timeout')
})

it('masks env credentials and individual app keys while keeping container names, URLs and boolean health values readable', () => {
  const env = { STACK_NAME: 'demining', CMS_IMAGE_REPO: 'ghcr.io/team/cms', FRONTEND_HEALTHCHECK_URL: 'http://127.0.0.1:4321/readyz', DATABASE_SSL_REJECT_UNAUTHORIZED: 'true', POSTGRES_PASSWORD: 'database-password', API_TOKEN_SALT: 'private-salt', APP_KEYS: 'first-key,second-key', REGISTRY_CREDENTIAL: 'registry-login', HTTP_AUTHORIZATION: 'authorization-value' }
  const output = redactDeployOutput('demining-cms-1 ghcr.io/team/cms http://127.0.0.1:4321/readyz running=true database-password private-salt first-key second-key registry-login authorization-value', envSecrets(env))
  expect(output).toContain('demining-cms-1 ghcr.io/team/cms http://127.0.0.1:4321/readyz running=true')
  expect(output).not.toMatch(/database-password|private-salt|first-key|second-key|registry-login|authorization-value/)
})

it('reads bounded project diagnostics and local readiness responses without following external or credentialed URLs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-health-')); roots.push(root)
  fs.writeFileSync(path.join(root, 'docker'), '#!/bin/bash\nprintf "%s\\n" "$*" >> "$DIAGNOSTIC_CALLS"\ncase "$1" in ps) echo container-id;; inspect) echo "Container /demo-web: status=running health=healthy exit=0 oom=false";; logs) echo "service log";; esac\n', { mode: 0o700 })
  fs.writeFileSync(path.join(root, 'curl'), '#!/bin/bash\nprintf "%s\\n" "$*" >> "$DIAGNOSTIC_CALLS"\necho \'{"status":"not-ready","cms":"unavailable"}\'\necho "HTTP 503"\n', { mode: 0o700 })
  const command = deploymentDiagnosticsCommand("/opt/project 'quoted", {
    FRONTEND_HEALTHCHECK_URL: 'http://127.0.0.1:4321/readyz', CMS_HEALTHCHECK_URL: 'http://localhost:1337/ready',
    OTHER_HEALTHCHECK_URL: 'http://169.254.169.254/latest/meta-data', PUBLIC_SITE_URL: 'https://example.com',
    SECRET_HEALTHCHECK_URL: 'http://user:password@localhost/ready', INVALID_HEALTHCHECK_URL: '$(touch /tmp/never-run)',
  })
  const calls = path.join(root, 'calls')
  const result = spawnSync('bash', ['-ec', command], { encoding: 'utf8', env: { ...process.env, PATH: root + ':' + process.env.PATH, DIAGNOSTIC_CALLS: calls } })
  expect(result.status).toBe(0)
  expect(result.stdout).toContain('"cms":"unavailable"')
  expect(result.stdout).toContain('HTTP 503')
  expect(result.stdout).toContain('health=healthy')
  expect(result.stdout).toContain('service log')
  const invoked = fs.readFileSync(calls, 'utf8')
  expect(invoked).toContain("label=com.docker.compose.project.config_files=/opt/project 'quoted/stack/stack.yml")
  expect(invoked).toContain('--max-time 5 --max-filesize 4096')
  expect(invoked).not.toMatch(/169\.254|example\.com|user:password|never-run/)
})
