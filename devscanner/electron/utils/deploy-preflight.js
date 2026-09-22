const yaml = require('js-yaml')
const crypto = require('crypto')
const { isIP } = require('net')
const { shellQuote: q } = require('./deploy-setup')

// Inspect only socket/container metadata: never return container env or secrets.
const PORT_PROBE = `# devscanner-port-probe
command -v ss >/dev/null || { echo 'Port inspection requires ss (iproute2)' >&2; exit 1; }
ss -H -lntup
printf '\\nDEVSCANNER_CONTAINERS\\n'
if command -v docker >/dev/null; then
  ids=$(docker ps -aq)
  if [ -n "$ids" ]; then
    docker inspect --format '{{json .Name}} {{json .State.Running}} {{json .NetworkSettings.Ports}} {{json (index .Config.Labels "com.docker.compose.project")}} {{json (index .Config.Labels "com.docker.compose.project.working_dir")}} {{json (index .Config.Labels "com.docker.compose.project.config_files")}}' $ids
  fi
fi
printf 'DEVSCANNER_PORTS_END\\n'`

function portNumber(value) {
  if (!/^\d+$/.test(String(value)) || +value < 1 || +value > 65535) throw new Error('Host port must be a number from 1 to 65535')
  return +value
}
function expand(value, env) {
  return String(value).replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?:(:-|-|:\?|\?)([^}]*))?\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (_, key, operator, fallback, plain) => {
    const found = env[key || plain]
    if (found !== undefined && (found !== '' || !operator?.startsWith(':'))) return found
    if (operator === ':-' || operator === '-') return fallback
    throw new Error('Set the port variable ' + (key || plain) + ' before checking the server')
  })
}
function parsePort(value, env) {
  if (value && typeof value === 'object') {
    if (value.published === undefined || String(value.published) === '0') return null
    return { address: expand(value.host_ip || '0.0.0.0', env), port: portNumber(expand(value.published, env)), target: portNumber(expand(value.target, env)), protocol: value.protocol || 'tcp' }
  }
  const text = expand(value, env)
  const match = text.match(/^(?:(\[[^\]]+\]|[^:]+):)?(\d+):(\d+)(?:\/(tcp|udp|sctp))?$/)
  if (match) {
    if (+match[2] === 0) return null
    return { address: (match[1] || '0.0.0.0').replace(/^\[|\]$/g, ''), port: portNumber(match[2]), target: portNumber(match[3]), protocol: match[4] || 'tcp' }
  }
  if (/^\d+(?:\/(tcp|udp|sctp))?$/.test(text)) return null // Docker chooses the host port.
  throw new Error('Unsupported port mapping: use a single numeric published port (ranges and unresolved templates cannot be checked)')
}
const normalizeAddress = address => address.replace(/^\[|\]$/g, '').replace(/^::ffff:/, '')
function overlaps(a, b) {
  if (a.port !== b.port || a.protocol !== b.protocol) return false
  const left = normalizeAddress(a.address), right = normalizeAddress(b.address)
  // IPv6 wildcard may also accept IPv4; conservatively reserve both families.
  return left === right || ['*', '::'].includes(left) || ['*', '::'].includes(right) ||
    (left === '0.0.0.0' && !right.includes(':')) || (right === '0.0.0.0' && !left.includes(':'))
}
function parseProbe(output, base, projectName) {
  const parts = output.split('\nDEVSCANNER_CONTAINERS\n')
  if (parts.length !== 2 || !parts[1].endsWith('DEVSCANNER_PORTS_END\n')) throw new Error('Port inspection did not complete; verify sudo access, ss (iproute2) and the Docker daemon')
  const sockets = parts[0].trim().split('\n').filter(Boolean).map(line => {
    const columns = line.trim().split(/\s+/)
    const endpoint = columns[4]?.match(/^(.*):(\d+)$/)
    if (!endpoint || !['tcp', 'udp', 'sctp'].includes(columns[0])) throw new Error('Could not parse server listening sockets')
    return { address: normalizeAddress(endpoint[1]), port: +endpoint[2], protocol: columns[0], owner: columns.slice(6).join(' ') || 'server process' }
  })
  const bindings = [], issues = []
  for (const line of parts[1].replace(/DEVSCANNER_PORTS_END\n$/, '').trim().split('\n').filter(Boolean)) {
    // Each inspect field is JSON; quoted strings may contain spaces.
    const fields = line.match(/"(?:[^"\\]|\\.)*"|\{.*\}|true|false|null/g)
    if (fields?.length !== 6) throw new Error('Could not parse Docker port metadata')
    const [name, running, ports, project, workingDir, configFiles] = fields.map(field => JSON.parse(field))
    const own = (configFiles || '').split(',').includes(base + '/stack/stack.yml') || workingDir === base + '/stack'
    if (project && project === projectName && !own) issues.push('Docker project name "' + project + '" is already used by ' + name + ' outside ' + base + '. Choose a different STACK_NAME / Compose project name before deploying.')
    if (!running) continue
    for (const [target, published] of Object.entries(ports || {})) {
      for (const binding of published || []) bindings.push({ address: binding.HostIp || '0.0.0.0', port: +binding.HostPort, protocol: target.split('/')[1], owner: 'Docker ' + name.replace(/^\//, ''), own })
    }
  }
  // Docker's NAT bindings can be absent from ss; docker-proxy may duplicate them.
  const occupied = sockets.filter(socket => !(/docker-proxy/.test(socket.owner) && bindings.some(binding => overlaps(binding, socket))))
  occupied.push(...bindings.filter(binding => !binding.own))
  return { occupied, issues: [...new Set(issues)] }
}

function planPorts({ compose, nginx = '', env = {}, overrides = {}, occupied = [], editable = true }) {
  const ports = [], issues = []
  for (const [service, config] of Object.entries(compose?.services || {})) {
    if (config.network_mode === 'host') issues.push(service + ' uses host networking: declare bridge-network published ports to enable conflict checks.')
    for (const [index, mapping] of (config.ports || []).entries()) {
      try {
        const parsed = parsePort(mapping, env)
        if (!parsed) continue
        if (!isIP(parsed.address)) throw new Error('Use a numeric host bind address for port checks')
        if (!['tcp', 'udp'].includes(parsed.protocol)) throw new Error('Only TCP and UDP port checks are supported')
        const id = service + ':' + index
        ports.push({ ...parsed, id, service, index, kind: 'container', originalPort: parsed.port, port: overrides[id] !== undefined ? portNumber(overrides[id]) : parsed.port, editable })
      } catch (err) { issues.push(service + ': ' + err.message) }
    }
  }
  for (const match of nginx.replace(/#.*$/gm, '').matchAll(/\blisten\s+([^;]+);/g)) {
    const args = match[1].trim().split(/\s+/), endpoint = args[0]
    if (endpoint.startsWith('unix:')) continue
    const parsed = endpoint.match(/^(?:(\[[^\]]+\]|[^:]+):)?(\d+)$/)
    if (!parsed) { issues.push('Cannot check nginx listen directive: ' + endpoint); continue }
    const address = (parsed[1] || '0.0.0.0').replace(/^\[|\]$/g, ''), port = portNumber(parsed[2]), protocol = args.includes('quic') ? 'udp' : 'tcp'
    if (!isIP(address) && address !== '*') { issues.push('Use a numeric address in the nginx listen directive: ' + endpoint); continue }
    if (ports.some(p => p.kind === 'nginx' && p.port === port && p.address === address && p.protocol === protocol)) continue
    ports.push({ id: 'nginx:' + address + ':' + port + ':' + protocol, service: 'nginx', address, port, originalPort: port, protocol, kind: 'nginx', editable: false })
  }
  const reserved = [...occupied, ...ports]
  for (const entry of ports) {
    const conflicts = occupied.filter(other => overlaps(entry, other) && !(entry.kind === 'nginx' && /\("nginx"/.test(other.owner)))
    const planned = ports.filter(other => other !== entry && overlaps(entry, other) && !(entry.kind === 'nginx' && other.kind === 'nginx'))
    entry.conflicts = [...new Set([...conflicts.map(c => c.owner), ...planned.map(c => 'planned ' + c.service)])]
    if (entry.conflicts.length && entry.editable) {
      for (let offset = 0; offset < 64512; offset++) {
        const candidate = 1024 + ((Math.max(entry.port + 1, 1024) - 1024 + offset) % 64512)
        const replacement = { ...entry, port: candidate }
        if (reserved.some(other => overlaps(replacement, other))) continue
        entry.suggestedPort = candidate
        reserved.push(replacement)
        break
      }
    }
  }
  const known = new Set(ports.filter(p => p.editable).map(p => p.id))
  if (Object.keys(overrides).some(id => !known.has(id))) issues.push('Port choices no longer match this deployment. Check the server again with the current Compose file.')
  return { ports, issues, blocked: issues.length > 0 || ports.some(p => p.conflicts.length) }
}

function rewriteHostEndpoints(text, ports, urlsOnly = false) {
  const changed = ports.filter(p => p.kind === 'container' && p.port !== p.originalPort && p.protocol === 'tcp')
  // Match only host-side upstream endpoints / HTTP URLs, not internal service URLs.
  const pattern = urlsOnly ? /(https?:\/\/)(localhost|127\.0\.0\.1|\[::1\]|[\d.]+):(\d+)\b/g : /((?:\bserver\s+)|(?:https?:\/\/))(localhost|127\.0\.0\.1|\[::1\]|[\d.]+):(\d+)\b/g
  return text.replace(pattern, (whole, prefix, host, port) => {
    const endpoint = { address: host === 'localhost' ? '127.0.0.1' : host, port: +port, protocol: 'tcp' }
    const matches = changed.filter(p => overlaps({ ...p, port: p.originalPort }, endpoint))
    if (!matches.length) return whole
    if (new Set(matches.map(p => p.port)).size > 1) throw new Error('Ambiguous nginx/health-check upstream for host port ' + port + '; use distinct bind addresses in the project config')
    return prefix + host + ':' + matches[0].port
  })
}
function applyPorts(compose, report) {
  for (const entry of report.ports.filter(p => p.kind === 'container' && p.port !== p.originalPort)) {
    const service = { ...compose.services[entry.service] }
    compose.services[entry.service] = service
    // Clone to avoid mutating YAML aliases shared by multiple services.
    service.ports = [...service.ports]
    const old = service.ports[entry.index]
    service.ports[entry.index] = typeof old === 'object' ? { ...old, published: String(entry.port) } :
      (entry.address.includes(':') ? '[' + entry.address + ']' : entry.address) + ':' + entry.port + ':' + entry.target + '/' + entry.protocol
  }
  return yaml.dump(compose, { lineWidth: -1, noRefs: true })
}

async function checkTLS(sudo, certPaths, { sslCert, sslKey }) {
  const issues = []
  if (!!sslCert !== !!sslKey) return ['Provide both TLS certificate and private key in Advanced → TLS.']
  if (sslCert) {
    try {
      if (!new crypto.X509Certificate(sslCert).checkPrivateKey(crypto.createPrivateKey(sslKey))) throw new Error('mismatch')
    } catch { return ['TLS certificate and private key must be valid PEM files and match. Correct them in Advanced → TLS.'] }
  }
  for (const cert of certPaths.filter(c => !(c.key ? sslKey : sslCert))) {
    let status
    try {
      status = (await sudo('# devscanner-tls-check\nif [ ! -e ' + q(cert.path) + ' ]; then printf missing; elif [ ! -r ' + q(cert.path) + ' ]; then printf unreadable; elif [ ! -s ' + q(cert.path) + ' ]; then printf empty; else printf ok; fi')).trim()
    } catch { throw new Error('Could not check TLS file ' + cert.path + '. Verify SSH sudo permissions, then retry.') }
    if (status !== 'ok') issues.push('TLS ' + (cert.key ? 'private key' : 'certificate') + ' ' + cert.path + ': ' + ({ missing: 'file is missing', unreadable: 'file is not readable', empty: 'file is empty' }[status] || 'file check did not complete') + '. Supply the certificate/key pair in Advanced → TLS, or correct the paths in the nginx config.')
  }
  return issues
}

module.exports = { PORT_PROBE, parsePort, parseProbe, overlaps, planPorts, applyPorts, rewriteHostEndpoints, checkTLS }
