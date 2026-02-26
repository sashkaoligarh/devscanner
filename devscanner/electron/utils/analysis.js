const path = require('path')
const fs = require('fs')
const yaml = require('js-yaml')
const { SOURCE_EXTENSIONS, EXCLUDED_DIRS, FRAMEWORK_PORT_MAP, LANGUAGE_PORT_MAP, MANIFEST_FILES } = require('../constants')
const { execInContext } = require('./context')

function countSourceFiles(dir, depth = 0, maxDepth = 4) {
  if (depth >= maxDepth) return 0
  let count = 0
  try {
    const entries = fs.readdirSync(dir)
    for (const entry of entries) {
      if (EXCLUDED_DIRS.has(entry)) continue
      const fullPath = path.join(dir, entry)
      try {
        const stat = fs.statSync(fullPath)
        if (stat.isDirectory()) {
          count += countSourceFiles(fullPath, depth + 1, maxDepth)
        } else if (stat.isFile()) {
          const ext = path.extname(entry).toLowerCase()
          if (SOURCE_EXTENSIONS.has(ext)) count++
        }
      } catch {
        // skip inaccessible entries
      }
    }
  } catch {
    // skip inaccessible directories
  }
  return count
}

function getGitInfo(projectPath) {
  try {
    const gitDir = path.join(projectPath, '.git')
    if (!fs.existsSync(gitDir)) return null

    const output = execInContext(
      'git rev-parse --abbrev-ref HEAD && git rev-list --count HEAD',
      { cwd: projectPath, encoding: 'utf-8', timeout: 5000 }
    ).trim()

    const lines = output.split('\n')
    const branch = lines[0]?.trim() || 'unknown'
    const commits = parseInt(lines[1]?.trim(), 10)

    return { branch, commits: isNaN(commits) ? 0 : commits }
  } catch {
    return null
  }
}

function detectLanguagesAndFrameworks(projectPath, entries) {
  const languages = []
  const frameworks = []

  // package.json detection
  if (entries.includes('package.json')) {
    try {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(projectPath, 'package.json'), 'utf-8')
      )
      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies
      }

      if (!languages.includes('JavaScript')) languages.push('JavaScript')

      if (allDeps.typescript || entries.includes('tsconfig.json')) {
        if (!languages.includes('TypeScript')) languages.push('TypeScript')
      }

      if (allDeps.next) frameworks.push('Next.js')
      if (allDeps.vite) frameworks.push('Vite')
      if (allDeps['react-scripts']) frameworks.push('React')
      if (allDeps.vue) frameworks.push('Vue')
      if (allDeps.nuxt) frameworks.push('Nuxt')
      if (allDeps.express) frameworks.push('Express')
      if (allDeps.fastify) frameworks.push('Fastify')
      if (allDeps['@nestjs/core']) frameworks.push('NestJS')
      if (allDeps['@sveltejs/kit']) frameworks.push('SvelteKit')
      if (allDeps.svelte && !allDeps['@sveltejs/kit']) frameworks.push('Svelte')
      if (allDeps.strapi) frameworks.push('Strapi')
      if (allDeps.electron) frameworks.push('Electron')

      if (
        allDeps.react &&
        !allDeps['react-scripts'] &&
        !allDeps.next &&
        !frameworks.includes('Vue') &&
        !frameworks.includes('Svelte') &&
        !frameworks.includes('SvelteKit')
      ) {
        if (!frameworks.includes('React')) frameworks.push('React')
      }
    } catch {
      if (!languages.includes('JavaScript')) languages.push('JavaScript')
    }
  }

  if (entries.includes('requirements.txt')) {
    if (!languages.includes('Python')) languages.push('Python')
    try {
      const content = fs.readFileSync(
        path.join(projectPath, 'requirements.txt'),
        'utf-8'
      ).toLowerCase()
      if (content.includes('django')) frameworks.push('Django')
      if (content.includes('flask')) frameworks.push('Flask')
      if (content.includes('fastapi')) frameworks.push('FastAPI')
    } catch { /* skip */ }
  }

  if (entries.includes('pyproject.toml') || entries.includes('setup.py')) {
    if (!languages.includes('Python')) languages.push('Python')
  }

  if (entries.includes('go.mod')) {
    if (!languages.includes('Go')) languages.push('Go')
  }

  if (entries.includes('Cargo.toml')) {
    if (!languages.includes('Rust')) languages.push('Rust')
  }

  if (entries.includes('composer.json')) {
    if (!languages.includes('PHP')) languages.push('PHP')
    try {
      const composer = JSON.parse(
        fs.readFileSync(path.join(projectPath, 'composer.json'), 'utf-8')
      )
      const require = composer.require || {}
      if (require['laravel/framework']) frameworks.push('Laravel')
    } catch { /* skip */ }
  }

  if (entries.includes('Gemfile')) {
    if (!languages.includes('Ruby')) languages.push('Ruby')
    try {
      const content = fs.readFileSync(
        path.join(projectPath, 'Gemfile'),
        'utf-8'
      ).toLowerCase()
      if (content.includes('rails')) frameworks.push('Rails')
    } catch { /* skip */ }
  }

  if (entries.includes('pom.xml')) {
    if (!languages.includes('Java')) languages.push('Java')
    frameworks.push('Spring Boot')
  }

  if (entries.includes('build.gradle') || entries.includes('build.gradle.kts')) {
    if (!languages.includes('Java')) languages.push('Java')
    if (entries.includes('build.gradle.kts') && !languages.includes('Kotlin')) {
      languages.push('Kotlin')
    }
  }

  if (entries.some(e => e.endsWith('.csproj'))) {
    if (!languages.includes('C#')) languages.push('C#')
    if (!frameworks.includes('.NET')) frameworks.push('.NET')
  }

  return { languages, frameworks }
}

