// @vitest-environment node
import { it, expect } from 'vitest'
import { execFileSync } from 'child_process'
const { prepareCertbot, prepareManual, prepareHttp, httpSiteUrls, serverBlocks, certbotFailure } = require('../../../electron/utils/deploy-tls')
const options = { domain: 'app.example.com', certbotEmail: 'admin@example.com', certbotAgree: true }
const config = `# A project config with maps, routes and redirects
map $http_upgrade $connection_upgrade { default upgrade; '' close; }
upstream app { server 127.0.0.1:4321; }
server { listen 80; listen [::]:80; server_name app.example.com; return 301 https://$host$request_uri; }
server {
  listen 443 ssl http2; listen [::]:443 ssl http2;
  server_name app.example.com;
  ssl_certificate /etc/nginx/certs/missing.crt;
  ssl_certificate_key /etc/nginx/certs/missing.key;
  location / { proxy_pass http://app; }
}
`

it('bootstraps a certificate-free HTTP site and preserves the full final nginx config', () => {
  const plan = prepareCertbot(config, options, '/opt/app', 'app')
  expect(plan.bootstrapConfig).not.toMatch(/ssl|443|missing\.crt/)
  expect(plan.bootstrapConfig).toContain('location ^~ /.well-known/acme-challenge/')
  expect(plan.bootstrapConfig).toContain('root ' + plan.webroot)
  expect(plan.finalConfig).toContain('map $http_upgrade')
  expect(plan.finalConfig).toContain('proxy_pass http://app;')
  expect(plan.finalConfig).toContain('location / { return 301 https://$host$request_uri; }')
  expect(plan.finalConfig).toContain(plan.certificate)
  expect(plan.finalConfig).not.toContain('/etc/nginx/certs/missing')
  expect(serverBlocks(plan.finalConfig)).toHaveLength(2)
  expect(plan.issueCommand).toContain('--keep-until-expiring')
  expect(plan.service.content).toContain('--cert-name ' + plan.certName)
  expect(plan.service.content).toContain('--deploy-hook "nginx -t && systemctl reload nginx"')
  expect(plan.timer.content).toContain('Persistent=true')
  expect(plan.enableCommand).toContain('is-active --quiet')
  expect(plan.testCommand).toContain('--no-random-sleep-on-renew')
  expect(plan.testCommand).toContain('timeout --kill-after=10s 210s certbot renew')
  for (const command of [plan.issueCommand, plan.testCommand, plan.enableCommand]) execFileSync('bash', ['-n'], { input: command })
})

it('adds HTTPS and a challenge/redirect listener to a new HTTP-only project', () => {
  const plan = prepareCertbot('server { listen 80; server_name app.example.com; location / { proxy_pass http://127.0.0.1:4321; } }', options, '/opt/app', 'app')
  expect(plan.finalConfig).toContain('listen 443 ssl;')
  expect(plan.finalConfig).toContain('proxy_pass http://127.0.0.1:4321;')
  expect(plan.finalConfig).toContain('ssl_certificate_key ' + plan.key)
  expect(serverBlocks(plan.finalConfig)).toHaveLength(2)
})

