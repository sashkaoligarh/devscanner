const { dialog } = require('electron')
const { getSSHClient, sshExec, sshExecSudo, getServerPassword } = require('../utils/ssh-pool')
const { getSFTPClient, uploadDirectory } = require('../utils/sftp-utils')
const { generateNginxConfig, staticSiteTemplate, staticPlusProxyTemplate } = require('../utils/nginx-utils')
const { ensureNginx, ensureNode, ensurePM2, pm2Start } = require('../utils/pm2-utils')

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

function registerDeployHandlers(ipcMain, ctx) {
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
