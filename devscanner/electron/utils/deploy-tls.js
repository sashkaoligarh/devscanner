const crypto = require('crypto')
const { isIP } = require('net')
const { redactDeployOutput } = require('./deploy-output')
const { shellQuote: q } = require('./deploy-setup')

const validDomain = value => typeof value === 'string' && value.length <= 253 && /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(value)

function certbotFailure(result, { renewal = false, secrets = [] } = {}) {
  const output = redactDeployOutput([result.stdout, result.stderr, result.error].filter(Boolean).join('\n'), secrets)
  const hints = []
  if (/NXDOMAIN|SERVFAIL|DNS problem|no valid (?:A|AAAA) records/i.test(output)) hints.push('Check public DNS for each domain listed below; its A/AAAA records must lead to this server.')
  if (/SSH (?:command|sudo) timeout/i.test(output)) hints.push('DevScanner stopped waiting for the remote command. This does not by itself indicate a DNS or firewall problem; check the Certbot log for its actual result.')
  else if (/timeout|timed out|connection refused|could not connect|network is unreachable/i.test(output)) hints.push('Check the address and URL in the error. HTTP-01 validation needs public TCP port 80 forwarded to this nginx server; access over VPN alone is insufficient. The server also needs outbound HTTPS to the ACME service.')
  if (/unauthorized|invalid response|404|403/i.test(output)) hints.push('The validation URL may be reaching another site or proxy. Route /.well-known/acme-challenge/ to this deployment’s HTTP webroot and check every published A/AAAA address.')
  if (/rateLimited|too many (?:certificates|requests|failed)|rate limit/i.test(output)) hints.push('Let’s Encrypt rate limit reached. Follow the retry time in the error; repeated deployment attempts will not clear the limit.')
  if (/\bCAA\b|caa error/i.test(output)) hints.push('Check that the domain’s CAA records allow Let’s Encrypt (letsencrypt.org).')
  if (/invalid.*email|email.*invalid|unable to register an account/i.test(output)) hints.push('Check the Let’s Encrypt account email and the account-registration error below.')
  if (/another instance|already running|lock.*(?:held|acquir)/i.test(output)) hints.push('Another Certbot process may be running. Wait for it to finish before retrying.')
  if (/permission denied|access denied|read-only file system/i.test(output)) hints.push('Check Certbot permissions and writable storage under /etc/letsencrypt, /var/lib/letsencrypt and /var/log/letsencrypt.')
  const title = renewal ? 'Certbot renewal test failed' : 'Certbot could not issue the certificate'
  return [title + (Number.isInteger(result.code) ? ' (exit ' + result.code + ')' : '') + '.', ...hints,
    output.trim() ? 'Certbot output:\n' + output.trim().slice(-8000) : 'Certbot returned no output.',
    'Full server log: /var/log/letsencrypt/letsencrypt.log'].join('\n\n')
}

// Preserve the full site file; inspect braces outside comments and quoted strings.
function syntaxMask(text) {
  let quote = '', comment = false, escaped = false
  return text.split('').map(char => {
    if (comment) { if (char === '\n') comment = false; return char === '\n' ? char : ' ' }
    if (escaped) { escaped = false; return ' ' }
    if (char === '\\') { escaped = true; return ' ' }
    if (quote) { if (char === quote) quote = ''; return ' ' }
    if (char === '"' || char === "'") { quote = char; return ' ' }
    if (char === '#') { comment = true; return ' ' }
    return char
  }).join('')
}
function serverBlocks(text) {
  const mask = syntaxMask(text), blocks = []
  let depth = 0, start = -1
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === '{') {
      if (!depth) {
        const match = mask.slice(0, i).match(/\bserver\s*$/)
        if (match) start = match.index
      }
      depth++
    } else if (mask[i] === '}') {
      depth--
      if (depth < 0) throw new Error('Unbalanced nginx configuration')
      if (!depth && start >= 0) { blocks.push({ start, end: i + 1, content: text.slice(start, i + 1) }); start = -1 }
    }
  }
  if (depth) throw new Error('Unbalanced nginx configuration')
  if (!blocks.length) throw new Error('Use a standalone nginx site config with server blocks')
  return blocks
}
function namesOf(content) {
  return [...content.replace(/#.*$/gm, '').matchAll(/\bserver_name\s+([^;]+);/g)].flatMap(m => m[1].trim().split(/\s+/))
}

function directives(text) {
  const mask = syntaxMask(text), found = []
  let start = 0
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === ';') {
      const match = mask.slice(start, i).match(/^\s*([a-zA-Z_]\w*)\b/)
      if (match) {
        const offset = start + match[0].length - match[1].length
        found.push({ name: match[1], start: offset, end: i + 1, args: text.slice(offset + match[1].length, i).trim() })
      }
    }
    if (';{}'.includes(mask[i])) start = i + 1
  }
  return found
}

