// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { execFileSync } from 'child_process'
const yaml = require('js-yaml')
const { PORT_PROBE, parsePort, parseProbe, overlaps, planPorts, applyPorts, rewriteHostEndpoints, checkTLS } = require('../../../electron/utils/deploy-preflight')

const compose = { services: { cms: { ports: ['127.0.0.1:1337:1337'] }, frontend: { ports: ['127.0.0.1:4321:8080'] }, db: { expose: ['5432'] } } }
const busy = (port, owner = 'Docker other-cms', address = '0.0.0.0', protocol = 'tcp') => ({ port, address, protocol, owner })
const probe = (sockets = '', containers = []) => sockets + '\nDEVSCANNER_CONTAINERS\n' + containers.map(c => c.map(v => JSON.stringify(v)).join(' ') + '\n').join('') + 'DEVSCANNER_PORTS_END\n'

describe('published host ports', () => {
  it('supports short/long syntax, IPv6, variables and dynamic host ports', () => {
    expect(parsePort('1337:8080', {})).toMatchObject({ port: 1337, target: 8080, address: '0.0.0.0' })
    expect(parsePort('[::1]:${PORT:-5000}:8080/udp', {})).toMatchObject({ address: '::1', port: 5000, protocol: 'udp' })
    expect(parsePort({ target: 80, published: '${PORT}', host_ip: '127.0.0.1' }, { PORT: '9000' })).toMatchObject({ port: 9000, target: 80 })
    expect(parsePort('8080', {})).toBeNull()
    expect(parsePort('127.0.0.1:0:8080', {})).toBeNull()
    expect(() => parsePort('${MISSING}:80', {})).toThrow('MISSING')
  })
  it('compares bind addresses and protocols while reserving IPv6 wildcard', () => {
    expect(overlaps(busy(80), busy(80, '', '127.0.0.1'))).toBe(true)
    expect(overlaps(busy(80, '', '::'), busy(80))).toBe(true)
    expect(overlaps(busy(80, '', '127.0.0.2'), busy(80, '', '127.0.0.1'))).toBe(false)
    expect(overlaps(busy(80), busy(80, '', '0.0.0.0', 'udp'))).toBe(false)
  })
  it('ignores exposed/internal ports, finds NAT ports, allows nginx virtual hosts and allocates free suggestions', () => {
    const metadata = parseProbe(probe('tcp LISTEN 0 511 0.0.0.0:80 0.0.0.0:* users:(("nginx",pid=10,fd=6))\n', [
      ['/other-cms', true, { '1337/tcp': [{ HostIp: '0.0.0.0', HostPort: '1337' }] }, 'other', '/opt/other/stack', '/opt/other/stack/stack.yml']
    ]), '/opt/app', 'app')
    const report = planPorts({ compose, nginx: 'server { listen 80; listen [::]:80; }', occupied: [...metadata.occupied, busy(1338)] })
    expect(report.ports.map(p => p.service)).not.toContain('db')
    expect(report.ports[0]).toMatchObject({ conflicts: ['Docker other-cms'], suggestedPort: 1339 })
    expect(report.ports.filter(p => p.kind === 'nginx').every(p => !p.conflicts.length)).toBe(true)
    expect(report.blocked).toBe(true)
  })
  it('only exempts containers belonging to this remote compose file and detects reused project names', () => {
    const output = probe('tcp LISTEN 0 4096 0.0.0.0:1337 0.0.0.0:* users:(("docker-proxy",pid=20,fd=7))\n', [
      ['/app-cms-1', true, { '1337/tcp': [{ HostIp: '0.0.0.0', HostPort: '1337' }] }, 'app', '/opt/app/stack', '/opt/app/stack/stack.yml'],
      ['/old-cms-1', false, {}, 'app', '/opt/other/stack', '/opt/other/stack/stack.yml']
    ])
    const metadata = parseProbe(output, '/opt/app', 'app')
    expect(metadata.occupied).toEqual([])
    expect(metadata.issues.join()).toContain('/old-cms-1')
    expect(parseProbe(output, '/opt/new', 'new').occupied).toHaveLength(1)
  })
  it('blocks unavailable inspection, unsupported ranges, host networking and stale/manual bad choices', () => {
    expect(() => parseProbe('', '/opt/app', 'app')).toThrow('did not complete')
    expect(planPorts({ compose, overrides: { 'cms:0': '99999' } }).blocked).toBe(true)
    expect(planPorts({ compose, overrides: { unknown: 9000 } }).blocked).toBe(true)
    expect(planPorts({ compose, overrides: { 'cms:0': 4321 } }).ports.filter(p => p.conflicts.length)).toHaveLength(2)
    const report = planPorts({ compose: { services: { app: { network_mode: 'host', ports: ['8000-8010:80-90'] } } } })
    expect(report.issues).toHaveLength(2)
  })
  it('detects nginx versus a container on 80 and prevents suggestions from using planned listeners', () => {
    const report = planPorts({ compose, nginx: 'server { listen 1338; listen 80; }', occupied: [busy(1337), busy(80)] })
    expect(report.ports[0].suggestedPort).toBe(1339)
    expect(report.ports.find(p => p.port === 80).conflicts).toEqual(['Docker other-cms'])
    expect(planPorts({ compose: { services: { app: { ports: ['65535:80'] } } }, occupied: [busy(65535)] }).ports[0].suggestedPort).toBe(1024)
    expect(planPorts({ nginx: 'server { listen localhost:80; }' }).blocked).toBe(true)
  })
  it('rewrites host mappings, nginx and updater URLs without changing container health checks or internal URLs', () => {
    const input = yaml.load(`services:
  cms:
    ports: ["127.0.0.1:1337:1337"]
    healthcheck: {test: ["CMD", "curl", "http://127.0.0.1:1337/health"]}
  frontend:
    ports: [{target: 8080, published: "4321", host_ip: "127.0.0.1"}]
    environment: {STRAPI_URL: "http://cms:1337"}
`)
    const report = planPorts({ compose: input, overrides: { 'cms:0': 1339, 'frontend:0': 4322 } })
    const result = yaml.load(applyPorts(input, report))
    expect(result.services.cms.ports).toEqual(['127.0.0.1:1339:1337/tcp'])
    expect(result.services.frontend.ports[0]).toMatchObject({ target: 8080, published: '4322', host_ip: '127.0.0.1' })
    expect(result.services.cms.healthcheck.test[2]).toContain(':1337/')
    expect(result.services.frontend.environment.STRAPI_URL).toBe('http://cms:1337')
    expect(rewriteHostEndpoints('upstream cms { server 127.0.0.1:1337; } proxy_pass http://localhost:4321; proxy_pass http://cms:1337;', report.ports)).toBe('upstream cms { server 127.0.0.1:1339; } proxy_pass http://localhost:4322; proxy_pass http://cms:1337;')
    expect(rewriteHostEndpoints('URL="${CMS_HEALTHCHECK_URL:-http://127.0.0.1:1337/health}"', report.ports, true)).toContain(':1339/health')
  })
  it('does not change a sibling service sharing a YAML ports alias', () => {
    const input = yaml.load('services:\n  a:\n    ports: &ports ["8080:80"]\n  b:\n    ports: *ports\n')
    const report = planPorts({ compose: input, overrides: { 'a:0': 8081 } })
    const output = yaml.load(applyPorts(input, report))
    expect(output.services.b.ports).toEqual(['8080:80'])
  })
  it('validates inspection shell syntax', () => { execFileSync('bash', ['-n'], { input: 'set -e\n' + PORT_PROBE }) })
})

