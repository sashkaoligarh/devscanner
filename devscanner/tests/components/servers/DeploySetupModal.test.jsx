import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import DeploySetupModal from '../../../src/components/servers/DeploySetupModal'
const api = vi.hoisted(() => ({ deploySetupPreview: vi.fn(), deploySetupRun: vi.fn(), deploySetupImportEnv: vi.fn(), deploySetupGenerateEnv: vi.fn(), onDeployLog: vi.fn() }))
vi.mock('../../../src/electronApi', () => ({ default: api }))
const preview = {
  mode: 'private-vpn', deployUser: 'deploy-app', remoteBase: '/opt/app', recommendations: ['Server pulls images'],
  targets: [{ id: 'publish', label: 'Build images', type: 'workflow', secrets: ['TOKEN'] }],
  envFields: [{ key: 'POSTGRES_PASSWORD', value: '', required: true, sensitive: true }],
  envSources: ['deploy/server.env', 'cms/.env'], composeFile: 'deploy/stack.yml', autodeployScript: 'app-autodeploy.sh', certificates: []
}
const props = { project: { name: 'Application', path: '/projects/app' }, servers: [{ id: 'srv1', name: 'VPN server' }], onClose: vi.fn() }
beforeEach(() => {
  vi.clearAllMocks()
  api.deploySetupPreview.mockResolvedValue({ success: true, data: preview })
  api.onDeployLog.mockReturnValue(vi.fn())
  api.deploySetupImportEnv.mockResolvedValue({ success: true, data: { POSTGRES_PASSWORD: 'imported-password' } })
})
afterEach(cleanup)

it('imports env, keeps sensitive fields masked, and submits a concrete full setup', async () => {
  api.deploySetupRun.mockResolvedValue({ success: false, error: 'test failure', completed: ['Prepare user'] })
  render(<DeploySetupModal {...props} />)
  await screen.findByText('Server environment')
  fireEvent.change(screen.getByLabelText('Local env file'), { target: { value: 'cms/.env' } })
  fireEvent.click(screen.getByText('Import env'))
  await waitFor(() => expect(screen.getByLabelText('POSTGRES_PASSWORD *')).toHaveValue('imported-password'))
  expect(screen.getByLabelText('POSTGRES_PASSWORD *')).toHaveAttribute('type', 'password')
  fireEvent.click(screen.getByText('Prepare Server & Secrets'))
  await screen.findByRole('alert')
  expect(api.deploySetupRun).toHaveBeenCalledWith(expect.objectContaining({ serverId: 'srv1', targetId: 'publish', mode: 'private-vpn', installCron: true, overwriteEnv: false, envValues: { POSTGRES_PASSWORD: 'imported-password' } }))
  expect(screen.getByText(/Completed before the error/)).toHaveTextContent('Prepare user')
})

it('keeps the dialog and selected server stable while provisioning', async () => {
  let finish
  api.deploySetupRun.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const { rerender } = render(<DeploySetupModal {...props} />)
  await screen.findByText('Server environment')
  fireEvent.click(screen.getByText('Prepare Server & Secrets'))
  expect(screen.getByLabelText('Close')).toBeDisabled()
  expect(screen.getByLabelText('Remote base')).toBeDisabled()
  rerender(<DeploySetupModal {...props} connections={{ srv1: 'connected' }} />)
  expect(screen.getByLabelText('Server')).toHaveValue('srv1')
  finish({ success: false, error: 'retry' })
  await screen.findByRole('alert')
  expect(screen.getByLabelText('Close')).not.toBeDisabled()
})

it('shows only remaining actions and actual completed steps, with copyable instructions', async () => {
  const writeText = vi.fn().mockResolvedValue()
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  api.deploySetupRun.mockResolvedValue({ success: true, data: {
    profile: { projectName: 'Application', mode: 'private-vpn', deployUser: 'deploy-app' },
    target: preview.targets[0], nextSteps: ['Authorize the updater: sudo docker login'], completed: ['Install Compose and env'],
    assets: { files: ['/opt/app/env/server.env'], cronInstalled: true }, firstDeploy: 'not-requested',
    secrets: [{ name: 'TOKEN', value: 'sensitive-secret', description: 'Project token' }], variables: []
  } })
  render(<DeploySetupModal {...props} />)
  fireEvent.click(await screen.findByText('Prepare Server & Secrets'))
  await screen.findByText('Server preparation complete')
  expect(screen.getByLabelText('TOKEN')).toHaveValue('••••••••')
  expect(screen.getByText(/First deployment was not run/)).toBeInTheDocument()
  fireEvent.click(screen.getByText('Copy instructions'))
  expect(writeText).toHaveBeenCalledWith(expect.stringContaining('sudo docker login'))
  fireEvent.click(screen.getByText('Copy values'))
  expect(writeText).toHaveBeenCalledWith('TOKEN\nsensitive-secret')
})

it('recovers from rejected IPC promises during preview and execution', async () => {
  api.deploySetupPreview.mockRejectedValueOnce(new Error('IPC unavailable'))
  const view = render(<DeploySetupModal {...props} />)
  await screen.findByText('IPC unavailable')
  view.unmount()
  api.deploySetupRun.mockRejectedValueOnce(new Error('Connection lost'))
  render(<DeploySetupModal {...props} />)
  fireEvent.click(await screen.findByText('Prepare Server & Secrets'))
  await screen.findByText('Connection lost')
  expect(screen.getByText('Prepare Server & Secrets')).not.toBeDisabled()
})
