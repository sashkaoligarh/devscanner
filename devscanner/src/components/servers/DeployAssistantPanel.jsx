import React, { useEffect, useState } from 'react'
import electron from '../../electronApi'

export default function DeployAssistantPanel({ payload, onBusyChange, onApply }) {
  const [question, setQuestion] = useState('Разбери ошибку деплоя и предложи исправление.')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [history, setHistory] = useState([])
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [apiKeySaved, setApiKeySaved] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let active = true
    Promise.all([electron.deployAssistantSettings({}), electron.deployAssistantHistory(payload)]).then(([settings, records]) => {
      if (!active) return
      if (settings.success) { setModel(settings.data.model); setApiKeySaved(settings.data.apiKeySaved) }
      else setError(settings.error)
      if (records.success) setHistory(records.data)
    }).catch(err => { if (active) setError(err.message) })
    const remove = electron.onDeployAssistantProgress(data => {
      if (data.serverId === payload.serverId && data.projectPath === payload.projectPath) setProgress(data.message)
    })
    return () => { active = false; remove?.() }
  }, [payload.serverId, payload.projectPath, payload.targetId, payload.mode])

  const setRunning = value => { setBusy(value); onBusyChange(value) }
  const run = async () => {
    setRunning(true); setError(''); setResult(null); setProgress('Collecting deployment context…')
    try {
      const response = await electron.deployAssistantRun({ ...payload, question })
      if (!response.success) throw new Error(response.error)
      setResult(response.data)
      const records = await electron.deployAssistantHistory(payload)
      if (records.success) setHistory(records.data)
    } catch (err) { setError(err.message) } finally { setRunning(false); setProgress('') }
  }
  const save = async clearApiKey => {
    setRunning(true); setError(''); setSaved(false)
    try {
      const response = await electron.deployAssistantSettings({ save: true, model, apiKey: clearApiKey ? '' : apiKey, clearApiKey })
      if (!response.success) throw new Error(response.error)
      setApiKey(''); setApiKeySaved(response.data.apiKeySaved); setSaved(true)
    } catch (err) { setError(err.message) } finally { setRunning(false) }
  }
  return <section aria-label="Codex deployment assistant">
    <p className="deploy-section-title">Codex assistant</p>
    <p className="deploy-help">Sends deployment configs and diagnostics to Codex with known secrets removed. Codex can request more server checks and propose changes for this project. Preparation validates the changes before installing them.</p>
    {payload.error && <p className="deploy-help">Current error: {payload.error}</p>}
    <div className="form-group">
      <label className="form-label" htmlFor="deploy-assistant-question">Task for Codex</label>
      <textarea id="deploy-assistant-question" className="form-input" rows="3" value={question} disabled={busy} onChange={e => setQuestion(e.target.value)} />
    </div>
    <div className="deploy-section-heading">
      <button className="btn btn-primary btn-sm" disabled={busy || !payload.serverId || !question.trim()} onClick={run}>Analyze deployment</button>
      {busy && <button className="btn btn-sm" onClick={() => electron.deployAssistantCancel({ serverId: payload.serverId }).catch(err => setError(err.message))}>Stop</button>}
    </div>
    {progress && <p className="deploy-help" role="status">{progress}</p>}
    {error && <p className="deploy-warning" role="alert">{error}</p>}
    {result && <div className="deploy-assistant-result">
      <p>{result.summary}</p>
      <ul className="deploy-file-list">{result.findings.map((finding, i) => <li key={i}>{finding}</li>)}</ul>
      {result.changes.map((change, i) => <div className="deploy-assistant-change" key={i}>
        <strong>{change.field === 'port' ? change.key + ' host port' : change.field}</strong>
        <p className="deploy-help">{change.reason}</p>
        {change.field === 'nginxConfig' ? <details className="deploy-details"><summary>Proposed nginx config</summary><pre>{change.value}</pre></details> : <code>{change.value}</code>}
      </div>)}
      {!!result.changes.length && <button className="btn btn-sm" disabled={busy} onClick={() => onApply(result)}>Apply to form and check</button>}
      <p className="deploy-help">The server has not been changed by this diagnosis.</p>
    </div>}
    <details className="deploy-details">
      <summary>Codex connection</summary>
      <div className="deploy-details-body">
        <p className="deploy-help">Uses an existing local Codex login. If needed, run <code>codex login</code> locally. If your login is only in the system keyring, use an API key or a file-based Codex login. An optional OpenAI API key uses API billing and is stored encrypted.</p>
        <div className="form-group"><label className="form-label" htmlFor="deploy-codex-model">Model (optional)</label><input id="deploy-codex-model" className="form-input" value={model} disabled={busy} placeholder="Use Codex default" onChange={e => setModel(e.target.value)} /></div>
        <div className="form-group"><label className="form-label" htmlFor="deploy-codex-key">OpenAI API key</label><input id="deploy-codex-key" className="form-input" type="password" autoComplete="off" value={apiKey} disabled={busy} placeholder={apiKeySaved ? 'A key is saved' : 'Optional — use Codex login'} onChange={e => setApiKey(e.target.value)} /></div>
        <div className="deploy-section-heading"><button className="btn btn-sm" disabled={busy} onClick={() => save(false)}>Save connection</button>{apiKeySaved && <button className="btn btn-sm" disabled={busy} onClick={() => save(true)}>Use Codex login</button>}</div>
        {saved && <p className="deploy-help" role="status">Connection settings saved.</p>}
      </div>
    </details>
    {!!history.length && <details className="deploy-details">
      <summary>Previous diagnoses ({history.length})</summary>
      <ul className="deploy-file-list">{[...history].reverse().map(record => <li key={record.id}>{record.summary}<p className="deploy-help">{new Date(record.createdAt).toLocaleString()} · {record.status === 'prepared' ? 'Server preparation passed' : record.status === 'failed' ? 'Preparation failed — needs another check' : 'Proposed; not verified'}</p></li>)}</ul>
    </details>}
  </section>
}
