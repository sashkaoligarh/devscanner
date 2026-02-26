const fs = require('fs')
const path = require('path')

/**
 * Get an SFTP client from an SSH client
 */
function getSFTPClient(sshClient) {
  return new Promise((resolve, reject) => {
    sshClient.sftp((err, sftp) => {
      if (err) reject(err)
      else resolve(sftp)
    })
  })
}

/**
 * Ensure a remote directory exists (recursive mkdir)
 */
function sftpMkdir(sftp, remotePath) {
  return new Promise((resolve, reject) => {
    sftp.mkdir(remotePath, (err) => {
      if (err && err.code !== 4) { // code 4 = already exists
        // Try creating parent first
        const parent = path.posix.dirname(remotePath)
        if (parent === remotePath) return reject(err)
        sftpMkdir(sftp, parent)
          .then(() => {
            sftp.mkdir(remotePath, (err2) => {
              if (err2 && err2.code !== 4) reject(err2)
              else resolve()
            })
          })
          .catch(reject)
      } else {
        resolve()
      }
    })
  })
}

/**
 * Upload a single file via SFTP
 */
function sftpPutFile(sftp, localPath, remotePath) {
  return new Promise((resolve, reject) => {
    sftp.fastPut(localPath, remotePath, (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

/**
 * Recursively collect all files in a directory
 */
function collectFiles(dir, baseDir) {
  baseDir = baseDir || dir
  const results = []
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      // Skip common non-deployable directories
      if (['.git', 'node_modules', '.next', '__pycache__'].includes(entry.name)) continue
      results.push(...collectFiles(fullPath, baseDir))
    } else {
      results.push({
        localPath: fullPath,
        relativePath: path.relative(baseDir, fullPath).replace(/\\/g, '/')
      })
    }
  }
  return results
}

/**
 * Upload a local directory to a remote path via SFTP
 * onProgress is called with { uploaded, total, file }
 */
async function uploadDirectory(sftp, localDir, remoteDir, onProgress) {
  const files = collectFiles(localDir)
  const total = files.length
  let uploaded = 0

  // Collect all unique remote directories
  const dirs = new Set()
  for (const file of files) {
    const remoteFile = path.posix.join(remoteDir, file.relativePath)
    dirs.add(path.posix.dirname(remoteFile))
  }

  // Create directories
  const sortedDirs = [...dirs].sort((a, b) => a.length - b.length)
  for (const dir of sortedDirs) {
    await sftpMkdir(sftp, dir)
  }

  // Upload files
  for (const file of files) {
    const remotePath = path.posix.join(remoteDir, file.relativePath)
    await sftpPutFile(sftp, file.localPath, remotePath)
    uploaded++
    if (onProgress) {
      onProgress({ uploaded, total, file: file.relativePath })
    }
  }

  return { uploaded, total }
}

module.exports = { getSFTPClient, sftpMkdir, sftpPutFile, collectFiles, uploadDirectory }