function getDefaultPort(frameworks, languages) {
  for (const fw of frameworks) {
    if (FRAMEWORK_PORT_MAP[fw] !== undefined) return FRAMEWORK_PORT_MAP[fw]
  }
  for (const lang of languages) {
    if (LANGUAGE_PORT_MAP[lang] !== undefined) return LANGUAGE_PORT_MAP[lang]
  }
  return 3000
}

function analyzeSubprojects(projectPath, entries, depth = 0, maxDepth = 2) {
  const subprojects = []
  const aggregatedLanguages = new Set()
  const aggregatedFrameworks = new Set()

  for (const entry of entries) {
    if (EXCLUDED_DIRS.has(entry)) continue
    const childPath = path.join(projectPath, entry)
    try {
      const stat = fs.statSync(childPath)
      if (!stat.isDirectory()) continue
      const childEntries = fs.readdirSync(childPath)

      const hasChildManifest =
        MANIFEST_FILES.some(m => childEntries.includes(m)) ||
        childEntries.some(e => e.endsWith('.csproj'))

      const hasChildDocker =
        childEntries.includes('Dockerfile') ||
        childEntries.includes('docker-compose.yml') ||
        childEntries.includes('docker-compose.yaml')

      if (hasChildManifest || hasChildDocker) {
        const { languages, frameworks } = detectLanguagesAndFrameworks(childPath, childEntries)
        languages.forEach(l => aggregatedLanguages.add(l))
        frameworks.forEach(f => aggregatedFrameworks.add(f))

        let hasNpm = false
        if (childEntries.includes('package.json')) {
          try {
            const pkg = JSON.parse(
              fs.readFileSync(path.join(childPath, 'package.json'), 'utf-8')
            )
            hasNpm = pkg.scripts && Object.keys(pkg.scripts).length > 0
          } catch {
            hasNpm = false
          }
        }

        const relativeName = depth > 0
          ? path.relative(path.dirname(projectPath), childPath).split(path.sep).slice(1).join('/')
          : entry

        subprojects.push({
          name: relativeName,
          path: childPath,
          languages,
          frameworks,
          hasNpm,
          hasDocker: hasChildDocker
        })
      }

      if (depth < maxDepth - 1) {
        const nested = analyzeSubprojects(childPath, childEntries, depth + 1, maxDepth)
        nested.subprojects?.forEach(sp => {
          const prefixedName = `${entry}/${sp.name}`
          sp.name = prefixedName
          subprojects.push(sp)
          sp.languages.forEach(l => aggregatedLanguages.add(l))
          sp.frameworks.forEach(f => aggregatedFrameworks.add(f))
        })
      }
    } catch {
      // skip inaccessible entries
    }
  }

  return {
    aggregatedLanguages: [...aggregatedLanguages],
    aggregatedFrameworks: [...aggregatedFrameworks],
    subprojects: subprojects.length > 0 ? subprojects : null
  }
}

