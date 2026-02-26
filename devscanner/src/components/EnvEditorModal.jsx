import React, { useState, useMemo, useCallback, useEffect } from 'react'
import { X, FileText, AlertTriangle, Plus, CheckCircle, Save } from 'lucide-react'
import electron from '../electronApi'

export default function EnvEditorModal({ project, onClose }) {
  // Build directory list: root + subprojects with env files
  const dirs = useMemo(() => {
    const list = []
    if (project.envFiles?.length > 0) {
      list.push({ key: '__root__', label: project.name + ' (root)', path: project.path, files: project.envFiles })
    }
    if (project.subprojectEnvFiles) {
      for (const [name, info] of Object.entries(project.subprojectEnvFiles)) {
        list.push({ key: name, label: name, path: info.path, files: info.files })
      }
    }
    // If root has no env files but subprojects do, still allow root
    if (list.length === 0) {
      list.push({ key: '__root__', label: project.name + ' (root)', path: project.path, files: [] })
    }
    return list
  }, [project])

  const [selectedDir, setSelectedDir] = useState(dirs[0]?.key || '__root__')
  const [selectedFile, setSelectedFile] = useState(null)
  const [content, setContent] = useState('')
  const [originalContent, setOriginalContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [error, setError] = useState(null)
  const [fileList, setFileList] = useState(dirs[0]?.files || [])
  const [creating, setCreating] = useState(false)
  const [newFileName, setNewFileName] = useState('.env')

  const currentDir = dirs.find(d => d.key === selectedDir) || dirs[0]
  const isDirty = content !== originalContent

  const loadFile = useCallback(async (dirPath, fileName) => {
    setLoading(true)
    setError(null)
    setSaveSuccess(false)
    const res = await electron.readEnvFile({ projectPath: dirPath, fileName })
    if (res.success) {
      setContent(res.data.content)
      setOriginalContent(res.data.content)
      setSelectedFile(fileName)
    } else {
      setError(res.error || 'Failed to read file')
    }
    setLoading(false)
  }, [])

  const refreshFileList = useCallback(async (dirPath) => {
    const res = await electron.listEnvFiles({ projectPath: dirPath })
    if (res.success) setFileList(res.data)
  }, [])

  // Load first file when dir changes
  useEffect(() => {
    if (currentDir && fileList.length > 0) {
      loadFile(currentDir.path, fileList[0])
    } else {
      setSelectedFile(null)
      setContent('')
      setOriginalContent('')
    }
  }, [selectedDir]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleDirChange = (dirKey) => {
    if (isDirty && !window.confirm('You have unsaved changes. Discard?')) return
    const dir = dirs.find(d => d.key === dirKey)
    if (dir) {
      setFileList(dir.files)
      setSelectedDir(dirKey)
      setCreating(false)
    }
  }

  const handleFileChange = (fileName) => {
    if (isDirty && !window.confirm('You have unsaved changes. Discard?')) return
    loadFile(currentDir.path, fileName)
    setCreating(false)
  }

  const handleSave = async () => {
    if (!selectedFile || !currentDir) return
    setSaving(true)
    setError(null)
    const res = await electron.saveEnvFile({
      projectPath: currentDir.path,
      fileName: selectedFile,
      content
    })
    if (res.success) {
      setOriginalContent(content)
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 2000)
    } else {
      setError(res.error || 'Failed to save')
    }
    setSaving(false)
  }

  const handleCreate = async () => {
    const name = newFileName.trim()
    if (!name.startsWith('.env')) {
      setError('File name must start with .env')
      return
    }
    if (fileList.includes(name)) {
      setError('File already exists')
      return
    }
    setError(null)
    // If .env.example exists, copy its content
    let initialContent = ''
    if (fileList.includes('.env.example')) {
      const res = await electron.readEnvFile({ projectPath: currentDir.path, fileName: '.env.example' })
      if (res.success) initialContent = res.data.content
    }
    const saveRes = await electron.saveEnvFile({
      projectPath: currentDir.path,
      fileName: name,
      content: initialContent
    })
    if (saveRes.success) {
      await refreshFileList(currentDir.path)
      setCreating(false)
      setNewFileName('.env')
      loadFile(currentDir.path, name)
    } else {
      setError(saveRes.error || 'Failed to create file')
    }
  }

  const handleClose = () => {
    if (isDirty && !window.confirm('You have unsaved changes. Discard?')) return
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal modal-env" onClick={e => e.stopPropagation()}>
        <div className="modal-title-row">
          <div className="modal-title"><FileText size={16} /> .env Editor</div>
          <button className="btn btn-sm" onClick={handleClose}><X size={14} /></button>
        </div>

        <div className="env-warning">
          <AlertTriangle size={14} />
          <span>These files may contain secrets. Do not commit them to version control.</span>
        </div>

        {dirs.length > 1 && (
          <div className="env-dir-selector">
            {dirs.map(d => (
              <button
                key={d.key}
                className={`env-dir-btn${selectedDir === d.key ? ' active' : ''}`}
                onClick={() => handleDirChange(d.key)}
              >
                {d.label}
              </button>
            ))}
          </div>
        )}

        <div className="env-file-tabs">
          {fileList.map(f => (
            <button
              key={f}
              className={`env-file-tab${selectedFile === f ? ' active' : ''}`}
              onClick={() => handleFileChange(f)}
            >
              {f}
            </button>
          ))}
          <button
            className="env-file-tab env-file-tab-add"
            onClick={() => setCreating(!creating)}
            title="Create new .env file"
          >
            <Plus size={12} />
          </button>
        </div>

        {creating && (
          <div className="env-create-row">
            <input
              className="form-input form-input-sm"
              value={newFileName}
              onChange={e => setNewFileName(e.target.value)}
              placeholder=".env.local"
            />
            <button className="btn btn-primary btn-sm" onClick={handleCreate}>Create</button>
            <button className="btn btn-sm" onClick={() => { setCreating(false); setNewFileName('.env') }}>Cancel</button>
          </div>
        )}

        {error && <div className="form-error">{error}</div>}

        {loading ? (
          <div className="scanning-indicator"><div className="spinner" /> Loading...</div>
        ) : selectedFile ? (
          <textarea
            className="env-editor"
            value={content}
            onChange={e => setContent(e.target.value)}
            spellCheck={false}
          />
        ) : (
          <div className="env-empty">
            No .env files found. Create one with the + button above.
          </div>
        )}

        <div className="env-footer">
          <div className="env-footer-left">
            {isDirty && <span className="env-dirty-indicator">Unsaved changes</span>}
            {saveSuccess && <span className="env-save-success"><CheckCircle size={12} /> Saved</span>}
          </div>
          <div className="modal-actions">
            <button className="btn" onClick={handleClose}>Close</button>
            <button
              className="btn btn-primary"
              disabled={!isDirty || saving}
              onClick={handleSave}
            >
              <Save size={12} /> {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
