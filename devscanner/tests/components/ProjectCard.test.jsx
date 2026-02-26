import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const lucideMock = vi.hoisted(() => require('../lucide-mock'))
vi.mock('lucide-react', () => lucideMock)

import ProjectCard from '../../src/components/ProjectCard'

function makeProject(overrides = {}) {
  return {
    name: 'my-app',
    path: '/home/user/projects/my-app',
    type: 'standalone',
    languages: ['JavaScript'],
    frameworks: ['React'],
    stats: { sourceFiles: 42 },
    git: { branch: 'main' },
    dockerServices: null,
    subprojects: null,
    envFiles: [],
    subprojectEnvFiles: null,
    ...overrides
  }
}

function defaultProps(overrides = {}) {
  return {
    project: makeProject(),
    instances: null,
    onLaunch: vi.fn(),
    onStop: vi.fn(),
    onOpenBrowser: vi.fn(),
    onViewTab: vi.fn(),
    openTabs: {},
    isFavorite: false,
    onToggleFavorite: vi.fn(),
    health: {},
    gitInfo: null,
    onGitFetch: vi.fn().mockResolvedValue(undefined),
    onGitPull: vi.fn().mockResolvedValue(undefined),
    hostIp: null,
    onEnvEdit: vi.fn(),
    onDockerServices: vi.fn(),
    ...overrides
  }
}

describe('ProjectCard', () => {
  it('renders the project name', () => {
    render(<ProjectCard {...defaultProps()} />)
    expect(screen.getByText('my-app')).toBeInTheDocument()
  })

  it('renders language and framework tags', () => {
    render(<ProjectCard {...defaultProps()} />)
    expect(screen.getByText('JavaScript')).toBeInTheDocument()
    expect(screen.getByText('React')).toBeInTheDocument()
  })

  it('shows running class when instances exist', () => {
    const { container } = render(
      <ProjectCard {...defaultProps({
        instances: { inst1: { port: 3000 } }
      })} />
    )
    expect(container.querySelector('.project-card.running')).toBeInTheDocument()
  })

  it('shows Launch button', () => {
    render(<ProjectCard {...defaultProps()} />)
    expect(screen.getByText('Launch')).toBeInTheDocument()
  })

  it('calls onLaunch when Launch button is clicked', () => {
    const props = defaultProps()
    render(<ProjectCard {...props} />)
    fireEvent.click(screen.getByText('Launch'))
    expect(props.onLaunch).toHaveBeenCalledTimes(1)
  })

  it('calls onToggleFavorite when star button is clicked', () => {
    const props = defaultProps()
    render(<ProjectCard {...props} />)
    const starBtn = screen.getByTitle('Add to favorites')
    fireEvent.click(starBtn)
    expect(props.onToggleFavorite).toHaveBeenCalledWith('/home/user/projects/my-app')
  })

  it('shows .env button when envFiles exist', () => {
    const props = defaultProps({
      project: makeProject({ envFiles: ['.env', '.env.local'] })
    })
    render(<ProjectCard {...props} />)
    expect(screen.getByText('.env')).toBeInTheDocument()
  })

  it('does not show .env button when no envFiles', () => {
    const props = defaultProps({
      project: makeProject({ envFiles: [], subprojectEnvFiles: null })
    })
    render(<ProjectCard {...props} />)
    const buttons = screen.getAllByRole('button')
    const envButton = buttons.find(
      b => b.textContent.includes('.env') && !b.textContent.includes('Services')
    )
    expect(envButton).toBeUndefined()
  })

  it('shows git branch info from project.git', () => {
    render(<ProjectCard {...defaultProps()} />)
    expect(screen.getByText('main')).toBeInTheDocument()
  })

  it('shows git branch info from gitInfo prop', () => {
    const props = defaultProps({
      gitInfo: { branch: 'feature/xyz', changed: 3, ahead: 1, behind: 2 }
    })
    render(<ProjectCard {...props} />)
    expect(screen.getByText('feature/xyz')).toBeInTheDocument()
    expect(screen.getByText('~3')).toBeInTheDocument()
  })

  it('shows WSL badge for WSL paths', () => {
    const props = defaultProps({
      project: makeProject({ path: '\\\\wsl$\\Ubuntu\\home\\user\\app' })
    })
    render(<ProjectCard {...props} />)
    expect(screen.getByText('WSL')).toBeInTheDocument()
  })

  it('shows docker services when present', () => {
    const props = defaultProps({
      project: makeProject({
        dockerServices: [
          { name: 'web', image: 'nginx:latest', ports: [{ host: '8080', container: '80' }] },
          { name: 'db', image: 'postgres:15', ports: [{ host: '5432', container: '5432' }] }
        ]
      })
    })
    render(<ProjectCard {...props} />)
    expect(screen.getByText('web')).toBeInTheDocument()
    expect(screen.getByText('db')).toBeInTheDocument()
  })

  it('shows Services button', () => {
    render(<ProjectCard {...defaultProps()} />)
    expect(screen.getByText('Services')).toBeInTheDocument()
  })

  it('calls onDockerServices when Services button is clicked', () => {
    const props = defaultProps()
    render(<ProjectCard {...props} />)
    fireEvent.click(screen.getByText('Services'))
    expect(props.onDockerServices).toHaveBeenCalledWith(props.project)
  })
})