function parseDockerCompose(projectPath) {
  const composeFile =
    fs.existsSync(path.join(projectPath, 'docker-compose.yml'))
      ? path.join(projectPath, 'docker-compose.yml')
      : fs.existsSync(path.join(projectPath, 'docker-compose.yaml'))
        ? path.join(projectPath, 'docker-compose.yaml')
        : null

  if (!composeFile) return null

  try {
    const content = fs.readFileSync(composeFile, 'utf-8')
    const doc = yaml.load(content)
    if (!doc) return null

    const services = doc.services || {}
    const result = []

    for (const [name, config] of Object.entries(services)) {
      const service = {
        name,
        image: config.image || null,
        build: null,
        ports: [],
        dependsOn: [],
        environment: [],
        volumes: []
      }

      if (config.build) {
        if (typeof config.build === 'string') {
          service.build = config.build
        } else if (config.build.context) {
          service.build = config.build.context
          if (config.build.dockerfile) {
            service.build += ` (${config.build.dockerfile})`
          }
        }
      }

      if (config.ports) {
        for (const portDef of config.ports) {
          const portStr = String(portDef)
          const parts = portStr.replace(/\/\w+$/, '').split(':')
          if (parts.length === 3) {
            service.ports.push({ host: parseInt(parts[1], 10), container: parseInt(parts[2], 10), bind: parts[0] })
          } else if (parts.length === 2) {
            service.ports.push({ host: parseInt(parts[0], 10), container: parseInt(parts[1], 10), bind: '0.0.0.0' })
          } else if (parts.length === 1) {
            const p = parseInt(parts[0], 10)
            service.ports.push({ host: p, container: p, bind: '0.0.0.0' })
          }
        }
      }

      if (config.environment) {
        if (Array.isArray(config.environment)) {
          service.environment = config.environment.map(e => {
            const idx = String(e).indexOf('=')
            if (idx === -1) return { key: String(e), value: '' }
            return { key: String(e).substring(0, idx), value: String(e).substring(idx + 1) }
          })
        } else if (typeof config.environment === 'object') {
          service.environment = Object.entries(config.environment).map(([k, v]) => ({ key: k, value: String(v ?? '') }))
        }
      }

      if (config.depends_on) {
        if (Array.isArray(config.depends_on)) {
          service.dependsOn = config.depends_on
        } else if (typeof config.depends_on === 'object') {
          service.dependsOn = Object.keys(config.depends_on)
        }
      }

      result.push(service)
    }

    return result.length > 0 ? result : null
  } catch {
    return null
  }
}

function detectEnvFiles(dirPath) {
  try {
    const entries = fs.readdirSync(dirPath)
    const envFiles = entries.filter(e => {
      if (!e.startsWith('.env')) return false
      try {
        return fs.statSync(path.join(dirPath, e)).isFile()
      } catch { return false }
    })
    envFiles.sort((a, b) => {
      if (a === '.env') return -1
      if (b === '.env') return 1
      if (a === '.env.example') return -1
      if (b === '.env.example') return 1
      return a.localeCompare(b)
    })
    return envFiles
  } catch { return [] }
}