it('reuses the managed ACME route when a deployed config is saved back into the project', () => {
  const first = prepareCertbot(config, options, '/opt/app', 'app')
  const repeated = prepareCertbot(first.finalConfig, options, '/opt/app', 'app')
  expect(repeated.finalConfig).toBe(first.finalConfig)
  expect(repeated.finalConfig.match(/location \^~ \/\.well-known\/acme-challenge\//g)).toHaveLength(1)
  expect(() => prepareCertbot(first.finalConfig.replace(first.webroot, '/var/www/other'), options, '/opt/app', 'app')).toThrow('custom ACME challenge')
  expect(() => prepareCertbot(first.finalConfig.replace('try_files $uri =404;', 'return 403;'), options, '/opt/app', 'app')).toThrow('custom ACME challenge')
})

it('converts a full TLS site to HTTP, keeping app routes and CORS consistent with LAN access', () => {
  const source = 'ssl_certificate /etc/nginx/global.crt;\n' + config.replace('map $http_upgrade', 'map $http_origin $cors { "https://app.example.com" $http_origin; }\nmap $http_upgrade')
    .replace('location / { proxy_pass http://app; }', 'include /etc/letsencrypt/options-ssl-nginx.conf;\nadd_header Strict-Transport-Security "max-age=31536000" always;\nproxy_set_header X-Forwarded-Proto https;\nlocation / { proxy_pass http://app; }\nlocation /external/ { proxy_pass https://api.other.example.com; }')
  const result = prepareHttp(source, '10.3.21.38')
  expect(result.host).toBe('10.3.21.38')
  expect(serverBlocks(result.content)).toHaveLength(1)
  expect(result.content).toContain('server_name app.example.com 10.3.21.38;')
  expect(result.content).toContain('listen 80;')
  expect(result.content).toContain('listen [::]:80;')
  expect(result.content).toContain('"http://10.3.21.38" $http_origin;')
  expect(result.content).toContain('proxy_set_header X-Forwarded-Proto $scheme;')
  expect(result.content).toContain('proxy_pass http://app;')
  expect(result.content).toContain('proxy_pass https://api.other.example.com;')
  expect(result.content).not.toMatch(/ssl_certificate|listen 443|listen[^;]*http2|Strict-Transport-Security|options-ssl-nginx|return 301/)
  expect(source).toContain('listen 443 ssl http2;')
})

it('supports an HTTP-only config, deduplicates dual listeners, and ignores TLS-looking comments/strings', () => {
  const source = '# ssl_certificate /leave-comment;\nserver { listen 80; listen 443 ssl http2; server_name app.example.com; add_header X-Example "ssl_certificate /inside-a-string; }"; if ($scheme = http) { return 301 https://app.example.com$request_uri; } location / { proxy_pass http://app; } }'
  const result = prepareHttp(source, 'app.example.com')
  expect(result.content.match(/listen 80;/g)).toHaveLength(1)
  expect(result.content).toContain('"ssl_certificate /inside-a-string; }"')
  expect(result.content).not.toContain('return 301')
  const plain = 'server { listen 80; server_name internal; location / { proxy_pass http://app; } }'
  expect(prepareHttp(plain, 'internal').content).toBe(plain)
  expect(httpSiteUrls('https://app.example.com:443/api,https://external.example.com', ['app.example.com'], '10.3.21.38')).toBe('http://10.3.21.38/api,https://external.example.com')
  expect(httpSiteUrls('https://app.example.com:8443/api', ['app.example.com'])).toContain('https://')
})

it('does not discard distinct HTTP application routes when converting HTTPS', () => {
  const separate = config.replace('return 301 https://$host$request_uri;', 'location /health { proxy_pass http://monitoring; } return 301 https://$host$request_uri;')
  expect(() => prepareHttp(separate, '10.3.21.38')).toThrow('separate routes')
  expect(() => prepareHttp(config, 'app.test; include /bad')).toThrow('hostname or server IP')
})

it('supports HTTPS-only sites, SAN domains and deterministic isolated certificate names', () => {
  const onlyHttps = config.slice(config.indexOf('server {\n')).replace('server_name app.example.com;', 'server_name app.example.com www.example.com;')
  const plan = prepareCertbot(onlyHttps, options, '/opt/app', 'app')
  expect(plan.domains).toEqual(['app.example.com', 'www.example.com'])
  expect(plan.issueCommand).toContain("-d 'www.example.com'")
  expect(plan.finalConfig).toContain('listen 80;')
  expect(prepareCertbot(onlyHttps, options, '/opt/app', 'app').certName).toBe(plan.certName)
  expect(prepareCertbot(onlyHttps, options, '/opt/other', 'app').certName).not.toBe(plan.certName)
})

it('requires valid domains, email and explicit terms acceptance before a remote command can run', () => {
  expect(() => prepareCertbot(config, { ...options, certbotAgree: false }, '/opt/app', 'app')).toThrow('Accept')
  expect(() => prepareCertbot(config, { ...options, certbotEmail: '' }, '/opt/app', 'app')).toThrow('email')
  expect(() => prepareCertbot(config, { ...options, domain: 'unrelated.example.com' }, '/opt/app', 'app')).toThrow('match server_name')
  expect(() => prepareCertbot(config.replaceAll('app.example.com', '*.example.com'), options, '/opt/app', 'app')).toThrow('wildcards')
})

it('parses quoted braces/comments and converts manual TLS without adding Certbot', () => {
  const source = '# 🎉 server { comment }\nserver { listen 80; server_name app.example.com; location / { add_header X-Test "}"; proxy_pass http://127.0.0.1:4321; } }'
  expect(serverBlocks(source)).toHaveLength(1)
  const result = prepareManual(source, 'app')
  expect(result).toContain('ssl_certificate /etc/nginx/certs/devscanner-app.crt;')
  expect(result).toContain('proxy_pass http://127.0.0.1:4321;')
  expect(result).not.toContain('acme-challenge')
  expect(prepareManual(config, 'app')).toBe(config)
})

it.each([
  ['DNS problem: NXDOMAIN looking up A for app.example.com', 'Check public DNS'],
  ['Timeout during connect (likely firewall problem)', 'public TCP port 80'],
  ['Invalid response from http://app.example.com/.well-known/acme-challenge/abc: 404', 'another site or proxy'],
  ['urn:ietf:params:acme:error:rateLimited: too many failed authorizations', 'retry time'],
  ['CAA record prevents issuance', 'CAA records'],
  ['Unable to register an account with the supplied email', 'account email']
])('retains the actual Certbot error and explains %s', (message, hint) => {
  const error = certbotFailure({ code: 1, stderr: message })
  expect(error).toContain(message)
  expect(error).toContain(hint)
  expect(error).toContain('(exit 1)')
  expect(error).not.toContain('was restored')
})

it('redacts private keys and known credentials before bounding diagnostic output', () => {
  const error = certbotFailure({ code: 1, stdout: 'Private: -----BEGIN PRIVATE KEY-----\nprivate-data\n-----END PRIVATE KEY-----\nTOKEN=hook-secret\nhttps://user:pass@example.com\nAuthorization: Bearer bearer-secret\n' + 'prefix '.repeat(2000), stderr: '\x1b[31mDetail: bad response with server-secret\x1b[0m' }, { secrets: ['server-secret'], renewal: true })
  expect(error).toContain('renewal test failed')
  expect(error).toContain('Detail: bad response with [redacted]')
  expect(error).not.toMatch(/private-data|hook-secret|user:pass|bearer-secret|server-secret|\x1b/)
  expect(error.length).toBeLessThan(9000)
  expect(certbotFailure({ error: 'SSH sudo timeout' })).toContain('SSH sudo timeout')
  expect(certbotFailure({ error: 'SSH command timeout' })).not.toContain('public TCP port 80')
  expect(certbotFailure({ code: 1 })).toContain('returned no output')
})
