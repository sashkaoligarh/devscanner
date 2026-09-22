const { shellQuote: q, isSensitive } = require('./deploy-setup')

function envSecrets(values) {
  return Object.entries(values || {}).filter(([key]) => isSensitive(key)).flatMap(([key, value]) =>
    key === 'APP_KEYS' && typeof value === 'string' ? [value, ...value.split(',').map(part => part.trim())] : [value])
}

function redactDeployOutput(text, secrets = []) {
  let output = String(text || '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g, '[private key removed]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)/g, '[token removed]')
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/g, '$1[credentials removed]@')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+/gi, '$1[redacted]')
    .replace(/((?:[\w.-]*(?:password|passwd|secret|token|api[_-]?key|authorization)[\w.-]*)["']?\s*[=:]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;]+)/gi, '$1[redacted]')
  for (const secret of [...new Set(secrets.filter(v => typeof v === 'string' && v.length >= 4))].sort((a, b) => b.length - a.length)) output = output.split(secret).join('[redacted]')
  return output
}

function firstDeployCommand(base) {
  const log = q(base + '/run/first-deploy.log')
  return 'umask 077\ntouch ' + log + '\nchmod 600 ' + log + '\n' +
    'if ' + q(base + '/bin/devscanner-deploy') + ' > ' + log + ' 2>&1; then\n' +
    '  tail -n 120 ' + log + '\nelse\n  deploy_status=$?\n  tail -n 120 ' + log + ' || true\n  exit "$deploy_status"\nfi'
}

function deploymentDiagnosticsCommand(base, env = {}) {
  const urls = [...new Set(Object.entries(env).filter(([key]) => /(?:^|_)HEALTHCHECK_URL$/.test(key)).map(([, value]) => value))].filter(value => {
    try {
      const url = new URL(value)
      return ['http:', 'https:'].includes(url.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && !url.username && !url.password
    } catch { return false }
  }).slice(0, 3)
  // Probe the configured readiness endpoint as well as Docker health: they may check different conditions.
  const requests = urls.map(url => 'printf "Health endpoint: %s\\n" ' + q(url) + '\n' +
    'curl --noproxy "*" -sS --connect-timeout 2 --max-time 5 --max-filesize 4096 -w "\\nHTTP %{http_code}\\n" ' + q(url) + ' 2>&1 | head -c 4608\nprintf "\\n"')
  return [...requests, 'if command -v docker >/dev/null; then\n' +
    '  for container in $(timeout 3s docker ps -aq --filter ' + q('label=com.docker.compose.project.config_files=' + base + '/stack/stack.yml') + ' | head -n 4); do\n' +
    '    timeout 3s docker inspect --format ' + q('Container {{.Name}}: status={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}}\n{{if .State.Health}}{{range .State.Health.Log}}Health exit={{.ExitCode}} {{.Output}}{{end}}{{end}}') + ' "$container" 2>&1 || true\n' +
    '    timeout 3s docker logs --tail 20 "$container" 2>&1 | head -c 4000\n' +
    '  done\nfi\ntrue'].join('\n')
}

function deploymentFailure(result, { secrets = [], logPath, ghcr = false } = {}) {
  const output = redactDeployOutput([result.stdout, result.stderr, result.error].filter(Boolean).join('\n'), secrets).trim()
  const hints = []
  if (/denied|unauthorized|authentication required|bad credentials|\b40[13]\b/i.test(output)) hints.push(ghcr
    ? 'Check GHCR_USERNAME and GHCR_TOKEN in Environment. GHCR requires a personal access token (classic) with read:packages and access to the package; enable organization SSO if required.'
    : 'Check the image name and registry credentials for the root account running this deployment.')
  if (/manifest/i.test(output) && /unknown|not found|404/i.test(output)) hints.push('The requested image tag or digest is unavailable. Publish the images or select an existing release tag.')
  if (/no matching manifest/i.test(output)) hints.push('The image does not include this server architecture. Publish a compatible image.')
  if (/healthcheck|unhealthy|dependency failed to start/i.test(output)) hints.push('Inspect the failing container’s logs and health status before retrying.')
  if (/port is already allocated|address already in use/i.test(output)) hints.push('A host port was claimed after validation. Run Check server again and choose a free port.')
  if (/example value|required variable|config file not found/i.test(output)) hints.push('Complete Environment values and replace template placeholders. Generate internal secrets with Generate empty app keys; supply registry credentials yourself.')
  if (/no space left on device/i.test(output)) hints.push('The server has insufficient disk space for this deployment.')
  return ['First deployment failed' + (Number.isInteger(result.code) ? ' (exit ' + result.code + ')' : '') + '.', ...hints,
    output ? 'Deployment output:\n' + output.slice(-8000) : 'The deployment command returned no output.',
    ...(logPath ? ['Server log: ' + logPath] : [])].join('\n\n')
}

module.exports = { envSecrets, redactDeployOutput, firstDeployCommand, deploymentDiagnosticsCommand, deploymentFailure }
