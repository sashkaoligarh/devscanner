# Docker Services Launcher — Design Document

## Overview

A feature that allows users to spin up common infrastructure services (databases, caches, message brokers, workers) from a curated catalog of Docker templates, directly from the DevScanner UI. Each service is isolated per-project using a separate `docker-compose.devscanner.yml` file that does not interfere with the user's existing Docker setup.

## Goals

- One-click launch of common dev services (PostgreSQL, Redis, MongoDB, etc.)
- Per-project service configuration with sensible defaults
- Health monitoring and connection string generation
- Integration with the .env editor to inject connection variables

## Architecture

### Service Catalog

A constant `SERVICE_CATALOG` in `main.js` defines available service templates:

```js
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
```

### Compose File Generation

For each project, a `docker-compose.devscanner.yml` is generated in the project root. Key principles:

- **Never touch** the user's `docker-compose.yml`
- All services share a project-scoped Docker network: `devscanner-{projectName}`
- Named volumes follow the pattern: `devscanner-{projectName}-{service}`
- Container names: `devscanner-{projectName}-{service}`

```yaml
# Auto-generated by DevScanner. Do not edit manually.
version: "3.8"

networks:
  devscanner-myapp:
    driver: bridge

volumes:
  devscanner-myapp-pgdata:
  devscanner-myapp-redisdata:

services:
  postgres:
    image: postgres:16-alpine
    container_name: devscanner-myapp-postgres
    ports:
      - "5432:5432"
    environment:
      POSTGRES_USER: dev
      POSTGRES_PASSWORD: dev
      POSTGRES_DB: devdb
    volumes:
      - devscanner-myapp-pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U dev"]
      interval: 5s
      retries: 5
    networks:
      - devscanner-myapp
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    container_name: devscanner-myapp-redis
    ports:
      - "6379:6379"
    volumes:
      - devscanner-myapp-redisdata:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      retries: 5
    networks:
      - devscanner-myapp
    restart: unless-stopped
```

### Configuration Storage

Stored in the existing `settings.json` under a `dockerServices` key:

```json
{
  "dockerServices": {
    "/home/user/projects/myapp": {
      "services": {
        "postgres": {
          "enabled": true,
          "port": 5432,
          "env": { "POSTGRES_USER": "dev", "POSTGRES_PASSWORD": "dev", "POSTGRES_DB": "devdb" }
        },
        "redis": {
          "enabled": true,
          "port": 6379
        }
      },
      "lastStarted": "2026-02-20T10:00:00Z"
    }
  }
}
```

### IPC Handlers

| Handler | Input | Output |
|---------|-------|--------|
| `docker-services-catalog` | `{}` | `{ success, data: SERVICE_CATALOG }` |
| `docker-services-config` | `{ projectPath }` | `{ success, data: savedConfig }` |
| `docker-services-save` | `{ projectPath, services }` | `{ success }` |
| `docker-services-start` | `{ projectPath }` | `{ success }` — generates compose, runs `docker compose -f ... up -d` |
| `docker-services-stop` | `{ projectPath }` | `{ success }` — runs `docker compose -f ... down` |
| `docker-services-status` | `{ projectPath }` | `{ success, data: { [service]: { state, health } } }` |
| `docker-services-inject-env` | `{ projectPath, envFileName, entries }` | `{ success }` — appends/updates keys in .env |

### Health Monitoring

- Use native Docker healthcheck definitions in the compose file
- Poll via `docker inspect --format='{{.State.Health.Status}}' <container>` every 5 seconds
- Report states: `starting`, `healthy`, `unhealthy`
- Show health badge in the UI per service

### Connection Strings

- Generated from `connectionTemplate` in the catalog by substituting env vars and port
- Displayed in the UI with a copy button
- Existing `getDbConnectionString()` function can be reused/extended

### .env Integration

- "Inject into .env" button per service writes the connection string as the appropriate env var (e.g., `DATABASE_URL=postgresql://...`)
- If the key already exists in the file, prompt for confirmation before overwriting
- Uses the existing `save-env-file` IPC handler

## UI Design

### Service Selection Panel

Located in the project card or as a modal:

```
┌─────────────────────────────────────────┐
│ Docker Services — myapp                  │
├─────────────────────────────────────────┤
│ ☐ PostgreSQL        port: [5432]        │
│ ☐ Redis             port: [6379]        │
│ ☐ MongoDB           port: [27017]       │
│ ☐ RabbitMQ          port: [5672]        │
│ ☐ pgAdmin           port: [5050]        │
│ ...                                      │
├─────────────────────────────────────────┤
│ [Cancel]                    [Start ▶]   │
└─────────────────────────────────────────┘
```

### Running Services Panel

```
┌─────────────────────────────────────────┐
│ Services — myapp                 [Stop] │
├─────────────────────────────────────────┤
│ ● PostgreSQL  :5432  healthy            │
│   postgresql://dev:dev@localhost:5432/db │
│   [Copy] [Inject into .env]            │
│                                          │
│ ● Redis       :6379  healthy            │
│   redis://localhost:6379                 │
│   [Copy] [Inject into .env]            │
│                                          │
│ ○ pgAdmin     :5050  starting...        │
│   [Open in browser]                     │
└─────────────────────────────────────────┘
```

## Implementation Phases

### Phase 1: MVP
- Service catalog constant
- UI for selecting services and configuring ports
- Compose file generation
- Start / Stop via `docker compose -f docker-compose.devscanner.yml up -d / down`

### Phase 2: Health & Connections
- Health monitoring via `docker inspect` polling
- Connection string generation and display
- Admin UI links (pgAdmin, Adminer, RedisInsight)

### Phase 3: .env Integration & Port Safety
- "Inject into .env" button
- Port conflict detection before starting (check if port is already in use)
- Volume management (list volumes, prune unused)

### Phase 4: Advanced
- Custom service templates (user-defined images)
- Import services from existing `docker-compose.yml`
- Framework-based presets (e.g., "Django project" auto-selects PostgreSQL + Redis + Celery)
- Grouped start/stop for service stacks

## Edge Cases

- **No Docker installed**: Disable the feature, show "Docker not found" message
- **Port conflicts**: Detect before starting, suggest alternative port
- **WSL paths**: Use `wsl.exe -d <distro> -- docker compose ...` for WSL-based projects
- **Compose file already exists**: `docker-compose.devscanner.yml` is always overwritten on start (it's auto-generated)
- **Orphan volumes**: Provide a "Clean up volumes" button per project
