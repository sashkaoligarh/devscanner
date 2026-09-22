import React, { useEffect, useId, useMemo, useState } from 'react'
import { ChevronDown, FolderOpen } from 'lucide-react'

function buildProjectTree(projects, folderPath) {
  const root = { path: (folderPath || '').replace(/\\/g, '/').replace(/\/$/, ''), projects: [], folders: new Map(), count: 0 }
  for (const project of projects) {
    const categories = (project.relativePath || project.name).replace(/\\/g, '/').split('/').slice(0, -1)
    let node = root
    node.count++
    for (const name of categories) {
      if (!node.folders.has(name)) {
        node.folders.set(name, { name, path: `${node.path}/${name}`, projects: [], folders: new Map(), count: 0 })
      }
      node = node.folders.get(name)
      node.count++
    }
    node.projects.push(project)
  }
  return root
}

export default function ProjectGroups({ projects, folderPath, searchQuery, expandedFolders, onToggleFolder, renderProject }) {
  const tree = useMemo(() => buildProjectTree(projects, folderPath), [projects, folderPath])
  const query = searchQuery.trim()
  const [searchState, setSearchState] = useState({ query: '', collapsed: new Set() })
  useEffect(() => {
    setSearchState({ query, collapsed: new Set() })
  }, [query])
  const isExpanded = folder => query
    ? searchState.query !== query || !searchState.collapsed.has(folder.path)
    : expandedFolders.has(folder.path)

  const toggleFolder = folder => {
    if (!query) { onToggleFolder(folder.path); return }
    setSearchState(previous => {
      const collapsed = new Set(previous.query === query ? previous.collapsed : [])
      if (collapsed.has(folder.path)) collapsed.delete(folder.path)
      else collapsed.add(folder.path)
      return { query, collapsed }
    })
  }

  return <ProjectTree node={tree} isExpanded={isExpanded} onToggle={toggleFolder} renderProject={renderProject} />
}

function ProjectTree({ node, isExpanded, onToggle, renderProject }) {
  const folders = [...node.folders.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
  return <div className="project-folders">
    {folders.map(folder => (
      <ProjectFolder key={folder.path} folder={folder} isExpanded={isExpanded} onToggle={onToggle} renderProject={renderProject} />
    ))}
    {node.projects.length > 0 && <div className="project-grid">{node.projects.map(renderProject)}</div>}
  </div>
}

function ProjectFolder({ folder, isExpanded, onToggle, renderProject }) {
  const contentId = useId()
  const open = isExpanded(folder)
  return <section className="project-folder">
    <button className="project-folder-toggle" aria-label={`${folder.name} ${folder.count} ${folder.count === 1 ? 'project' : 'projects'}`}
      aria-expanded={open} aria-controls={open ? contentId : undefined}
      onClick={() => onToggle(folder)} title={folder.path}>
      <ChevronDown size={14} className={`project-folder-chevron${open ? ' expanded' : ''}`} />
      <FolderOpen size={16} />
      <span className="project-folder-name">{folder.name}</span>
      <span className="project-folder-count">{folder.count} {folder.count === 1 ? 'project' : 'projects'}</span>
    </button>
    {open && <div id={contentId} className="project-folder-content">
      <ProjectTree node={folder} isExpanded={isExpanded} onToggle={onToggle} renderProject={renderProject} />
    </div>}
  </section>
}