function httpSiteUrls(value, domains, host) {
  const names = new Set(domains.map(d => d.toLowerCase()))
  return value.replace(/https:\/\/(\[[^\]]+\]|[a-zA-Z0-9_.-]+)(?::(\d+))?(?=[/\s"',;\])}]|$)/g, (url, name, port) => {
    if (!names.has(name.toLowerCase()) || (port && port !== '443')) return url
    return 'http://' + (host || name)
  })
}

const tlsDirective = d => /^ssl(?:_|$)/.test(d.name) || d.name === 'http2' || d.name === 'quic_retry'
  || (d.name === 'include' && /(?:ssl|tls)[^/]*\.conf["']?$/.test(d.args))
  || (d.name === 'add_header' && /^(?:["']?Strict-Transport-Security["']?|["']?Alt-Svc["']?)\s/i.test(d.args))

function prepareHttp(content, accessHost) {
  if (accessHost && !isIP(accessHost) && !/^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(accessHost)) throw new Error('Enter a hostname or server IP for HTTP access')
  const blocks = serverBlocks(content).map(block => ({ ...block, directives: directives(block.content), names: namesOf(block.content) }))
  const isTls = block => block.directives.some(d => (d.name === 'listen' && /\b(?:ssl|quic)\b/.test(d.args)) || (d.name === 'ssl' && d.args === 'on'))
  const tlsNames = new Set(blocks.filter(isTls).flatMap(b => b.names))
  const removed = new Set()
  for (const block of blocks.filter(b => !isTls(b) && b.names.some(name => tlsNames.has(name)))) {
    // Only discard a redirect stub; a separate HTTP application needs an explicit merged config.
    const redirect = block.directives.some(d => ['return', 'rewrite'].includes(d.name) && /https:\/\//.test(d.args))
    const servesContent = block.directives.some(d => /^(?:proxy_pass|fastcgi_pass|uwsgi_pass|scgi_pass|grpc_pass|root|alias|try_files)$/.test(d.name))
    if (!redirect || servesContent || block.names.some(name => !tlsNames.has(name))) throw new Error('HTTP and HTTPS define separate routes or domains. Provide a combined HTTP nginx config in Advanced before choosing no certificate.')
    removed.add(block)
  }
  const apps = blocks.filter(b => !removed.has(b))
  const domains = [...new Set(apps.flatMap(b => b.names))]
  // A single app can be opened directly through its VPN/LAN address while public NAT is pending.
  const host = apps.length === 1 && accessHost ? (isIP(accessHost) === 6 ? '[' + accessHost + ']' : accessHost) : undefined
  let result = content
  for (const block of [...blocks].reverse()) {
    let updated = block.content
    if (removed.has(block)) updated = ''
    else {
      const changes = [], listeners = new Set()
      for (const d of block.directives) {
        let replacement
        if (d.name === 'listen') {
          const parts = d.args.split(/\s+/).filter(p => !['ssl', 'http2', 'quic'].includes(p))
          parts[0] = parts[0].replace(/(^|:)443$/, '$180')
          replacement = listeners.has(parts[0]) ? '' : 'listen ' + parts.join(' ') + ';'
          listeners.add(parts[0])
        }
        if (d.name === 'server_name' && host && !block.names.includes(host)) replacement = 'server_name ' + d.args + ' ' + host + ';'
        if (['return', 'rewrite'].includes(d.name) && /https:\/\/(?:\$host|\$http_host|\$server_name)(?::443)?\$(?:request_uri|uri)/.test(d.args)) replacement = ''
        const redirectHost = ['return', 'rewrite'].includes(d.name) && d.args.match(/https:\/\/([^/:\s]+)(?::443)?\$(?:request_uri|uri)(?:["']?\s|["']?$)/)
        if (redirectHost && block.names.includes(redirectHost[1])) replacement = ''
        if (d.name === 'proxy_set_header' && /^X-Forwarded-Proto\s+["']?https["']?$/i.test(d.args)) replacement = 'proxy_set_header X-Forwarded-Proto $scheme;'
        if (replacement !== undefined) changes.push({ ...d, replacement })
      }
      for (const change of changes.reverse()) updated = updated.slice(0, change.start) + change.replacement + updated.slice(change.end)
    }
    result = result.slice(0, block.start) + updated + result.slice(block.end)
  }
  // Site files can also define inherited TLS settings outside individual server blocks.
  for (const d of directives(result).filter(tlsDirective).reverse()) result = result.slice(0, d.start) + result.slice(d.end)
  return { content: httpSiteUrls(result, domains, host), domains, host }
}
function challengeBlock(webroot) {
  return '\n    location ^~ /.well-known/acme-challenge/ {\n        root ' + webroot + ';\n        default_type text/plain;\n        try_files $uri =404;\n    }\n'
}
function httpSite(domains, webroot, redirect) {
  return 'server {\n    listen 80;\n    listen [::]:80;\n    server_name ' + domains.join(' ') + ';\n' + challengeBlock(webroot) +
    '    location / { ' + (redirect ? 'return 301 https://$host$request_uri;' : 'return 404;') + ' }\n}\n'
}
function prepareCertbot(content, { domain, certbotEmail, certbotAgree }, base, slug) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(certbotEmail || '')) throw new Error('Enter an email for the Let’s Encrypt account')
  if (!certbotAgree) throw new Error('Accept the Let’s Encrypt terms to issue a certificate')
  const blocks = serverBlocks(content)
  const domains = [...new Set(blocks.flatMap(b => namesOf(b.content)))].map(d => d.toLowerCase())
  if (!domains.length || domains.some(d => !validDomain(d) || d === 'your-domain.com')) throw new Error('Certbot needs public DNS names in every server_name; wildcards and private names require a manually supplied certificate')
  if (domain && (!validDomain(domain) || !domains.includes(domain.toLowerCase()))) throw new Error('The public domain must match server_name in the nginx config')
  if (domains.length > 20) throw new Error('Use at most 20 domain names per deployment certificate')
  const certName = 'devscanner-' + slug.slice(0, 40) + '-' + crypto.createHash('sha256').update(base + ':' + [...domains].sort().join(',')).digest('hex').slice(0, 12)
  const directory = '/etc/letsencrypt/live/' + certName
  const webroot = '/var/lib/devscanner-acme/' + certName
  const certificate = directory + '/fullchain.pem', key = directory + '/privkey.pem'
  const hasHttps = blocks.some(b => /\blisten\s+[^;]*\bssl\b/.test(b.content.replace(/#.*$/gm, '')))
  const httpsNames = new Set()
  let finalConfig = content
  for (const block of [...blocks].reverse()) {
    let updated = block.content
    const ssl = /\blisten\s+[^;]*\bssl\b/.test(updated.replace(/#.*$/gm, ''))
    if (ssl || !hasHttps) {
      if (!ssl) {
        if (!/\blisten\s+(?:80|\[::\]:80)\s*;/.test(updated)) throw new Error('Certbot conversion requires standard HTTP port 80 or an existing HTTPS server block')
        updated = updated.replace(/\blisten\s+80\s*;/g, 'listen 443 ssl;').replace(/\blisten\s+\[::\]:80\s*;/g, 'listen [::]:443 ssl;')
      }
      for (const name of namesOf(updated)) httpsNames.add(name.toLowerCase())
      updated = updated.replace(/\bssl_certificate\s+[^;]+;/g, 'ssl_certificate ' + certificate + ';')
        .replace(/\bssl_certificate_key\s+[^;]+;/g, 'ssl_certificate_key ' + key + ';')
        .replace(/\bssl_trusted_certificate\s+[^;]+;/g, 'ssl_trusted_certificate ' + certificate + ';')
      if (!/\bssl_certificate\s/.test(updated.replace(/#.*$/gm, ''))) updated = updated.replace(/}\s*$/, '    ssl_certificate ' + certificate + ';\n    ssl_certificate_key ' + key + ';\n}')
    } else {
      const challengeCount = (updated.match(/\.well-known\/acme-challenge/g) || []).length
      const managedChallenge = challengeCount === 1 && updated.includes(challengeBlock(webroot).trim())
      if (challengeCount && !managedChallenge) throw new Error('Remove the custom ACME challenge location from the project config; DevScanner installs its managed webroot location')
      const mask = syntaxMask(updated)
      const returns = [...updated.matchAll(/\breturn\s+[^;]+;/g)].filter(m => {
        let depth = 0
        for (const char of mask.slice(0, m.index)) { if (char === '{') depth++; if (char === '}') depth-- }
        return depth === 1
      })
      if (returns.length && /\blocation\s+(?:=\s+)?\/\s*\{/.test(updated)) throw new Error('Move the HTTP server-level return into location / before enabling Certbot')
      for (const match of returns.reverse()) updated = updated.slice(0, match.index) + 'location / { ' + match[0] + ' }' + updated.slice(match.index + match[0].length)
      if (!managedChallenge) updated = updated.replace(/}\s*$/, challengeBlock(webroot) + '}')
    }
    finalConfig = finalConfig.slice(0, block.start) + updated + finalConfig.slice(block.end)
  }
  if (domains.some(d => !httpsNames.has(d))) throw new Error('Every Certbot domain must have an HTTPS server block in the project config')
  if (!hasHttps || !blocks.some(b => !/\blisten\s+[^;]*\bssl\b/.test(b.content))) finalConfig += '\n' + httpSite(domains, webroot, true)
  // All domains must have a port-80 challenge route, including HTTPS-only aliases.
  const httpNames = new Set(serverBlocks(finalConfig).filter(b => /\blisten\s+(?:80|\[::\]:80)\s*;/.test(b.content)).flatMap(b => namesOf(b.content)))
  const missingHttp = domains.filter(d => !httpNames.has(d))
  if (missingHttp.length) finalConfig += '\n' + httpSite(missingHttp, webroot, true)
  const hook = 'nginx -t && systemctl reload nginx'
  const args = '--non-interactive --agree-tos --email ' + q(certbotEmail) + ' --cert-name ' + q(certName) + ' --webroot -w ' + q(webroot) + domains.map(d => ' -d ' + q(d)).join('')
  const unit = certName
  return {
    mode: 'certbot', domains, certName, webroot, certificate, key, finalConfig,
    bootstrapConfig: httpSite(domains, webroot, false),
    issueCommand: 'certbot certonly ' + args + ' --keep-until-expiring --deploy-hook ' + q(hook),
    testCommand: 'timeout --kill-after=10s 210s certbot renew --cert-name ' + q(certName) + ' --dry-run --non-interactive --no-random-sleep-on-renew',
    service: { name: 'certbot-service', destination: '/etc/systemd/system/' + unit + '.service', mode: '644', content: '[Unit]\nDescription=Renew deployment TLS certificate\nAfter=network-online.target nginx.service\nWants=network-online.target\n\n[Service]\nType=oneshot\nEnvironment="PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin"\nExecStart=/usr/bin/env certbot renew --cert-name ' + certName + ' --non-interactive --quiet --deploy-hook "' + hook + '"\n' },
    timer: { name: 'certbot-timer', destination: '/etc/systemd/system/' + unit + '.timer', mode: '644', content: '[Unit]\nDescription=Automatic deployment TLS renewal\n\n[Timer]\nOnCalendar=*-*-* 00,12:00:00\nRandomizedDelaySec=3600\nPersistent=true\n\n[Install]\nWantedBy=timers.target\n' },
    enableCommand: 'systemctl daemon-reload\nsystemctl enable --now ' + q(unit + '.timer') + '\nsystemctl is-active --quiet ' + q(unit + '.timer')
  }
}

function prepareManual(content, slug) {
  if (/\bssl_certificate\s/.test(content.replace(/#.*$/gm, ''))) return content
  const blocks = serverBlocks(content), domains = [...new Set(blocks.flatMap(b => namesOf(b.content)))]
  if (!domains.length || domains.some(d => !validDomain(d))) throw new Error('Set nginx server_name before installing a manual certificate')
  let result = content
  for (const block of [...blocks].reverse()) {
    if (!/\blisten\s+(?:80|\[::\]:80)\s*;/.test(block.content)) throw new Error('Manual TLS setup requires HTTP port 80 or explicit ssl_certificate paths in the nginx config')
    const updated = block.content.replace(/\blisten\s+80\s*;/g, 'listen 443 ssl;').replace(/\blisten\s+\[::\]:80\s*;/g, 'listen [::]:443 ssl;')
      .replace(/}\s*$/, '    ssl_certificate /etc/nginx/certs/devscanner-' + slug + '.crt;\n    ssl_certificate_key /etc/nginx/certs/devscanner-' + slug + '.key;\n}')
    result = result.slice(0, block.start) + updated + result.slice(block.end)
  }
  return result + '\nserver { listen 80; listen [::]:80; server_name ' + domains.join(' ') + '; return 301 https://$host$request_uri; }\n'
}

module.exports = { prepareCertbot, prepareManual, prepareHttp, httpSiteUrls, serverBlocks, validDomain, certbotFailure }
