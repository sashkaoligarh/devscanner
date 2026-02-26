import React, { useState, useMemo } from 'react'
import {
  Play, Square, ExternalLink, Terminal,
  GitBranch, FileCode, Star, Database, Copy,
  ArrowUp, ArrowDown, GitPullRequest, Loader, CheckCircle, XCircle, Clock,
  FileText, Container, RefreshCw
} from 'lucide-react'
import { LANGUAGE_COLORS, FRAMEWORK_COLORS, makeLogKey, isWslPath } from '../constants'

function getDbConnectionString(service) {
  const image = service.image || ''
  const env = service.environment || []
  const em = Object.fromEntries(env.map(e => [e.key, e.value]))
  const port = service.ports[0]?.host || null
  if (/postgres/i.test(image)) {
    const u = em.POSTGRES_USER || 'postgres'
    const pw = em.POSTGRES_PASSWORD ? `:${em.POSTGRES_PASSWORD}` : ''
    const db = em.POSTGRES_DB || u
    return { type: 'PostgreSQL', url: `postgresql://${u}${pw}@localhost:${port || 5432}/${db}` }
  }
  if (/mysql|mariadb/i.test(image)) {
    const u = em.MYSQL_USER || 'root'
    const pw = em.MYSQL_ROOT_PASSWORD || em.MYSQL_PASSWORD || ''
    const db = em.MYSQL_DATABASE || ''
    return { type: 'MySQL', url: `mysql://${u}${pw ? `:${pw}` : ''}@localhost:${port || 3306}/${db}` }
  }
  if (/redis/i.test(image)) {
    return { type: 'Redis', url: `redis://localhost:${port || 6379}` }
  }
  if (/mongo/i.test(image)) {
    const u = em.MONGO_INITDB_ROOT_USERNAME
    const pw = em.MONGO_INITDB_ROOT_PASSWORD
    const db = em.MONGO_INITDB_DATABASE || 'test'
    const auth = u ? `${u}:${pw}@` : ''
    return { type: 'MongoDB', url: `mongodb://${auth}localhost:${port || 27017}/${db}` }
  }
  if (/rabbitmq/i.test(image)) {
    const u = em.RABBITMQ_DEFAULT_USER || 'guest'
    const pw = em.RABBITMQ_DEFAULT_PASS || 'guest'
    return { type: 'RabbitMQ', url: `amqp://${u}:${pw}@localhost:${port || 5672}` }
  }
  return null
}

