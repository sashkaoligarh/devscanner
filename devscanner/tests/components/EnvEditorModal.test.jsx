import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const lucideMock = vi.hoisted(() => require('../lucide-mock'))
vi.mock('lucide-react', () => lucideMock)

const mockElectron = vi.hoisted(() => ({
  readEnvFile: vi.fn(),
  saveEnvFile: vi.fn(),
  listEnvFiles: vi.fn()
}))
vi.mock('../../src/electronApi', () => ({ default: mockElectron }))

import EnvEditorModal from '../../src/components/EnvEditorModal'

function makeProject(overrides = {}) {
  return {
    name: 'my-app',
    path: '/home/user/projects/my-app',
    envFiles: ['.env', '.env.local'],
    subprojectEnvFiles: null,
    ...overrides
  }
}

describe('EnvEditorModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default mock: reading env file returns content
    mockElectron.readEnvFile.mockResolvedValue({
      success: true,
      data: { content: 'API_KEY=test123\nDB_URL=postgres://localhost/db' }
    })
    mockElectron.saveEnvFile.mockResolvedValue({ success: true })
    mockElectron.listEnvFiles.mockResolvedValue({ success: true, data: ['.env', '.env.local'] })
  })

  it('renders file tabs for env files', async () => {
    render(<EnvEditorModal project={makeProject()} onClose={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText('.env')).toBeInTheDocument()
    })
    expect(screen.getByText('.env.local')).toBeInTheDocument()
  })

  it('renders the modal title', async () => {
    render(<EnvEditorModal project={makeProject()} onClose={vi.fn()} />)

    expect(screen.getByText('.env Editor')).toBeInTheDocument()
  })

  it('shows the security warning', async () => {
    render(<EnvEditorModal project={makeProject()} onClose={vi.fn()} />)

    expect(screen.getByText(/secrets/i)).toBeInTheDocument()
  })

  it('calls onClose when Close button is clicked', async () => {
    const onClose = vi.fn()
    render(<EnvEditorModal project={makeProject()} onClose={onClose} />)

    await waitFor(() => {
      expect(screen.getByText('.env')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('Close'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows loading state while reading a file', () => {
    // Make readEnvFile hang to keep loading state
    mockElectron.readEnvFile.mockReturnValue(new Promise(() => {}))

    render(<EnvEditorModal project={makeProject()} onClose={vi.fn()} />)

    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it('loads and displays file content in textarea', async () => {
    render(<EnvEditorModal project={makeProject()} onClose={vi.fn()} />)

    await waitFor(() => {
      const textarea = screen.getByRole('textbox')
      expect(textarea).toBeInTheDocument()
      expect(textarea.value).toContain('API_KEY=test123')
    })
  })

  it('calls readEnvFile with the first file on mount', async () => {
    render(<EnvEditorModal project={makeProject()} onClose={vi.fn()} />)

    await waitFor(() => {
      expect(mockElectron.readEnvFile).toHaveBeenCalledWith({
        projectPath: '/home/user/projects/my-app',
        fileName: '.env'
      })
    })
  })

  it('shows Save button as disabled when content is unchanged', async () => {
    render(<EnvEditorModal project={makeProject()} onClose={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })

    const saveBtn = screen.getByText('Save').closest('button')
    expect(saveBtn).toBeDisabled()
  })

  it('enables Save button when content is edited', async () => {
    render(<EnvEditorModal project={makeProject()} onClose={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })

    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: 'CHANGED=true' } })

    const saveBtn = screen.getByText('Save').closest('button')
    expect(saveBtn).not.toBeDisabled()
  })

  it('shows empty state when no env files exist', async () => {
    mockElectron.readEnvFile.mockResolvedValue({ success: false, error: 'Not found' })

    const project = makeProject({ envFiles: [] })
    render(<EnvEditorModal project={project} onClose={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText(/No .env files found/)).toBeInTheDocument()
    })
  })

  it('shows directory selector when subprojects have env files', async () => {
    const project = makeProject({
      envFiles: ['.env'],
      subprojectEnvFiles: {
        'api': { path: '/home/user/projects/my-app/api', files: ['.env'] },
        'web': { path: '/home/user/projects/my-app/web', files: ['.env.local'] }
      }
    })

    render(<EnvEditorModal project={project} onClose={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByText('my-app (root)')).toBeInTheDocument()
    })
    expect(screen.getByText('api')).toBeInTheDocument()
    expect(screen.getByText('web')).toBeInTheDocument()
  })

  it('shows the create new file button', async () => {
    render(<EnvEditorModal project={makeProject()} onClose={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByTitle('Create new .env file')).toBeInTheDocument()
    })
  })
})
