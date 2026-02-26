/**
 * Parse a raw nginx config string into a structured object
 * Returns { serverName, listen, ssl, root, locations[] }
 */
function parseNginxConfig(raw) {
  const config = {
    serverName: '',
    listen: '80',
    ssl: false,
    root: '',
    locations: []
  }

  if (!raw || typeof raw !== 'string') return config

  // Extract server_name
  const snMatch = raw.match(/server_name\s+(.+?);/)
  if (snMatch) config.serverName = snMatch[1].trim()

  // Extract listen directive
  const listenMatch = raw.match(/listen\s+(.+?);/)
  if (listenMatch) {
    config.listen = listenMatch[1].trim()
    if (config.listen.includes('ssl') || config.listen.includes('443')) {
      config.ssl = true
    }
  }

  // Check for ssl_certificate
  if (raw.includes('ssl_certificate')) config.ssl = true

  // Extract root
  const rootMatch = raw.match(/^\s*root\s+(.+?);/m)
  if (rootMatch) config.root = rootMatch[1].trim()

  // Extract location blocks
  const locationRegex = /location\s+(\S+)\s*\{([^}]*)\}/g
  let match
  while ((match = locationRegex.exec(raw)) !== null) {
    const loc = { path: match[1], directives: {} }
    const block = match[2]

    const ppMatch = block.match(/proxy_pass\s+(.+?);/)
    if (ppMatch) loc.directives.proxy_pass = ppMatch[1].trim()

    const tryMatch = block.match(/try_files\s+(.+?);/)
    if (tryMatch) loc.directives.try_files = tryMatch[1].trim()

    const rootMatch = block.match(/root\s+(.+?);/)
    if (rootMatch) loc.directives.root = rootMatch[1].trim()

    const indexMatch = block.match(/index\s+(.+?);/)
    if (indexMatch) loc.directives.index = indexMatch[1].trim()

    config.locations.push(loc)
  }

  return config
}

/**
 * Generate nginx config text from structured object
 * When SSL is configured, generates two server blocks:
 *   1) port 80 → redirect to HTTPS
 *   2) port 443 ssl → actual site
 */
function generateNginxConfig(config) {
  const lines = []

  // If SSL is enabled with certs, add HTTP→HTTPS redirect block
  if (config.ssl && config.sslCertificate) {
    lines.push('server {')
    lines.push('    listen 80;')
    lines.push(`    server_name ${config.serverName || '_'};`)
    lines.push('    return 301 https://$host$request_uri;')
    lines.push('}')
    lines.push('')
  }

  lines.push('server {')
  lines.push(`    listen ${config.listen || '80'};`)
  if (config.ssl && !config.listen?.includes('443')) {
    lines.push('    listen 443 ssl;')
  }
  lines.push(`    server_name ${config.serverName || '_'};`)
  lines.push('')

  if (config.root) {
    lines.push(`    root ${config.root};`)
    lines.push('    index index.html index.htm;')
    lines.push('')
  }

  if (config.sslCertificate) {
    lines.push(`    ssl_certificate ${config.sslCertificate};`)
    lines.push(`    ssl_certificate_key ${config.sslCertificateKey};`)
    lines.push('')
  }

  for (const loc of (config.locations || [])) {
    lines.push(`    location ${loc.path} {`)
    if (loc.directives) {
      for (const [key, val] of Object.entries(loc.directives)) {
        lines.push(`        ${key} ${val};`)
      }
    }
    lines.push('    }')
    lines.push('')
  }

  lines.push('}')
  return lines.join('\n')
}

function staticSiteTemplate(domain, root) {
  return {
    serverName: domain || 'example.com',
    listen: '80',
    ssl: false,
    root: root || '/var/www/html',
    locations: [
      { path: '/', directives: { try_files: '$uri $uri/ /index.html' } }
    ]
  }
}

function reverseProxyTemplate(domain, backendUrl) {
  return {
    serverName: domain || 'example.com',
    listen: '80',
    ssl: false,
    root: '',
    locations: [
      {
        path: '/',
        directives: {
          proxy_pass: backendUrl || 'http://localhost:3000',
          'proxy_http_version': '1.1',
          'proxy_set_header Upgrade': '$http_upgrade',
          'proxy_set_header Connection': "'upgrade'",
          'proxy_set_header Host': '$host',
          'proxy_cache_bypass': '$http_upgrade'
        }
      }
    ]
  }
}

function staticPlusProxyTemplate(domain, root, backendPort, proxyPath) {
  const proxy = proxyPath || '/api'
  const proxyLocation = {
    path: proxy,
    directives: {
      proxy_pass: `http://localhost:${backendPort || 3000}`,
      'proxy_http_version': '1.1',
      'proxy_set_header Upgrade': '$http_upgrade',
      'proxy_set_header Connection': "'upgrade'",
      'proxy_set_header Host': '$host',
      'proxy_cache_bypass': '$http_upgrade'
    }
  }

  // When proxy path is "/" — Node.js handles everything, static files as fallback
  if (proxy === '/') {
    return {
      serverName: domain || 'example.com',
      listen: '80',
      ssl: false,
      root: root || '/var/www/html',
      locations: [proxyLocation]
    }
  }

  // Otherwise — static root + proxy at sub-path
  return {
    serverName: domain || 'example.com',
    listen: '80',
    ssl: false,
    root: root || '/var/www/html',
    locations: [
      proxyLocation,
      { path: '/', directives: { try_files: '$uri $uri/ /index.html' } }
    ]
  }
}

function redirectTemplate(domain, target) {
  return {
    serverName: domain || 'example.com',
    listen: '80',
    ssl: false,
    root: '',
    locations: [
      { path: '/', directives: { 'return': `301 ${target || 'https://$host$request_uri'}` } }
    ]
  }
}

module.exports = {
  parseNginxConfig,
  generateNginxConfig,
  staticSiteTemplate,
  reverseProxyTemplate,
  staticPlusProxyTemplate,
  redirectTemplate
}