describe('TLS diagnostics', () => {
  const paths = [{ key: false, path: '/etc/nginx/certs/app.crt' }, { key: true, path: '/etc/nginx/certs/app.key' }]
  it.each(['missing', 'empty', 'unreadable'])('identifies a %s file without exposing content', async status => {
    const sudo = vi.fn().mockResolvedValueOnce(status).mockResolvedValueOnce('ok')
    const issues = await checkTLS(sudo, paths, {})
    expect(issues).toHaveLength(1)
    expect(issues[0]).toContain(paths[0].path)
    expect(issues[0]).toContain(status === 'unreadable' ? 'not readable' : status)
    expect(issues[0]).toContain('Advanced → TLS')
    for (const [command] of sudo.mock.calls) execFileSync('bash', ['-n'], { input: command })
  })
  it('distinguishes failed sudo from missing TLS files and rejects an incomplete pair locally', async () => {
    const sudo = vi.fn().mockRejectedValue(new Error('secret remote output'))
    await expect(checkTLS(sudo, paths, {})).rejects.toThrow('Verify SSH sudo permissions')
    expect(await checkTLS(sudo, paths, { sslCert: 'cert' })).toEqual(['Provide both TLS certificate and private key in Advanced → TLS.'])
    expect(await checkTLS(sudo, paths, { sslCert: 'cert', sslKey: 'key' })).toEqual(['TLS certificate and private key must be valid PEM files and match. Correct them in Advanced → TLS.'])
  })
})