function analyzeProject(projectPath) {
  try {
    const entries = fs.readdirSync(projectPath)

    const hasManifest =
      MANIFEST_FILES.some(m => entries.includes(m)) ||
      entries.some(e => e.endsWith('.csproj'))

    const hasDocker =
      entries.includes('Dockerfile') ||
      entries.includes('docker-compose.yml') ||
      entries.includes('docker-compose.yaml')

    let hasNpm = false
    if (entries.includes('package.json')) {
      try {
        const pkg = JSON.parse(
          fs.readFileSync(path.join(projectPath, 'package.json'), 'utf-8')
        )
        hasNpm = pkg.scripts && Object.keys(pkg.scripts).length > 0
      } catch {
        hasNpm = false
      }
    }

    let languages = [], frameworks = [], subprojects = null

    if (hasManifest) {
      const detected = detectLanguagesAndFrameworks(projectPath, entries)
      languages = detected.languages
      frameworks = detected.frameworks
    }

    const sub = analyzeSubprojects(projectPath, entries)
    subprojects = sub.subprojects

    if (!hasManifest && !hasDocker && !subprojects) return null

    if (!hasManifest) {
      languages = sub.aggregatedLanguages
      frameworks = sub.aggregatedFrameworks
    } else if (subprojects) {
      const langSet = new Set(languages)
      const fwSet = new Set(frameworks)
      sub.aggregatedLanguages.forEach(l => langSet.add(l))
      sub.aggregatedFrameworks.forEach(f => fwSet.add(f))
      languages = [...langSet]
      frameworks = [...fwSet]
    }

    const launchMethods = []
    if (hasNpm) launchMethods.push('npm')
    if (subprojects && subprojects.some(s => s.hasNpm)) launchMethods.push('npm')
    if (hasDocker) launchMethods.push('docker')
    if (subprojects && subprojects.some(s => s.hasDocker)) launchMethods.push('docker')
    const uniqueMethods = [...new Set(launchMethods)]

    let type = 'unknown'
    if (!hasManifest && !hasDocker && subprojects) type = 'monorepo'
    else if (!hasManifest && hasDocker) type = 'docker-compose'
    else if (entries.includes('package.json')) type = 'node'
    else if (entries.includes('requirements.txt') || entries.includes('pyproject.toml') || entries.includes('setup.py')) type = 'python'
    else if (entries.includes('go.mod')) type = 'go'
    else if (entries.includes('Cargo.toml')) type = 'rust'
    else if (entries.includes('composer.json')) type = 'php'
    else if (entries.includes('Gemfile')) type = 'ruby'
    else if (entries.includes('pom.xml') || entries.includes('build.gradle') || entries.includes('build.gradle.kts')) type = 'java'
    else if (entries.some(e => e.endsWith('.csproj'))) type = 'dotnet'

    const defaultPort = getDefaultPort(frameworks, languages)
    const git = getGitInfo(projectPath)
    const sourceFiles = countSourceFiles(projectPath)

    const dockerServices = hasDocker ? parseDockerCompose(projectPath) : null
    const envFiles = detectEnvFiles(projectPath)

    let subprojectEnvFiles = null
    if (subprojects) {
      const collected = {}
      for (const sp of subprojects) {
        const spEnv = detectEnvFiles(sp.path)
        if (spEnv.length > 0) {
          collected[sp.name] = { path: sp.path, files: spEnv }
        }
      }
      if (Object.keys(collected).length > 0) subprojectEnvFiles = collected
    }

    return {
      name: path.basename(projectPath),
      path: projectPath,
      type,
      languages,
      frameworks,
      hasDocker,
      hasNpm,
      defaultPort,
      launchMethods: uniqueMethods,
      git,
      stats: { sourceFiles },
      subprojects,
      dockerServices,
      envFiles,
      subprojectEnvFiles
    }
  } catch {
    return null
  }
}

module.exports = {
  countSourceFiles,
  getGitInfo,
  detectLanguagesAndFrameworks,
  getDefaultPort,
  analyzeSubprojects,
  parseDockerCompose,
  detectEnvFiles,
  analyzeProject
}
