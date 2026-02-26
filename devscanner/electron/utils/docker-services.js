const path = require('path')
const fs = require('fs')
const yaml = require('js-yaml')
const { execInContext } = require('./context')
const { getMainWindow } = require('../globals')

const SERVICE_CATALOG = {
  postgres: {
    label: 'PostgreSQL',
    image: 'postgres:16-alpine',
    defaultPort: 5432,
    env: { POSTGRES_USER: 'dev', POSTGRES_PASSWORD: 'dev', POSTGRES_DB: 'devdb' },
    volumes: ['pgdata:/var/lib/postgresql/data'],
    healthcheck: { test: ['CMD-SHELL', 'pg_isready -U dev'], interval: '5s', retries: 5 },
    connectionTemplate: 'postgresql://{POSTGRES_USER}:{POSTGRES_PASSWORD}@localhost:{port}/{POSTGRES_DB}',
    envKey: 'DATABASE_URL'
  },
  mysql: {
    label: 'MySQL',
    image: 'mysql:8',
    defaultPort: 3306,
    env: { MYSQL_ROOT_PASSWORD: 'dev', MYSQL_DATABASE: 'devdb' },
    volumes: ['mysqldata:/var/lib/mysql'],
    healthcheck: { test: ['CMD', 'mysqladmin', 'ping', '-h', 'localhost'], interval: '5s', retries: 5 },
    connectionTemplate: 'mysql://root:{MYSQL_ROOT_PASSWORD}@localhost:{port}/{MYSQL_DATABASE}',
    envKey: 'DATABASE_URL'
  },
  mongodb: {
    label: 'MongoDB',
    image: 'mongo:7',
    defaultPort: 27017,
    env: {},
    volumes: ['mongodata:/data/db'],
    healthcheck: { test: ['CMD', 'mongosh', '--eval', 'db.adminCommand("ping")'], interval: '5s', retries: 5 },
    connectionTemplate: 'mongodb://localhost:{port}',
    envKey: 'MONGO_URL'
  },
  redis: {
    label: 'Redis',
    image: 'redis:7-alpine',
    defaultPort: 6379,
    env: {},
    volumes: ['redisdata:/data'],
    healthcheck: { test: ['CMD', 'redis-cli', 'ping'], interval: '5s', retries: 5 },
    connectionTemplate: 'redis://localhost:{port}',
    envKey: 'REDIS_URL'
  },
  clickhouse: {
    label: 'ClickHouse',
    image: 'clickhouse/clickhouse-server:latest',
    defaultPort: 8123,
    env: {},
    volumes: ['clickhousedata:/var/lib/clickhouse'],
    healthcheck: { test: ['CMD', 'wget', '--spider', '-q', 'http://localhost:8123/ping'], interval: '5s', retries: 5 },
    connectionTemplate: 'http://localhost:{port}',
    envKey: 'CLICKHOUSE_URL'
  },
  rabbitmq: {
    label: 'RabbitMQ',
    image: 'rabbitmq:3-management-alpine',
    defaultPort: 5672,
    adminPort: 15672,
    env: { RABBITMQ_DEFAULT_USER: 'dev', RABBITMQ_DEFAULT_PASS: 'dev' },
    volumes: ['rabbitmqdata:/var/lib/rabbitmq'],
    healthcheck: { test: ['CMD', 'rabbitmq-diagnostics', '-q', 'ping'], interval: '10s', retries: 5 },
    connectionTemplate: 'amqp://{RABBITMQ_DEFAULT_USER}:{RABBITMQ_DEFAULT_PASS}@localhost:{port}',
    envKey: 'AMQP_URL'
  },
  kafka: {
    label: 'Kafka (KRaft)',
    image: 'bitnami/kafka:latest',
    defaultPort: 9092,
    env: {
      KAFKA_CFG_NODE_ID: '0',
      KAFKA_CFG_PROCESS_ROLES: 'controller,broker',
      KAFKA_CFG_LISTENERS: 'PLAINTEXT://:9092,CONTROLLER://:9093',
      KAFKA_CFG_CONTROLLER_QUORUM_VOTERS: '0@kafka:9093',
      KAFKA_CFG_CONTROLLER_LISTENER_NAMES: 'CONTROLLER'
    },
    volumes: ['kafkadata:/bitnami/kafka'],
    healthcheck: { test: ['CMD-SHELL', 'kafka-broker-api-versions.sh --bootstrap-server localhost:9092'], interval: '10s', retries: 10 },
    connectionTemplate: 'localhost:{port}',
    envKey: 'KAFKA_BROKER'
  },
  'celery-redis': {
    label: 'Celery + Redis',
    multi: true,
    services: {
      redis: { image: 'redis:7-alpine', defaultPort: 6379, healthcheck: { test: ['CMD', 'redis-cli', 'ping'] } },
      celery: { image: null, note: 'Requires project Dockerfile with celery worker', build: '.', command: 'celery -A app worker --loglevel=info' }
    },
    connectionTemplate: 'redis://localhost:{port}/0',
    envKey: 'CELERY_BROKER_URL'
  },
  pgadmin: {
    label: 'pgAdmin',
    image: 'dpage/pgadmin4:latest',
    defaultPort: 5050,
    env: { PGADMIN_DEFAULT_EMAIL: 'admin@dev.local', PGADMIN_DEFAULT_PASSWORD: 'admin' },
    volumes: ['pgadmindata:/var/lib/pgadmin'],
    adminUrl: 'http://localhost:{port}',
    envKey: null
  },
  adminer: {
    label: 'Adminer',
    image: 'adminer:latest',
    defaultPort: 8080,
    env: {},
    adminUrl: 'http://localhost:{port}',
    envKey: null
  },
  redisinsight: {
    label: 'RedisInsight',
    image: 'redis/redisinsight:latest',
    defaultPort: 5540,
    env: {},
    adminUrl: 'http://localhost:{port}',
    envKey: null
  }
}

