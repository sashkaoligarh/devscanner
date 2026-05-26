const fs = require('fs')
const { execFileSync } = require('child_process')
const { dialog, safeStorage } = require('electron')
const { getSSHClient, sshExec, sshExecSudo, getServerPassword, connectSSH } = require('../utils/ssh-pool')
const { getSFTPClient, uploadDirectory } = require('../utils/sftp-utils')
const { generateNginxConfig, staticSiteTemplate, staticPlusProxyTemplate } = require('../utils/nginx-utils')
const { ensureNginx, ensureNode, ensurePM2, pm2Start } = require('../utils/pm2-utils')
const { loadSettings, saveSettings } = require('../utils/settings-store')
const {
  detectDeploySetup,
  buildInventory,
  buildSecretBundle,
  generateVaultPassword,
  sanitizeLinuxUser
} = require('../utils/deploy-setup')

function sendProgress(ctx, serverId, progress) {
  const mainWindow = ctx.mainWindow()
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('upload-progress', { serverId, ...progress })
  }
}

function sendLog(ctx, serverId, message) {
  const mainWindow = ctx.mainWindow()
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('deploy-log', { serverId, message })
  }
}

function shellQuote(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'"
}

function sanitizeRemotePath(value, fallback) {
  const clean = String(value || '').trim().replace(/[`$\\]/g, '')
  if (!clean.startsWith('/') || clean.includes('..')) return fallback
  return clean.replace(/\/+$/g, '') || fallback
}

async function getClientForSetup(serverId) {
  const existing = getSSHClient(serverId)
  if (existing) return existing
  const settings = loadSettings()
  const server = (settings.remoteServers || []).find(s => s.id === serverId)
  if (!server) throw new Error('Server not found')
  return connectSSH(server)
}

async function ensureDeployUser(client, password, deployUser, sudoAccess) {
  const user = sanitizeLinuxUser(deployUser, 'deploy')
  const sudoersPath = `/etc/sudoers.d/devscanner-${user}`
  const commands = [
    `id -u ${user} >/dev/null 2>&1 || useradd -m -s /bin/bash ${user}`,
    `mkdir -p /home/${user}/.ssh`,
    `chown -R ${user}:${user} /home/${user}/.ssh`,
    `chmod 700 /home/${user}/.ssh`,
    `getent group docker >/dev/null 2>&1 && usermod -aG docker ${user} || true`
  ]
  if (sudoAccess) {
    commands.push(`printf ${shellQuote(`${user} ALL=(ALL) NOPASSWD:ALL\n`)} > ${sudoersPath}`)
    commands.push(`chmod 440 ${sudoersPath}`)
  }
  await sshExecSudo(client, commands.join(' && '), password, 30000)
  return user
}

async function createDeployKey(client, password, deployUser, projectSlug) {
  const comment = `devscanner-${projectSlug}-${Date.now()}`
  const command = [
    `tmp=$(mktemp -u /tmp/devscanner-${deployUser}-XXXXXX)`,
    `ssh-keygen -t ed25519 -N '' -C ${shellQuote(comment)} -f "$tmp" >/dev/null`,
    `cat "$tmp.pub" >> /home/${deployUser}/.ssh/authorized_keys`,
    `chown -R ${deployUser}:${deployUser} /home/${deployUser}/.ssh`,
    `chmod 700 /home/${deployUser}/.ssh`,
    `chmod 600 /home/${deployUser}/.ssh/authorized_keys`,
    `printf '__PRIVATE_KEY_START__\\n'`,
    `cat "$tmp"`,
    `printf '\\n__PRIVATE_KEY_END__\\n__PUBLIC_KEY_START__\\n'`,
    `cat "$tmp.pub"`,
    `printf '\\n__PUBLIC_KEY_END__\\n'`,
    `rm -f "$tmp" "$tmp.pub"`
  ].join(' && ')

  const result = await sshExecSudo(client, command, password, 30000)
  const output = result.stdout || ''
  const privateKey = output.match(/__PRIVATE_KEY_START__\n([\s\S]*?)\n__PRIVATE_KEY_END__/)?.[1]?.trim()
  const publicKey = output.match(/__PUBLIC_KEY_START__\n([\s\S]*?)\n__PUBLIC_KEY_END__/)?.[1]?.trim()
  if (!privateKey || !publicKey) throw new Error('Failed to generate deploy key')
  return { privateKey, publicKey }
}

function getKnownHosts(host, port) {
  try {
    return execFileSync('ssh-keyscan', ['-p', String(port || 22), String(host)], {
      encoding: 'utf-8',
      timeout: 7000,
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
  } catch {
    return `# Run from a machine that can reach the server:\n# ssh-keyscan -p ${port || 22} ${host}`
  }
}

async function installPrivateDeployAssets({ client, password, serverId, ctx, setup, remoteBase, deployUser, installCron }) {
  if (!setup.deployDir || !fs.existsSync(setup.deployDir)) {
    return { installed: false, logs: ['No deploy/ directory detected.'] }
  }

  const tmpDir = `/tmp/devscanner-deploy-${setup.slug}-${Date.now()}`
  const logs = []
  const log = (message) => {
    logs.push(message)
    sendLog(ctx, serverId, message)
  }

  log(`> Uploading deploy assets to ${tmpDir}...`)
  await sshExec(client, `rm -rf ${tmpDir} && mkdir -p ${tmpDir}`, 10000)
  const sftp = await getSFTPClient(client)
  await uploadDirectory(sftp, setup.deployDir, tmpDir, progress => sendProgress(ctx, serverId, progress))

  const script = setup.autodeployScript
  const remote = sanitizeRemotePath(remoteBase, setup.remoteBase)
  if (script) {
    log(`> Installing autodeploy layout to ${remote}...`)
    const commands = [
      `mkdir -p ${remote}/bin ${remote}/stack ${remote}/env ${remote}/run ${remote}/nginx /etc/nginx/certs`,
      `cp ${tmpDir}/${script} ${remote}/bin/${script}`,
      `[ -f ${tmpDir}/stack.yml ] && cp ${tmpDir}/stack.yml ${remote}/stack/stack.yml || true`,
      `[ -f ${tmpDir}/nginx.conf ] && cp ${tmpDir}/nginx.conf ${remote}/nginx/nginx.conf || true`,
      `[ -f ${tmpDir}/vars.yml ] && cp ${tmpDir}/vars.yml ${remote}/vars.yml || true`,
      `[ -f ${tmpDir}/server.env.example ] && [ ! -f ${remote}/env/server.env ] && cp ${tmpDir}/server.env.example ${remote}/env/server.env || true`,
      `chmod 700 ${remote}/bin/${script}`,
      `[ -f ${remote}/env/server.env ] && chmod 600 ${remote}/env/server.env || true`,
      `chown -R ${deployUser}:${deployUser} ${remote}`,
      `rm -rf ${tmpDir}`
    ]
    await sshExecSudo(client, commands.join(' && '), password, 30000)

    if (installCron) {
      log('> Installing cron entry...')
      const cronName = `${setup.slug}-autodeploy`
      const cronContent = `SHELL=/bin/bash\nPATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\n\n* * * * * root ${remote}/bin/${script} >> /var/log/${cronName}.log 2>&1\n`
      await sshExecSudo(client, [
        `touch /var/log/${cronName}.log`,
        `chmod 644 /var/log/${cronName}.log`,
        `printf ${shellQuote(cronContent)} > /etc/cron.d/${cronName}`,
        `chmod 644 /etc/cron.d/${cronName}`,
        `systemctl enable --now cron >/dev/null 2>&1 || true`
      ].join(' && '), password, 10000)
    }

    return { installed: true, logs, remoteDir: remote, cronInstalled: !!installCron }
  }

  log(`> Installing generic deploy directory to ${remote}/deploy...`)
  await sshExecSudo(client, [
    `mkdir -p ${remote}`,
    `rm -rf ${remote}/deploy`,
    `cp -a ${tmpDir} ${remote}/deploy`,
    `chown -R ${deployUser}:${deployUser} ${remote}`,
    `rm -rf ${tmpDir}`
  ].join(' && '), password, 30000)
  return { installed: true, logs, remoteDir: `${remote}/deploy`, cronInstalled: false }
}

function registerDeployHandlers(ipcMain, ctx) {
  ipcMain.handle('deploy-setup-preview', async (_, { projectPath }) => {
    try {
      if (!projectPath || !fs.existsSync(projectPath)) {
        return { success: false, error: 'Project folder not found' }
      }
      return { success: true, data: detectDeploySetup(projectPath) }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('deploy-setup-run', async (_, payload = {}) => {
    const { serverId, projectPath } = payload
    try {
      if (!serverId) return { success: false, error: 'Server is required' }
      if (!projectPath || !fs.existsSync(projectPath)) return { success: false, error: 'Project folder not found' }

      const settings = loadSettings()
      const server = (settings.remoteServers || []).find(s => s.id === serverId)
      if (!server) return { success: false, error: 'Server not found' }

      const setup = detectDeploySetup(projectPath)
      const mode = payload.mode || setup.mode
      const deployUser = sanitizeLinuxUser(payload.deployUser || setup.deployUser, 'deploy')
      const remoteBase = sanitizeRemotePath(payload.remoteBase || setup.remoteBase, setup.remoteBase)
      const sudoAccess = payload.sudoAccess !== false
      const installCron = !!payload.installCron

      sendLog(ctx, serverId, `> Preparing deploy setup for ${setup.projectName}...`)
      const client = await getClientForSetup(serverId)
      const password = getServerPassword(serverId)

      sendLog(ctx, serverId, `> Creating deploy user "${deployUser}"...`)
      await ensureDeployUser(client, password, deployUser, sudoAccess)

      sendLog(ctx, serverId, '> Generating deploy SSH key...')
      const keyPair = await createDeployKey(client, password, deployUser, setup.slug)
      const knownHosts = getKnownHosts(server.host, server.port || 22)
      const inventory = buildInventory({ host: server.host, port: server.port || 22, deployUser })
      const vaultPassword = generateVaultPassword()

      let assets = { installed: false, logs: [] }
      if (mode === 'private-vpn') {
        assets = await installPrivateDeployAssets({
          client,
          password,
          serverId,
          ctx,
          setup,
          remoteBase,
          deployUser,
          installCron
        })
      }

      const secrets = buildSecretBundle({
        detectedSecrets: setup.secrets,
        mode,
        privateKey: keyPair.privateKey,
        knownHosts,
        inventory,
        vaultPassword
      })

      const deploySetups = settings.deploySetups || []
      const profile = {
        id: `${setup.slug}-${serverId}`,
        projectPath,
        projectName: setup.projectName,
        serverId,
        mode,
        deployUser,
        remoteBase,
        secretNames: secrets.map(s => s.name),
        updatedAt: new Date().toISOString()
      }
      saveSettings({ deploySetups: [...deploySetups.filter(p => p.id !== profile.id), profile] })

      sendLog(ctx, serverId, '✓ Deploy setup ready')
      return {
        success: true,
        data: {
          profile,
          setup: { ...setup, mode },
          publicKey: keyPair.publicKey,
          secrets,
          variables: setup.variables.map(name => ({ name, value: '', description: 'GitHub Actions variable detected in workflow.' })),
          assets,
          nextSteps: [
            'Add the generated values to GitHub repository Secrets.',
            'Fill manual registry/application secrets with real values.',
            mode === 'private-vpn'
              ? `Review ${remoteBase}/env/server.env on the server before enabling/running autodeploy.`
              : 'Run the GitHub workflow after all secrets are configured.'
          ]
        }
      }
    } catch (err) {
      if (serverId) sendLog(ctx, serverId, `✗ Deploy setup failed: ${err.message}`)
      return { success: false, error: err.message }
    }
  })

  // Select a local folder to deploy
  ipcMain.handle('select-deploy-folder', async () => {
    const mainWindow = ctx.mainWindow()
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select folder to deploy'
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // Upload folder to remote server
  ipcMain.handle('ssh-upload-folder', async (_, { serverId, localPath, remotePath }) => {
    try {
      const client = getSSHClient(serverId)
      if (!client) return { success: false, error: 'Not connected' }

      const sftp = await getSFTPClient(client)

      const result = await uploadDirectory(sftp, localPath, remotePath, (progress) => {
        sendProgress(ctx, serverId, progress)
      })

      return { success: true, data: result }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // Quick deploy: upload + configure nginx + enable + test + reload
  ipcMain.handle('ssh-quick-deploy', async (_, { serverId, localPath, domain, port, ssl, sslCert, sslKey }) => {
    try {
      const client = getSSHClient(serverId)
      if (!client) return { success: false, error: 'Not connected' }
      const password = getServerPassword(serverId)

      const safeDomain = domain.replace(/[^a-zA-Z0-9.-]/g, '')
      if (!safeDomain) return { success: false, error: 'Invalid domain' }

      const remoteDir = `/var/www/${safeDomain}`
      const siteName = safeDomain
      const tmpDir = `/tmp/deploy-${safeDomain}-${Date.now()}`

      // Step 1: Ensure nginx installed
      sendLog(ctx, serverId, '> Checking nginx...')
      const nginxResult = await ensureNginx(client, password)
      sendLog(ctx, serverId, nginxResult.wasInstalled ? '✓ nginx ready' : '✓ nginx installed')

      // Step 2: Upload files to temp directory
      sendLog(ctx, serverId, '> Uploading files...')
      await sshExec(client, `mkdir -p ${tmpDir}`)
      const sftp = await getSFTPClient(client)
      const uploadResult = await uploadDirectory(sftp, localPath, tmpDir, (progress) => {
        sendProgress(ctx, serverId, progress)
      })

      // Step 3: Move files to final location via sudo
      sendLog(ctx, serverId, `> Installing to ${remoteDir}...`)
      await sshExecSudo(client, `mkdir -p ${remoteDir}`, password, 10000)
      await sshExecSudo(client, `cp -a ${tmpDir}/. ${remoteDir}/`, password, 30000)
      await sshExec(client, `rm -rf ${tmpDir}`)

      // Step 4: Install custom SSL cert if provided
      if (ssl === 'custom' && sslCert && sslKey) {
        sendLog(ctx, serverId, '> Installing SSL certificate...')
        const certDir = `/etc/ssl/${safeDomain}`
        await sshExecSudo(client, `mkdir -p ${certDir}`, password, 5000)
        const escapedCert = sslCert.replace(/'/g, "'\\''")
        const escapedKey = sslKey.replace(/'/g, "'\\''")
        await sshExecSudo(client, `echo '${escapedCert}' | tee ${certDir}/fullchain.pem > /dev/null`, password, 5000)
        await sshExecSudo(client, `echo '${escapedKey}' | tee ${certDir}/privkey.pem > /dev/null`, password, 5000)
        await sshExecSudo(client, `chmod 600 ${certDir}/privkey.pem`, password, 5000)
        sendLog(ctx, serverId, '✓ SSL certificate installed')
      }

      // Step 5: Generate nginx config
      sendLog(ctx, serverId, '> Writing nginx config...')
      const config = staticSiteTemplate(safeDomain, remoteDir)
      if (port) config.listen = String(port)
      if (ssl === 'custom' && sslCert && sslKey) {
        config.ssl = true
        config.listen = '443 ssl'
        config.sslCertificate = `/etc/ssl/${safeDomain}/fullchain.pem`
        config.sslCertificateKey = `/etc/ssl/${safeDomain}/privkey.pem`
      }
      const nginxContent = generateNginxConfig(config)

      // Step 6: Write nginx config via sudo tee
      const escaped = nginxContent.replace(/'/g, "'\\''")
      await sshExecSudo(client, `echo '${escaped}' | tee /etc/nginx/sites-available/${siteName} > /dev/null`, password, 10000)

      // Step 7: Enable site
      sendLog(ctx, serverId, '> Enabling site...')
      await sshExecSudo(client, `ln -sf /etc/nginx/sites-available/${siteName} /etc/nginx/sites-enabled/${siteName}`, password, 5000)

      // Step 8: Test nginx
      sendLog(ctx, serverId, '> Testing nginx config...')
      const testResult = await sshExecSudo(client, 'nginx -t 2>&1', password, 10000)
      const testOk = testResult.stdout.includes('successful') || testResult.stderr.includes('successful')

      if (!testOk) {
        sendLog(ctx, serverId, '✗ Nginx config test failed')
        return {
          success: false,
          error: `Nginx config test failed: ${testResult.stdout + testResult.stderr}`,
          data: { uploaded: uploadResult.uploaded, nginxTestFailed: true }
        }
      }

      // Step 9: Reload nginx
      sendLog(ctx, serverId, '> Reloading nginx...')
      await sshExecSudo(client, 'systemctl reload nginx', password, 10000)

      const useHttps = ssl === 'custom' && sslCert && sslKey
      const resultData = {
        uploaded: uploadResult.uploaded,
        domain: safeDomain,
        remoteDir,
        url: `${useHttps ? 'https' : 'http'}://${safeDomain}${port && port !== '80' && !useHttps ? `:${port}` : ''}`
      }

      // Step 10: Certbot (after nginx reload)
      if (ssl === 'certbot') {
        sendLog(ctx, serverId, '> Installing certbot...')
        await sshExecSudo(client, 'apt-get install -y -qq certbot python3-certbot-nginx', password, 120000)
        sendLog(ctx, serverId, '> Requesting SSL certificate...')
        const certResult = await sshExecSudo(client, `certbot --nginx -d ${safeDomain} --non-interactive --agree-tos --register-unsafely-without-email 2>&1`, password, 120000)
        if (certResult.code !== 0) {
          sendLog(ctx, serverId, '✗ Certbot failed (site works on HTTP)')
          return { success: true, data: { ...resultData, sslError: 'Certbot failed: ' + (certResult.stderr || certResult.stdout) } }
        }
        sendLog(ctx, serverId, '✓ SSL certificate installed')
        resultData.url = `https://${safeDomain}`
      }

      return { success: true, data: resultData }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // Full stack deploy: upload + PM2 + nginx (static + reverse proxy)
  ipcMain.handle('ssh-full-deploy', async (_, { serverId, localPath, domain, entryFile, appName, backendPort, proxyPath, ssl, sslCert, sslKey }) => {
    try {
      const client = getSSHClient(serverId)
      if (!client) return { success: false, error: 'Not connected' }
      const password = getServerPassword(serverId)

      const safeDomain = domain.replace(/[^a-zA-Z0-9.-]/g, '')
      if (!safeDomain) return { success: false, error: 'Invalid domain' }

      const safeName = (appName || safeDomain).replace(/[^a-zA-Z0-9_-]/g, '')
      const safePort = String(parseInt(backendPort, 10) || 3000)
      const remoteDir = `/var/www/${safeDomain}`
      const siteName = safeDomain
      const tmpDir = `/tmp/deploy-${safeDomain}-${Date.now()}`

      // Step 1: Ensure nginx installed
      sendLog(ctx, serverId, '> Checking nginx...')
      const nginxResult = await ensureNginx(client, password)
      sendLog(ctx, serverId, nginxResult.wasInstalled ? '✓ nginx ready' : '✓ nginx installed')

      // Step 2: Ensure Node.js installed
      sendLog(ctx, serverId, '> Checking Node.js...')
      const nodeResult = await ensureNode(client, password)
      sendLog(ctx, serverId, nodeResult.wasInstalled ? '✓ Node.js ready' : '✓ Node.js installed')

      // Step 3: Ensure PM2 installed
      sendLog(ctx, serverId, '> Checking PM2...')
      const pm2Result = await ensurePM2(client, password)
      sendLog(ctx, serverId, pm2Result.wasInstalled ? '✓ PM2 ready' : '✓ PM2 installed')

      // Step 4: Upload files to temp directory
      sendLog(ctx, serverId, '> Uploading files...')
      await sshExec(client, `mkdir -p ${tmpDir}`)
      const sftp = await getSFTPClient(client)
      const uploadResult = await uploadDirectory(sftp, localPath, tmpDir, (progress) => {
        sendProgress(ctx, serverId, progress)
      })

      // Step 5: Move files to final location via sudo
      sendLog(ctx, serverId, `> Installing to ${remoteDir}...`)
      await sshExecSudo(client, `mkdir -p ${remoteDir}`, password, 10000)
      await sshExecSudo(client, `cp -a ${tmpDir}/. ${remoteDir}/`, password, 30000)
      await sshExec(client, `rm -rf ${tmpDir}`)

      // Step 6: npm install if package.json exists
      const pkgCheck = await sshExecSudo(client, `test -f ${remoteDir}/package.json && echo yes || echo no`, password)
      if (pkgCheck.stdout.trim() === 'yes') {
        sendLog(ctx, serverId, '> Running npm install...')
        await sshExecSudo(client, `cd ${remoteDir} && npm install --production`, password, 120000)
      }

      // Step 7: Start PM2 process
      sendLog(ctx, serverId, `> Starting PM2 process "${safeName}"...`)
      const safeEntry = entryFile || 'server.js'
      await sshExecSudo(client, `pm2 delete ${safeName} 2>/dev/null; cd ${remoteDir} && pm2 start ${safeEntry} --name ${safeName}`, password, 15000)

      // Step 8: Install custom SSL cert if provided
      if (ssl === 'custom' && sslCert && sslKey) {
        sendLog(ctx, serverId, '> Installing SSL certificate...')
        const certDir = `/etc/ssl/${safeDomain}`
        await sshExecSudo(client, `mkdir -p ${certDir}`, password, 5000)
        const escapedCert = sslCert.replace(/'/g, "'\\''")
        const escapedKey = sslKey.replace(/'/g, "'\\''")
        await sshExecSudo(client, `echo '${escapedCert}' | tee ${certDir}/fullchain.pem > /dev/null`, password, 5000)
        await sshExecSudo(client, `echo '${escapedKey}' | tee ${certDir}/privkey.pem > /dev/null`, password, 5000)
        await sshExecSudo(client, `chmod 600 ${certDir}/privkey.pem`, password, 5000)
        sendLog(ctx, serverId, '✓ SSL certificate installed')
      }

      // Step 9: Generate nginx config (static + proxy)
      sendLog(ctx, serverId, '> Configuring nginx...')
      const config = staticPlusProxyTemplate(safeDomain, remoteDir, safePort, proxyPath || '/api')
      if (ssl === 'custom' && sslCert && sslKey) {
        config.ssl = true
        config.listen = '443 ssl'
        config.sslCertificate = `/etc/ssl/${safeDomain}/fullchain.pem`
        config.sslCertificateKey = `/etc/ssl/${safeDomain}/privkey.pem`
      }
      const nginxContent = generateNginxConfig(config)

      // Step 10: Write nginx config
      const escaped = nginxContent.replace(/'/g, "'\\''")
      await sshExecSudo(client, `echo '${escaped}' | tee /etc/nginx/sites-available/${siteName} > /dev/null`, password, 10000)

      // Step 11: Enable site
      sendLog(ctx, serverId, '> Enabling site...')
      await sshExecSudo(client, `ln -sf /etc/nginx/sites-available/${siteName} /etc/nginx/sites-enabled/${siteName}`, password, 5000)

      // Step 12: Test nginx
      sendLog(ctx, serverId, '> Testing nginx config...')
      const testResult = await sshExecSudo(client, 'nginx -t 2>&1', password, 10000)
      const testOk = testResult.stdout.includes('successful') || testResult.stderr.includes('successful')

      if (!testOk) {
        sendLog(ctx, serverId, '✗ Nginx config test failed')
        return {
          success: false,
          error: `Nginx config test failed: ${testResult.stdout + testResult.stderr}`,
          data: { uploaded: uploadResult.uploaded, nginxTestFailed: true }
        }
      }

      // Step 13: Reload nginx
      sendLog(ctx, serverId, '> Reloading nginx...')
      await sshExecSudo(client, 'systemctl reload nginx', password, 10000)

      const useHttps = ssl === 'custom' && sslCert && sslKey
      const resultData = {
        uploaded: uploadResult.uploaded,
        domain: safeDomain,
        remoteDir,
        pm2Name: safeName,
        backendPort: safePort,
        proxyPath: proxyPath || '/api',
        url: `${useHttps ? 'https' : 'http'}://${safeDomain}`
      }

      // Step 14: Certbot (after nginx reload)
      if (ssl === 'certbot') {
        sendLog(ctx, serverId, '> Installing certbot...')
        await sshExecSudo(client, 'apt-get install -y -qq certbot python3-certbot-nginx', password, 120000)
        sendLog(ctx, serverId, '> Requesting SSL certificate...')
        const certResult = await sshExecSudo(client, `certbot --nginx -d ${safeDomain} --non-interactive --agree-tos --register-unsafely-without-email 2>&1`, password, 120000)
        if (certResult.code !== 0) {
          sendLog(ctx, serverId, '✗ Certbot failed (site works on HTTP)')
          return { success: true, data: { ...resultData, sslError: 'Certbot failed: ' + (certResult.stderr || certResult.stdout) } }
        }
        sendLog(ctx, serverId, '✓ SSL certificate installed')
        resultData.url = `https://${safeDomain}`
      }

      return { success: true, data: resultData }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // Git clone deploy: clone repo + nginx + optional SSL + optional PM2
  ipcMain.handle('ssh-git-clone-deploy', async (_, { serverId, repoUrl, branch, deployPath, domain, deployKeyId, ssl, sslCert, sslKey, fullstack, entryFile, appName, backendPort, proxyPath }) => {
    try {
      const client = getSSHClient(serverId)
      if (!client) return { success: false, error: 'Not connected' }
      const password = getServerPassword(serverId)

      const safeDomain = (domain || '').replace(/[^a-zA-Z0-9.-]/g, '')
      if (!safeDomain) return { success: false, error: 'Invalid domain' }
      if (!repoUrl) return { success: false, error: 'Repository URL is required' }

      const remoteDir = deployPath || `/var/www/${safeDomain}`
      const siteName = safeDomain
      const safeBranch = (branch || 'main').replace(/[^a-zA-Z0-9._/-]/g, '')

      // Step 1: Ensure git is installed
      sendLog(ctx, serverId, '> Checking git...')
      const gitCheck = await sshExec(client, 'which git 2>/dev/null')
      if (gitCheck.code !== 0) {
        sendLog(ctx, serverId, '> Installing git...')
        await sshExecSudo(client, 'apt-get update -qq && apt-get install -y -qq git', password, 120000)
      }
      sendLog(ctx, serverId, '✓ git ready')

      // Step 2: Ensure nginx
      sendLog(ctx, serverId, '> Checking nginx...')
      await ensureNginx(client, password)
      sendLog(ctx, serverId, '✓ nginx ready')

      // Step 3: Prepare deploy key if needed
      let gitSshCmd = ''
      let tempKeyPath = ''
      if (deployKeyId) {
        const settings = loadSettings()
        const dk = (settings.deployKeys || []).find(k => k.id === deployKeyId)
        if (dk) {
          sendLog(ctx, serverId, '> Setting up deploy key...')
          let privKey = dk.encryptedPrivateKey
          if (safeStorage.isEncryptionAvailable()) {
            try { privKey = safeStorage.decryptString(Buffer.from(dk.encryptedPrivateKey, 'base64')) } catch {}
          }
          tempKeyPath = '~/.ssh/deploy_key_temp'
          const escaped = privKey.replace(/'/g, "'\\''")
          await sshExec(client, 'mkdir -p ~/.ssh && chmod 700 ~/.ssh')
          await sshExec(client, `echo '${escaped}' > ${tempKeyPath} && chmod 600 ${tempKeyPath}`)
          gitSshCmd = `GIT_SSH_COMMAND='ssh -i ${tempKeyPath} -o StrictHostKeyChecking=no' `
        }
      }

      // Step 4: Clone repository
      sendLog(ctx, serverId, `> Cloning ${repoUrl} (branch: ${safeBranch})...`)
      await sshExecSudo(client, `mkdir -p ${remoteDir}`, password, 10000)
      // Remove existing contents if any
      await sshExecSudo(client, `rm -rf ${remoteDir}`, password, 10000)
      const cloneCmd = `${gitSshCmd}git clone --branch ${safeBranch} --depth 1 ${repoUrl} ${remoteDir}`
      const cloneRes = await sshExec(client, cloneCmd, 120000)

      // Cleanup temp key
      if (tempKeyPath) {
        await sshExec(client, `rm -f ${tempKeyPath}`)
      }

      if (cloneRes.code !== 0) {
        return { success: false, error: `Git clone failed: ${(cloneRes.stderr || cloneRes.stdout).trim()}` }
      }
      sendLog(ctx, serverId, '✓ Repository cloned')

      // Step 5: If fullstack, ensure Node/PM2, npm install, start
      if (fullstack) {
        sendLog(ctx, serverId, '> Setting up full stack...')
        await ensureNode(client, password)
        await ensurePM2(client, password)

        const pkgCheck = await sshExecSudo(client, `test -f ${remoteDir}/package.json && echo yes || echo no`, password)
        if (pkgCheck.stdout.trim() === 'yes') {
          sendLog(ctx, serverId, '> Running npm install...')
          await sshExecSudo(client, `cd ${remoteDir} && npm install --production`, password, 120000)
        }

        const safeName = (appName || safeDomain).replace(/[^a-zA-Z0-9_-]/g, '')
        const safeEntry = entryFile || 'server.js'
        sendLog(ctx, serverId, `> Starting PM2 process "${safeName}"...`)
        await sshExecSudo(client, `pm2 delete ${safeName} 2>/dev/null; cd ${remoteDir} && pm2 start ${safeEntry} --name ${safeName}`, password, 15000)
      }

      // Step 6: Install custom SSL cert if provided
      if (ssl === 'custom' && sslCert && sslKey) {
        sendLog(ctx, serverId, '> Installing SSL certificate...')
        const certDir = `/etc/ssl/${safeDomain}`
        await sshExecSudo(client, `mkdir -p ${certDir}`, password, 5000)
        const escapedCert = sslCert.replace(/'/g, "'\\''")
        const escapedKey = sslKey.replace(/'/g, "'\\''")
        await sshExecSudo(client, `echo '${escapedCert}' | tee ${certDir}/fullchain.pem > /dev/null`, password, 5000)
        await sshExecSudo(client, `echo '${escapedKey}' | tee ${certDir}/privkey.pem > /dev/null`, password, 5000)
        await sshExecSudo(client, `chmod 600 ${certDir}/privkey.pem`, password, 5000)
        sendLog(ctx, serverId, '✓ SSL certificate installed')
      }

      // Step 7: Generate nginx config
      sendLog(ctx, serverId, '> Configuring nginx...')
      let config
      if (fullstack) {
        const safePort = String(parseInt(backendPort, 10) || 3000)
        config = staticPlusProxyTemplate(safeDomain, remoteDir, safePort, proxyPath || '/api')
      } else {
        config = staticSiteTemplate(safeDomain, remoteDir)
      }
      if (ssl === 'custom' && sslCert && sslKey) {
        config.ssl = true
        config.listen = '443 ssl'
        config.sslCertificate = `/etc/ssl/${safeDomain}/fullchain.pem`
        config.sslCertificateKey = `/etc/ssl/${safeDomain}/privkey.pem`
      }
      const nginxContent = generateNginxConfig(config)
      const escaped = nginxContent.replace(/'/g, "'\\''")
      await sshExecSudo(client, `echo '${escaped}' | tee /etc/nginx/sites-available/${siteName} > /dev/null`, password, 10000)
      await sshExecSudo(client, `ln -sf /etc/nginx/sites-available/${siteName} /etc/nginx/sites-enabled/${siteName}`, password, 5000)

      // Step 8: Test & reload nginx
      sendLog(ctx, serverId, '> Testing nginx config...')
      const testResult = await sshExecSudo(client, 'nginx -t 2>&1', password, 10000)
      const testOk = testResult.stdout.includes('successful') || testResult.stderr.includes('successful')
      if (!testOk) {
        sendLog(ctx, serverId, '✗ Nginx config test failed')
        return { success: false, error: `Nginx config test failed: ${testResult.stdout + testResult.stderr}` }
      }
      await sshExecSudo(client, 'systemctl reload nginx', password, 10000)

      const useHttps = ssl === 'custom' && sslCert && sslKey
      const resultData = {
        domain: safeDomain,
        remoteDir,
        branch: safeBranch,
        url: `${useHttps ? 'https' : 'http'}://${safeDomain}`
      }

      if (fullstack) {
        resultData.pm2Name = (appName || safeDomain).replace(/[^a-zA-Z0-9_-]/g, '')
        resultData.backendPort = String(parseInt(backendPort, 10) || 3000)
        resultData.proxyPath = proxyPath || '/api'
      }

      // Step 9: Certbot
      if (ssl === 'certbot') {
        sendLog(ctx, serverId, '> Installing certbot...')
        await sshExecSudo(client, 'apt-get install -y -qq certbot python3-certbot-nginx', password, 120000)
        sendLog(ctx, serverId, '> Requesting SSL certificate...')
        const certResult = await sshExecSudo(client, `certbot --nginx -d ${safeDomain} --non-interactive --agree-tos --register-unsafely-without-email 2>&1`, password, 120000)
        if (certResult.code !== 0) {
          sendLog(ctx, serverId, '✗ Certbot failed (site works on HTTP)')
          return { success: true, data: { ...resultData, sslError: 'Certbot failed: ' + (certResult.stderr || certResult.stdout) } }
        }
        sendLog(ctx, serverId, '✓ SSL certificate installed')
        resultData.url = `https://${safeDomain}`
      }

      sendLog(ctx, serverId, '✓ Deployment complete')
      return { success: true, data: resultData }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // Remove a project from server by path (used from RemoteProjectManager)
  ipcMain.handle('ssh-remove-project', async (_, { serverId, projectPath }) => {
    const client = getSSHClient(serverId)
    if (!client) return { success: false, error: 'Not connected' }
    const password = getServerPassword(serverId)

    const safePath = (projectPath || '').replace(/[`$\\]/g, '')
    if (!safePath || safePath === '/') return { success: false, error: 'Invalid path' }

    const logs = []
    const errors = []
    const log = (msg) => {
      logs.push(msg)
      sendLog(ctx, serverId, msg)
    }

    // Derive domain from path (last segment, e.g. /var/www/example.com → example.com)
    const folderName = safePath.split('/').filter(Boolean).pop() || ''
    const isDomain = /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(folderName)

    // 1. Try to find & stop PM2 processes related to this project
    log('> Checking PM2 processes...')
    try {
      // Try user PM2 first, then sudo
      let pm2List = []
      const userPm2 = await sshExec(client, 'pm2 jlist 2>/dev/null', 10000)
      if (userPm2.code === 0 && userPm2.stdout.trim()) {
        try { pm2List = JSON.parse(userPm2.stdout) } catch {}
      }
      if (pm2List.length === 0 && password) {
        const sudoPm2 = await sshExecSudo(client, 'pm2 jlist 2>/dev/null', password, 10000)
        if (sudoPm2.code === 0 && sudoPm2.stdout.trim()) {
          try { pm2List = JSON.parse(sudoPm2.stdout) } catch {}
        }
      }

      // Find processes whose cwd matches the project path
      const matching = pm2List.filter(p =>
        p.pm2_env?.pm_cwd === safePath || p.pm2_env?.cwd === safePath
      )
      for (const p of matching) {
        log(`> Stopping PM2 process "${p.name}"...`)
        let res = await sshExec(client, `pm2 delete ${p.name} 2>&1`, 10000)
        if (res.code !== 0) {
          res = await sshExecSudo(client, `pm2 delete ${p.name} 2>&1`, password, 10000)
        }
        log(res.code === 0 ? `✓ PM2 "${p.name}" deleted` : `⚠ PM2 "${p.name}": ${(res.stdout + res.stderr).trim()}`)
      }
      if (matching.length === 0) log('  No PM2 processes found')
    } catch (err) {
      log(`⚠ PM2 check failed: ${err.message}`)
      errors.push(`PM2: ${err.message}`)
    }

    // 2. Remove nginx config if folder looks like a domain
    if (isDomain) {
      log(`> Removing nginx config for "${folderName}"...`)
      try {
        await sshExecSudo(client, `rm -f /etc/nginx/sites-enabled/${folderName}`, password, 10000)
        await sshExecSudo(client, `rm -f /etc/nginx/sites-available/${folderName}`, password, 10000)
        const testResult = await sshExecSudo(client, 'nginx -t 2>&1', password, 10000)
        const testOk = (testResult.stdout + testResult.stderr).includes('successful')
        if (testOk) {
          await sshExecSudo(client, 'systemctl reload nginx', password, 10000)
          log('✓ Nginx config removed & reloaded')
        } else {
          log('✓ Nginx config removed (reload skipped — test failed)')
        }
      } catch (err) {
        log(`⚠ Nginx cleanup failed: ${err.message}`)
        errors.push(`Nginx: ${err.message}`)
      }
    }

    // 3. Remove project files
    log(`> Removing ${safePath}...`)
    try {
      const rmRes = await sshExecSudo(client, `rm -rf ${safePath}`, password, 30000)
      if (rmRes.code === 0) {
        log('✓ Project files removed')
      } else {
        log(`✗ rm failed (code ${rmRes.code}): ${(rmRes.stdout + rmRes.stderr).trim()}`)
        errors.push(`Files: code ${rmRes.code}`)
      }
    } catch (err) {
      log(`✗ Remove files failed: ${err.message}`)
      errors.push(`Files: ${err.message}`)
    }

    // 4. Remove SSL certs if domain-like
    if (isDomain) {
      try {
        const customCert = `/etc/ssl/${folderName}`
        const leCert = `/etc/letsencrypt/live/${folderName}`
        const c1 = await sshExec(client, `test -d ${customCert} && echo yes || echo no`)
        const c2 = await sshExec(client, `test -d ${leCert} && echo yes || echo no`)

        if (c1.stdout.trim() === 'yes') {
          await sshExecSudo(client, `rm -rf ${customCert}`, password, 10000)
          log(`✓ Custom SSL certs removed`)
        }
        if (c2.stdout.trim() === 'yes') {
          const certbotCheck = await sshExec(client, 'which certbot 2>/dev/null')
          if (certbotCheck.code === 0) {
            await sshExecSudo(client, `certbot delete --cert-name ${folderName} --non-interactive 2>&1`, password, 30000)
            log('✓ Certbot certificate deleted')
          } else {
            await sshExecSudo(client, `rm -rf ${leCert}`, password, 10000)
            await sshExecSudo(client, `rm -rf /etc/letsencrypt/renewal/${folderName}.conf`, password, 10000)
            await sshExecSudo(client, `rm -rf /etc/letsencrypt/archive/${folderName}`, password, 10000)
            log('✓ Let\'s Encrypt certs removed')
          }
        }
      } catch (err) {
        log(`⚠ SSL cleanup: ${err.message}`)
      }
    }

    log(errors.length > 0 ? `⚠ Done with ${errors.length} issue(s)` : '✓ Project removed')
    return { success: true, data: { logs, errors } }
  })

  // Undeploy: remove PM2 process + nginx config + project files + SSL certs
  ipcMain.handle('ssh-undeploy', async (_, { serverId, domain, pm2Name }) => {
    const client = getSSHClient(serverId)
    if (!client) return { success: false, error: 'Not connected' }
    const password = getServerPassword(serverId)

    const safeDomain = (domain || '').replace(/[^a-zA-Z0-9.-]/g, '')
    if (!safeDomain) return { success: false, error: 'Invalid domain' }

    const logs = []
    const errors = []
    const log = (msg) => {
      logs.push(msg)
      sendLog(ctx, serverId, msg)
    }

    // 1. Stop & delete PM2 process
    if (pm2Name) {
      const safeName = pm2Name.replace(/[^a-zA-Z0-9_.-]/g, '')
      log(`> Stopping PM2 process "${safeName}"...`)
      try {
        let res = await sshExec(client, `pm2 delete ${safeName} 2>&1`, 10000)
        if (res.code !== 0) {
          res = await sshExecSudo(client, `pm2 delete ${safeName} 2>&1`, password, 10000)
        }
        log(res.code === 0 ? '✓ PM2 process deleted' : `⚠ PM2: ${(res.stdout + res.stderr).trim()}`)
      } catch (err) {
        log(`⚠ PM2 delete failed: ${err.message}`)
        errors.push(`PM2: ${err.message}`)
      }
    }

    // 2. Remove nginx config
    log('> Removing nginx config...')
    try {
      const enRes = await sshExecSudo(client, `rm -f /etc/nginx/sites-enabled/${safeDomain}`, password, 10000)
      log(`  sites-enabled: code=${enRes.code}`)
      const avRes = await sshExecSudo(client, `rm -f /etc/nginx/sites-available/${safeDomain}`, password, 10000)
      log(`  sites-available: code=${avRes.code}`)
      const testResult = await sshExecSudo(client, 'nginx -t 2>&1', password, 10000)
      const testOk = (testResult.stdout + testResult.stderr).includes('successful')
      if (testOk) {
        await sshExecSudo(client, 'systemctl reload nginx', password, 10000)
        log('✓ Nginx config removed & reloaded')
      } else {
        log(`⚠ Nginx config removed but test failed: ${(testResult.stdout + testResult.stderr).trim()}`)
      }
    } catch (err) {
      log(`✗ Nginx cleanup failed: ${err.message}`)
      errors.push(`Nginx: ${err.message}`)
    }

    // 3. Remove project files
    const remoteDir = `/var/www/${safeDomain}`
    log(`> Removing ${remoteDir}...`)
    try {
      const rmRes = await sshExecSudo(client, `rm -rf ${remoteDir}`, password, 30000)
      if (rmRes.code === 0) {
        log('✓ Project files removed')
      } else {
        log(`✗ rm failed (code ${rmRes.code}): ${(rmRes.stdout + rmRes.stderr).trim()}`)
        errors.push(`Files: code ${rmRes.code}`)
      }
    } catch (err) {
      log(`✗ Remove files failed: ${err.message}`)
      errors.push(`Files: ${err.message}`)
    }

    // 4. Remove SSL certs — check both /etc/ssl/{domain} (custom) and /etc/letsencrypt (certbot)
    log('> Checking SSL certificates...')
    try {
      // Custom certs
      const customCertDir = `/etc/ssl/${safeDomain}`
      const c1 = await sshExec(client, `test -d ${customCertDir} && echo yes || echo no`)
      if (c1.stdout.trim() === 'yes') {
        await sshExecSudo(client, `rm -rf ${customCertDir}`, password, 10000)
        log(`✓ Custom SSL certs removed (${customCertDir})`)
      }

      // Certbot / Let's Encrypt certs
      const lePath = `/etc/letsencrypt/live/${safeDomain}`
      const c2 = await sshExec(client, `test -d ${lePath} && echo yes || echo no`)
      if (c2.stdout.trim() === 'yes') {
        // Use certbot delete if available, otherwise manual cleanup
        const certbotCheck = await sshExec(client, 'which certbot 2>/dev/null')
        if (certbotCheck.code === 0) {
          const delRes = await sshExecSudo(client, `certbot delete --cert-name ${safeDomain} --non-interactive 2>&1`, password, 30000)
          log(delRes.code === 0 ? '✓ Certbot certificate deleted' : `⚠ Certbot delete: ${(delRes.stdout + delRes.stderr).trim()}`)
        } else {
          // Manual cleanup
          await sshExecSudo(client, `rm -rf ${lePath}`, password, 10000)
          await sshExecSudo(client, `rm -rf /etc/letsencrypt/renewal/${safeDomain}.conf`, password, 10000)
          await sshExecSudo(client, `rm -rf /etc/letsencrypt/archive/${safeDomain}`, password, 10000)
          log('✓ Let\'s Encrypt certs removed manually')
        }
      }

      if (c1.stdout.trim() !== 'yes' && c2.stdout.trim() !== 'yes') {
        log('  No SSL certificates found')
      }
    } catch (err) {
      log(`⚠ SSL cleanup failed: ${err.message}`)
      errors.push(`SSL: ${err.message}`)
    }

    log(errors.length > 0 ? `⚠ Undeploy finished with ${errors.length} issue(s)` : '✓ Undeploy complete')
    return { success: true, data: { logs, errors } }
  })
}

module.exports = { registerDeployHandlers }
