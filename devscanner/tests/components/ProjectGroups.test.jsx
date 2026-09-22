import React, { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import ProjectGroups from '../../src/components/ProjectGroups'
import ProjectCard from '../../src/components/ProjectCard'

function project(relativePath, overrides = {}) {
  return {
    name: relativePath.split('/').at(-1), relativePath, path: '/projects/' + relativePath,
    type: 'node', languages: ['JavaScript'], frameworks: [], stats: { sourceFiles: 1 },
    envFiles: [], ...overrides
  }
}

const monolith = project('kr/kpcep', { subprojects: [
  { name: 'frontend', path: '/projects/kr/kpcep/frontend' },
  { name: 'cms', path: '/projects/kr/kpcep/cms' }
] })
const other = project('kr/solo')
const personal = project('pets/solo')
const projects = [monolith, other, personal]

function Browser({ items = projects, searchQuery = '', initialExpanded = [], onDeploy = vi.fn() }) {
  const [expandedFolders, setExpandedFolders] = useState(new Set(initialExpanded))
  return <ProjectGroups
    projects={items} folderPath="/projects" searchQuery={searchQuery} expandedFolders={expandedFolders}
    onToggleFolder={folder => setExpandedFolders(previous => {
      const next = new Set(previous)
      if (next.has(folder)) next.delete(folder)
      else next.add(folder)
      return next
    })}
    renderProject={item => <ProjectCard key={item.path} project={item} openTabs={[]}
      onDeploySetup={onDeploy} onToggleFavorite={vi.fn()} onLaunch={vi.fn()} />}
  />
}

describe('projects grouped by folder', () => {
  it('starts with collapsed categories and counts actual projects, keeping monoliths intact', () => {
    const { container } = render(<Browser />)
    expect(screen.getByRole('button', { name: 'kr 2 projects' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: 'pets 1 project' })).toHaveAttribute('aria-expanded', 'false')
    expect(container.querySelectorAll('.project-card')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'kr 2 projects' }))
    expect(container.querySelectorAll('.project-card')).toHaveLength(2)
    expect(screen.getByText('frontend')).toBeInTheDocument()
    expect(screen.getByText('cms')).toBeInTheDocument()
    expect(container.querySelector('[data-project-path="/projects/pets/solo"]')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'kr 2 projects' }))
    expect(container.querySelectorAll('.project-card')).toHaveLength(0)
  })

  it('deploys the selected project inside its category using the original root object', () => {
    const onDeploy = vi.fn()
    const { container } = render(<Browser onDeploy={onDeploy} />)
    fireEvent.click(screen.getByRole('button', { name: 'kr 2 projects' }))
    fireEvent.click(within(container.querySelector('[data-project-path="/projects/kr/kpcep"]')).getByRole('button', { name: 'Deploy' }))
    expect(onDeploy).toHaveBeenCalledExactlyOnceWith(monolith)
    fireEvent.click(screen.getByRole('button', { name: 'pets 1 project' }))
    fireEvent.click(within(container.querySelector('[data-project-path="/projects/pets/solo"]')).getByRole('button', { name: 'Deploy' }))
    expect(onDeploy).toHaveBeenLastCalledWith(personal)
  })

  it('keeps nested folders and direct projects at their own level', () => {
    const rootProject = project('root-app')
    const nested = project('work/client/site')
    const { container } = render(<Browser items={[rootProject, nested]} />)
    expect(container.querySelector('[data-project-path="/projects/root-app"]')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'work 1 project' }))
    expect(container.querySelector('[data-project-path="/projects/work/client/site"]')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'client 1 project' }))
    expect(container.querySelector('[data-project-path="/projects/work/client/site"]')).toBeInTheDocument()
  })

  it('automatically reveals search results and restores manually expanded folders afterward', () => {
    const nested = project('work/client/site')
    const { container, rerender } = render(<Browser items={[...projects, nested]} initialExpanded={['/projects/pets']} />)
    rerender(<Browser items={[nested]} searchQuery="site" />)
    expect(screen.getByRole('button', { name: 'work 1 project' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'client 1 project' })).toHaveAttribute('aria-expanded', 'true')
    expect(container.querySelector('[data-project-path="/projects/work/client/site"]')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'work 1 project' }))
    expect(container.querySelector('[data-project-path="/projects/work/client/site"]')).not.toBeInTheDocument()
    rerender(<Browser items={[...projects, nested]} searchQuery="" />)
    expect(screen.getByRole('button', { name: 'pets 1 project' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'work 1 project' })).toHaveAttribute('aria-expanded', 'false')
    rerender(<Browser items={[nested]} searchQuery="site" />)
    expect(container.querySelector('[data-project-path="/projects/work/client/site"]')).toBeInTheDocument()
  })

  it('preserves incoming favorite order within a category while folder order stays stable', () => {
    const { container, rerender } = render(<Browser items={[personal, other, monolith]} initialExpanded={['/projects/kr', '/projects/pets']} />)
    const paths = () => [...container.querySelectorAll('[data-project-path]')].map(card => card.dataset.projectPath)
    expect(paths()).toEqual([other.path, monolith.path, personal.path])
    rerender(<Browser items={[monolith, personal, other]} />)
    expect(paths()).toEqual([monolith.path, other.path, personal.path])
  })

  it('uses the same hierarchy for Windows and WSL paths', () => {
    render(<ProjectGroups projects={[project('work\\client\\site')]} folderPath={'C:\\Projects'} searchQuery=""
      expandedFolders={new Set(['C:/Projects/work'])} onToggleFolder={vi.fn()} renderProject={item => <div key={item.path}>{item.name}</div>} />)
    expect(screen.getByRole('button', { name: 'work 1 project' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('button', { name: 'client 1 project' })).toHaveAttribute('title', 'C:/Projects/work/client')
  })
})