export default function ProjectCard({
  project, instances, onLaunch, onStop, onOpenBrowser, onViewTab, openTabs,
  isFavorite, onToggleFavorite, health, gitInfo, onGitFetch, onGitPull, hostIp,
  onEnvEdit, onDockerServices
}) {
  const instanceEntries = instances ? Object.entries(instances) : []
  const isRunning = instanceEntries.length > 0
  const [gitLoading, setGitLoading] = useState(null) // 'fetch'|'pull'|null

  const dbServices = useMemo(() => {
    if (!project.dockerServices) return []
    return project.dockerServices
      .map(svc => ({ svc, conn: getDbConnectionString(svc) }))
      .filter(x => x.conn !== null)
  }, [project.dockerServices])

  const handleGitFetch = async () => {
    setGitLoading('fetch')
    await onGitFetch(project.path)
    setGitLoading(null)
  }
  const handleGitPull = async () => {
    setGitLoading('pull')
    await onGitPull(project.path)
    setGitLoading(null)
  }

  const gi = gitInfo || project.git

  return (
    <div className={`project-card${isRunning ? ' running' : ''}${isFavorite ? ' favorited' : ''}`}>
      <div className="project-name-row">
        <div className="project-name">
          {project.name}
          {isWslPath(project.path) && <span className="wsl-badge">WSL</span>}
        </div>
        <button
          className={`btn-star${isFavorite ? ' starred' : ''}`}
          onClick={() => onToggleFavorite(project.path)}
          title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        >
          <Star size={13} fill={isFavorite ? 'currentColor' : 'none'} />
        </button>
      </div>

      {(project.type === 'docker-compose' || project.type === 'monorepo') && (
        <div className="project-type-badge">{project.type}</div>
      )}

      {(project.languages.length > 0 || project.frameworks.length > 0) && (
        <div className="tags">
          {project.languages.map(lang => (
            <span key={lang} className="tag" style={{
              backgroundColor: `${LANGUAGE_COLORS[lang] || '#888'}26`,
              borderColor: LANGUAGE_COLORS[lang] || '#888',
              color: LANGUAGE_COLORS[lang] || '#888'
            }}>{lang}</span>
          ))}
          {project.frameworks.map(fw => (
            <span key={fw} className="tag" style={{
              backgroundColor: `${FRAMEWORK_COLORS[fw] || '#888'}26`,
              borderColor: FRAMEWORK_COLORS[fw] || '#888',
              color: FRAMEWORK_COLORS[fw] || '#888'
            }}>{fw}</span>
          ))}
        </div>
      )}

      {project.subprojects && (
        <div className="subprojects-info">
          <span className="subprojects-label">Subprojects:</span>
          {project.subprojects.map(sp => (
            <span key={sp.name} className="subproject-name">{sp.name}</span>
          ))}
        </div>
      )}

      {project.dockerServices && (
        <div className="docker-services">
          <span className="docker-services-label">Docker services:</span>
          <div className="docker-services-list">
            {project.dockerServices.map(svc => (
              <div key={svc.name} className="docker-service">
                <span className="docker-service-name">{svc.name}</span>
                {svc.image && <span className="docker-service-detail">{svc.image}</span>}
                {svc.build && !svc.image && <span className="docker-service-detail">build: {svc.build}</span>}
                {svc.ports.map(p => (
                  <span key={`${p.host}:${p.container}`} className="docker-service-port">:{p.host}</span>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {dbServices.length > 0 && (
        <div className="db-connections">
          {dbServices.map(({ svc, conn }) => (
            <div key={svc.name} className="db-conn-row">
              <Database size={10} />
              <span className="db-conn-type">{conn.type}</span>
              <code className="db-conn-url" title={conn.url}>{conn.url}</code>
              <button
                className="btn-icon"
                title="Copy connection string"
                onClick={() => navigator.clipboard.writeText(conn.url).catch(() => {})}
              >
                <Copy size={10} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="project-stats">
        {gi && (
          <>
            <span><GitBranch size={12} /> {gi.branch}</span>
            {gitInfo?.changed > 0 && <span className="git-changed">~{gitInfo.changed}</span>}
            {gitInfo?.ahead > 0 && <span className="git-ahead"><ArrowUp size={10} />{gitInfo.ahead}</span>}
            {gitInfo?.behind > 0 && <span className="git-behind"><ArrowDown size={10} />{gitInfo.behind}</span>}
          </>
        )}
        <span><FileCode size={12} /> {project.stats.sourceFiles} files</span>
        {gi && (
          <span className="git-actions">
            <button
              className="btn-icon"
              title="git fetch"
              disabled={!!gitLoading}
              onClick={handleGitFetch}
            >
              {gitLoading === 'fetch' ? <Loader size={10} className="spin" /> : <RefreshCw size={10} />}
            </button>
            <button
              className="btn-icon"
              title="git pull"
              disabled={!!gitLoading}
              onClick={handleGitPull}
            >
              {gitLoading === 'pull' ? <Loader size={10} className="spin" /> : <GitPullRequest size={10} />}
            </button>
          </span>
        )}
      </div>

      <div className="project-actions">
        {instanceEntries.map(([instanceId, info]) => {
          const tabKey = makeLogKey(project.path, instanceId)
          const healthKey = makeLogKey(project.path, instanceId)
          const hs = health?.[healthKey]
          return (
            <div key={instanceId} className="instance-row">
              <span className="status-badge">
                {instanceId} :{info.port}{hostIp ? ` (${hostIp})` : ''}
              </span>
              {hs === 'pending' && <Clock size={11} className="health-icon-pending" title="Checking health..." />}
              {hs === 'healthy' && <CheckCircle size={11} className="health-icon-ok" title="Service healthy" />}
              {hs === 'unhealthy' && <XCircle size={11} className="health-icon-err" title="Unreachable" />}
              <button className="btn btn-danger btn-sm" onClick={() => onStop(project.path, instanceId)}>
                <Square size={10} /> Stop
              </button>
              <button className="btn btn-sm" onClick={() => onOpenBrowser(info.port)}>
                <ExternalLink size={10} />
              </button>
              <button className="btn btn-sm" onClick={() => onViewTab(tabKey)}>
                <Terminal size={10} />
              </button>
            </div>
          )
        })}
        {(project.envFiles?.length > 0 || project.subprojectEnvFiles) && (
          <button className="btn btn-sm" onClick={() => onEnvEdit(project)}>
            <FileText size={12} /> .env
          </button>
        )}
        <button className="btn btn-sm" onClick={() => onDockerServices(project)}>
          <Container size={12} /> Services
        </button>
        <button className="btn btn-primary" onClick={onLaunch}>
          <Play size={12} /> Launch
        </button>
      </div>
    </div>
  )
}