function sanitizeProjectName(projectPath) {
  return path.basename(projectPath).replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase() || 'project'
}

function generateComposeFile(projectPath, services) {
  const name = sanitizeProjectName(projectPath)
  const networkName = `devscanner-${name}`

  const composeObj = {
    version: '3.8',
    networks: { [networkName]: { driver: 'bridge' } },
    volumes: {},
    services: {}
  }

  for (const [key, svcConfig] of Object.entries(services)) {
    if (!svcConfig.enabled) continue
    const catalogEntry = SERVICE_CATALOG[key]
    if (!catalogEntry) continue

    if (catalogEntry.multi && catalogEntry.services) {
      for (const [subKey, subSvc] of Object.entries(catalogEntry.services)) {
        const containerName = `devscanner-${name}-${subKey}`
        const svcDef = {
          container_name: containerName,
          networks: [networkName],
          restart: 'unless-stopped'
        }
        if (subSvc.build) svcDef.build = subSvc.build
        if (subSvc.image) svcDef.image = subSvc.image
        if (subSvc.command) svcDef.command = subSvc.command
        if (subSvc.defaultPort) {
          const port = subKey === 'redis' ? (svcConfig.port || subSvc.defaultPort) : subSvc.defaultPort
          svcDef.ports = [`${port}:${subSvc.defaultPort}`]
        }
        if (subSvc.healthcheck) svcDef.healthcheck = { ...subSvc.healthcheck }
        composeObj.services[subKey] = svcDef
      }
    } else {
      const port = svcConfig.port || catalogEntry.defaultPort
      const containerName = `devscanner-${name}-${key}`
      const svcDef = {
        image: catalogEntry.image,
        container_name: containerName,
        ports: [`${port}:${catalogEntry.defaultPort}`],
        networks: [networkName],
        restart: 'unless-stopped'
      }

      if (catalogEntry.adminPort) {
        svcDef.ports.push(`${catalogEntry.adminPort}:${catalogEntry.adminPort}`)
      }

      const envVars = { ...(catalogEntry.env || {}), ...(svcConfig.env || {}) }
      if (Object.keys(envVars).length > 0) {
        svcDef.environment = envVars
      }

      if (catalogEntry.volumes && catalogEntry.volumes.length > 0) {
        svcDef.volumes = catalogEntry.volumes.map(v => {
          const [volName, mountPath] = v.split(':')
          const fullVolName = `devscanner-${name}-${volName}`
          composeObj.volumes[fullVolName] = null
          return `${fullVolName}:${mountPath}`
        })
      }

      if (catalogEntry.healthcheck) {
        svcDef.healthcheck = { ...catalogEntry.healthcheck }
      }

      composeObj.services[key] = svcDef
    }
  }

  const header = '# Auto-generated by DevScanner. Do not edit manually.\n'
  const yamlStr = yaml.dump(composeObj, { lineWidth: 120, noRefs: true })
  const filePath = path.join(projectPath, 'docker-compose.devscanner.yml')
  fs.writeFileSync(filePath, header + yamlStr, 'utf-8')
  return filePath
}

function generateConnectionString(serviceKey, config) {
  const catalogEntry = SERVICE_CATALOG[serviceKey]
  if (!catalogEntry) return null
  if (catalogEntry.adminUrl) {
    return catalogEntry.adminUrl.replace('{port}', String(config.port || catalogEntry.defaultPort))
  }
  if (!catalogEntry.connectionTemplate) return null
  let str = catalogEntry.connectionTemplate
  const port = config.port || catalogEntry.defaultPort
  str = str.replace('{port}', String(port))
  const envVars = { ...(catalogEntry.env || {}), ...(config.env || {}) }
  str = str.replace(/\{([A-Z_]+)\}/g, (_, varName) => envVars[varName] || '')
  return str
}

// --- Docker Services Health Polling ---

const dockerHealthPollingTimers = new Map() // projectPath -> intervalId

function startHealthPolling(projectPath, servicesConfig) {
  stopHealthPolling(projectPath)
  const name = sanitizeProjectName(projectPath)

  const poll = () => {
    const status = {}
    for (const [key, svcConfig] of Object.entries(servicesConfig)) {
      if (!svcConfig.enabled) continue
      const catalogEntry = SERVICE_CATALOG[key]
      if (!catalogEntry) continue

      const containerName = `devscanner-${name}-${key}`
      try {
        const out = execInContext(
          `docker inspect --format='{{json .State}}' ${containerName}`,
          { cwd: projectPath, encoding: 'utf-8', timeout: 5000, stdio: 'pipe' }
        )
        const state = JSON.parse(out.trim().replace(/^'|'$/g, ''))
        status[key] = {
          running: state.Running || false,
          health: state.Health?.Status || (state.Running ? 'running' : 'stopped')
        }
      } catch {
        status[key] = { running: false, health: 'stopped' }
      }
    }
    const mainWindow = getMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('docker-services-health', { projectPath, status })
    }
  }

  poll()
  const timerId = setInterval(poll, 5000)
  dockerHealthPollingTimers.set(projectPath, timerId)
}

function stopHealthPolling(projectPath) {
  const timerId = dockerHealthPollingTimers.get(projectPath)
  if (timerId) {
    clearInterval(timerId)
    dockerHealthPollingTimers.delete(projectPath)
  }
}

module.exports = {
  SERVICE_CATALOG,
  sanitizeProjectName,
  generateComposeFile,
  generateConnectionString,
  dockerHealthPollingTimers,
  startHealthPolling,
  stopHealthPolling
}
