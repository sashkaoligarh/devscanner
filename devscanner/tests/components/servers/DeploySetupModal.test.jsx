import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import DeploySetupModal from '../../../src/components/servers/DeploySetupModal'
const api = vi.hoisted(() => ({ deploySetupPreview: vi.fn(), deploySetupState: vi.fn(), deploySetupSaveDraft: vi.fn(), deploySetupRun: vi.fn(), deploySetupCheck: vi.fn(), deploySetupImportEnv: vi.fn(), deploySetupGenerateEnv: vi.fn(), onDeployLog: vi.fn(), deployAssistantSettings: vi.fn(), deployAssistantHistory: vi.fn(), deployAssistantRun: vi.fn(), deployAssistantCancel: vi.fn(), onDeployAssistantProgress: vi.fn() }))
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
  api.deploySetupState.mockResolvedValue({ success: true, data: null })
  api.deploySetupSaveDraft.mockResolvedValue({ success: true, data: {} })
  api.onDeployLog.mockReturnValue(vi.fn())
  api.deploySetupImportEnv.mockResolvedValue({ success: true, data: { POSTGRES_PASSWORD: 'imported-password' } })
  api.deployAssistantSettings.mockResolvedValue({ success: true, data: { model: '', apiKeySaved: false } })
  api.deployAssistantHistory.mockResolvedValue({ success: true, data: [] })
  api.deployAssistantCancel.mockResolvedValue({ success: true })
  api.onDeployAssistantProgress.mockReturnValue(vi.fn())
})
afterEach(cleanup)
const ready = () => waitFor(() => expect(screen.getByLabelText('Server')).not.toBeDisabled())

function savedResult(status = 'failed') {
  return {
    profile: { id: 'saved', projectPath: props.project.path, projectName: 'Application', serverId: 'srv1', targetId: 'publish', mode: 'private-vpn', status, deployUser: 'deploy-app', remoteBase: '/opt/app', automation: status === 'prepared' ? 'enabled' : 'disabled', updatedAt: '2026-09-12T12:00:00Z', completed: ['Install deploy SSH key', 'Read SSH host keys'] },
    target: preview.targets[0], nextSteps: ['Retry certificate renewal'], completed: ['Install deploy SSH key', 'Read SSH host keys'],
    assets: { files: [], cronInstalled: status === 'prepared' }, firstDeploy: 'not-requested', keySaved: true,
    secrets: [{ name: 'SSH_PRIVATE_KEY', value: 'saved-key-value', description: 'Deploy key' }], variables: [],
    serverAccess: { host: 'server.test', username: 'deploy-app', port: 22, privateKey: 'saved-key-value' }
  }
}

it('keeps credentials copyable after failure and restores them when the dialog is reopened', async () => {
  const writeText = vi.fn().mockResolvedValue()
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  const result = savedResult(), state = { profile: { ...result.profile, error: 'Renewal timed out' }, input: { tlsMode: 'certbot', certbotEmail: 'saved@app.test' }, result, logs: ['Key installed'] }
  api.deploySetupRun.mockResolvedValueOnce({ success: false, error: 'Renewal timed out', completed: result.completed, state })
  const view = render(<DeploySetupModal {...props} />)
  await screen.findByText('Prepare server'); await ready()
  fireEvent.click(screen.getByText('Prepare server'))
  await screen.findByText('Saved preparation progress')
  expect(screen.getByLabelText('SSH_PRIVATE_KEY')).toHaveValue('••••••••')
  fireEvent.click(screen.getByLabelText('Copy SSH_PRIVATE_KEY'))
  expect(writeText).toHaveBeenCalledWith('saved-key-value')
  fireEvent.click(screen.getByLabelText('Close'))
  await waitFor(() => expect(props.onClose).toHaveBeenCalled())
  expect(api.deploySetupSaveDraft).toHaveBeenCalledWith(expect.objectContaining({ serverId: 'srv1', projectPath: props.project.path }))
  view.unmount()
  api.deploySetupState.mockResolvedValueOnce({ success: true, data: state })
  render(<DeploySetupModal {...props} />)
  await screen.findByText('Saved preparation progress')
  expect(screen.getByLabelText('SSH_PRIVATE_KEY')).toHaveValue('••••••••')
  expect(api.deploySetupRun).toHaveBeenCalledTimes(1)
})

it('opens the saved successful server result without preparing again and allows editing its saved inputs', async () => {
  const result = savedResult('prepared')
  api.deploySetupPreview.mockResolvedValueOnce({ success: true, data: { ...preview, profiles: [result.profile] } })
  api.deploySetupState.mockResolvedValueOnce({ success: true, data: { profile: result.profile, input: { remoteBase: '/opt/saved-app', envValues: { POSTGRES_PASSWORD: 'saved-env-value' } }, result } })
  render(<DeploySetupModal {...props} connections={{ srv2: 'connected' }} servers={[...props.servers, { id: 'srv2', name: 'Other' }]} />)
  await screen.findByText('Server preparation complete')
  expect(api.deploySetupState).toHaveBeenLastCalledWith(expect.objectContaining({ serverId: 'srv1' }))
  expect(api.deploySetupRun).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText('Edit setup'))
  fireEvent.click(screen.getByRole('tab', { name: 'Advanced' }))
  expect(screen.getByLabelText('Remote base')).toHaveValue('/opt/saved-app')
  fireEvent.click(screen.getByRole('tab', { name: 'Environment' }))
  expect(screen.getByLabelText('POSTGRES_PASSWORD *')).toHaveValue('saved-env-value')
})

it('keeps the form open if saving a draft fails', async () => {
  render(<DeploySetupModal {...props} />)
  await screen.findByText('Prepare server'); await ready()
  api.deploySetupSaveDraft.mockResolvedValueOnce({ success: false, error: 'Disk is full' })
  fireEvent.click(screen.getByLabelText('Close'))
  await screen.findByText('Disk is full')
  expect(props.onClose).not.toHaveBeenCalled()
})

it('offers HTTP without certificates and permits switching back to manual TLS later', async () => {
  api.deploySetupPreview.mockResolvedValueOnce({ success: true, data: { ...preview, nginxFile: 'deploy/nginx.conf' } })
  api.deploySetupRun.mockResolvedValueOnce({ success: false, error: 'fixture stop' })
  render(<DeploySetupModal {...props} />)
  await screen.findByLabelText('TLS certificate')
  await ready()
  fireEvent.click(screen.getByLabelText('TLS certificate'))
  fireEvent.click(screen.getByRole('option', { name: 'No certificate — HTTP only' }))
  expect(screen.getByLabelText('Domain or server IP (optional)')).toBeInTheDocument()
  expect(screen.queryByLabelText('Let’s Encrypt account email')).not.toBeInTheDocument()
  fireEvent.click(screen.getByText('Prepare server'))
  await screen.findByText('fixture stop')
  expect(api.deploySetupRun).toHaveBeenLastCalledWith(expect.objectContaining({ tlsMode: 'none', configureNginx: true, certbotAgree: false, domain: '' }))
  fireEvent.click(screen.getByRole('tab', { name: 'Advanced' }))
  expect(screen.queryByLabelText('Certificate PEM')).not.toBeInTheDocument()
  fireEvent.click(screen.getByLabelText('TLS certificate'))
  fireEvent.click(screen.getByRole('option', { name: 'Install certificate manually (PEM)' }))
  expect(screen.getByLabelText('Certificate PEM')).toBeInTheDocument()
})

it('selects Certbot with shared controls and submits its email and terms without requiring PEM fields', async () => {
  api.deploySetupPreview.mockResolvedValueOnce({ success: true, data: { ...preview, nginxFile: 'deploy/nginx.conf' } })
  api.deploySetupRun.mockResolvedValueOnce({ success: false, error: 'fixture stop' })
  render(<DeploySetupModal {...props} />)
  await screen.findByLabelText('TLS certificate')
  await ready()
  fireEvent.click(screen.getByLabelText('TLS certificate'))
  fireEvent.click(screen.getByRole('option', { name: 'Let’s Encrypt — automatic renewal' }))
  fireEvent.change(screen.getByLabelText('Let’s Encrypt account email'), { target: { value: 'admin@app.test' } })
  fireEvent.click(screen.getByLabelText('I accept the Let’s Encrypt subscriber agreement'))
  fireEvent.click(screen.getByText('Prepare server'))
  await screen.findByText('fixture stop')
  expect(api.deploySetupRun).toHaveBeenLastCalledWith(expect.objectContaining({ tlsMode: 'certbot', certbotEmail: 'admin@app.test', certbotAgree: true, sslCert: '', sslKey: '' }))
  fireEvent.click(screen.getByRole('tab', { name: 'Advanced' }))
  expect(screen.queryByLabelText('Certificate PEM')).not.toBeInTheDocument()
})

it('applies Codex suggestions to the current form and checks the actual proposed values before deployment', async () => {
  api.deployAssistantRun.mockResolvedValueOnce({ success: true, data: { id: 'proposal-1', summary: 'Use another host port', findings: [], portOverrides: { 'frontend:0': 4322 }, changes: [{ field: 'port', key: 'cms:0', value: '1400', reason: 'Free port' }] } })
  api.deploySetupCheck.mockResolvedValueOnce({ success: true, data: { blocked: false, ports: [], issues: [], tlsIssues: [], portOverrides: { 'cms:0': 1400, 'frontend:0': 4322 } } })
  api.deploySetupRun.mockResolvedValueOnce({ success: false, error: 'fixture stop' })
  render(<DeploySetupModal {...props} />)
  fireEvent.click(await screen.findByRole('tab', { name: 'Codex' }))
  fireEvent.click(screen.getByText('Analyze deployment'))
  fireEvent.click(await screen.findByText('Apply to form and check'))
  await screen.findByText('No port or TLS conflicts found.')
  expect(api.deploySetupCheck).toHaveBeenLastCalledWith(expect.objectContaining({ portOverrides: { 'cms:0': 1400, 'frontend:0': 4322 }, assistantProposalId: 'proposal-1' }))
  expect(api.deploySetupRun).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText('Prepare server'))
  await screen.findByText('fixture stop')
  expect(api.deploySetupRun).toHaveBeenLastCalledWith(expect.objectContaining({ assistantProposalId: 'proposal-1', portOverrides: { 'cms:0': 1400, 'frontend:0': 4322 } }))
})

it('keeps Stop enabled while Codex locks deployment inputs and recovers after cancellation', async () => {
  let finish
  api.deployAssistantRun.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  render(<DeploySetupModal {...props} />)
  fireEvent.click(await screen.findByRole('tab', { name: 'Codex' }))
  fireEvent.click(screen.getByText('Analyze deployment'))
  expect(screen.getByText('Prepare server')).toBeDisabled()
  expect(screen.getByLabelText('Close')).toBeDisabled()
  expect(screen.getByText('Stop')).not.toBeDisabled()
  fireEvent.click(screen.getByText('Stop'))
  expect(api.deployAssistantCancel).toHaveBeenCalledWith({ serverId: 'srv1' })
  finish({ success: false, error: 'Diagnosis cancelled' })
  await screen.findByText('Diagnosis cancelled')
  expect(screen.getByText('Prepare server')).not.toBeDisabled()
})

const conflictReport = {
  blocked: true, issues: [], tlsIssues: [], missingEnv: [], portOverrides: {},
  ports: [{ id: 'cms:0', service: 'cms', kind: 'container', address: '127.0.0.1', port: 1337, originalPort: 1337, target: 1337, protocol: 'tcp', editable: true, conflicts: ['Docker existing-cms'], suggestedPort: 1338 }]
}

it('checks without deploying, applies suggested ports and submits a manual host-port choice', async () => {
  api.deploySetupCheck.mockResolvedValueOnce({ success: true, data: conflictReport }).mockResolvedValueOnce({ success: true, data: {
    ...conflictReport, blocked: false, portOverrides: { 'cms:0': 1338 }, ports: [{ ...conflictReport.ports[0], port: 1338, conflicts: [], suggestedPort: undefined }]
  } })
  api.deploySetupRun.mockResolvedValue({ success: false, error: 'fixture stop' })
  render(<DeploySetupModal {...props} />)
  fireEvent.click(await screen.findByText('Check server'))
  await screen.findByText(/Docker existing-cms/)
  expect(api.deploySetupRun).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText('Use suggested ports'))
  await screen.findByText('No port or TLS conflicts found.')
  expect(api.deploySetupCheck).toHaveBeenLastCalledWith(expect.objectContaining({ portOverrides: { 'cms:0': 1338 } }))
  expect(screen.getByLabelText('cms host port')).toHaveValue(1338)
  fireEvent.change(screen.getByLabelText('cms host port'), { target: { value: '1400' } })
  expect(screen.getByText(/Port choices changed/)).toBeInTheDocument()
  fireEvent.click(screen.getByText('Prepare server'))
  await screen.findByText('fixture stop')
  expect(api.deploySetupRun).toHaveBeenLastCalledWith(expect.objectContaining({ portOverrides: { 'cms:0': '1400' } }))
})

it('shows conflicts returned by Prepare and opens TLS inputs without clearing entered env values', async () => {
  api.deploySetupPreview.mockResolvedValueOnce({ success: true, data: { ...preview, nginxFile: 'deploy/nginx.conf' } })
  api.deploySetupRun.mockResolvedValueOnce({ success: false, error: 'TLS file missing', completed: ['Validate server environment'], preflight: { ...conflictReport, tlsIssues: ['TLS certificate /etc/nginx/certs/app.crt: file is missing'] } })
  render(<DeploySetupModal {...props} />)
  await screen.findByRole('tab', { name: 'Environment' })
  await ready()
  fireEvent.click(screen.getByRole('tab', { name: 'Environment' }))
  fireEvent.change(screen.getByLabelText('POSTGRES_PASSWORD *'), { target: { value: 'keep-this-value' } })
  fireEvent.click(screen.getByText('Prepare server'))
  fireEvent.click(await screen.findByText('Configure TLS'))
  expect(screen.getByText('TLS certificate and key').parentElement).toHaveAttribute('open')
  expect(screen.getByLabelText('Certificate PEM')).toBeVisible()
  fireEvent.click(screen.getByRole('tab', { name: 'Environment' }))
  expect(screen.getByLabelText('POSTGRES_PASSWORD *')).toHaveValue('keep-this-value')
})

it('locks the selected server while checking and discards the report and choices when the server changes', async () => {
  let finish
  api.deploySetupCheck.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  render(<DeploySetupModal {...props} servers={[...props.servers, { id: 'srv2', name: 'Other server' }]} />)
  fireEvent.click(await screen.findByText('Check server'))
  expect(screen.getByLabelText('Server')).toBeDisabled()
  expect(screen.getByLabelText('Close')).toBeDisabled()
  finish({ success: true, data: conflictReport })
  await screen.findByText(/Docker existing-cms/)
  fireEvent.change(screen.getByLabelText('cms host port'), { target: { value: '1400' } })
  fireEvent.click(screen.getByLabelText('Server'))
  fireEvent.click(screen.getByRole('option', { name: 'Other server' }))
  await ready()
  expect(screen.queryByLabelText('cms host port')).not.toBeInTheDocument()
  api.deploySetupRun.mockResolvedValueOnce({ success: false, error: 'fixture stop' })
  fireEvent.click(screen.getByText('Prepare server'))
  await screen.findByText('fixture stop')
  expect(api.deploySetupRun).toHaveBeenLastCalledWith(expect.objectContaining({ serverId: 'srv2', portOverrides: null }))
})

it('imports env, keeps sensitive fields masked, and submits a concrete full setup', async () => {
  api.deploySetupRun.mockResolvedValue({ success: false, error: 'test failure', completed: ['Prepare user'] })
  render(<DeploySetupModal {...props} />)
  await screen.findByRole('tab', { name: 'Environment' })
  await ready()
  fireEvent.click(screen.getByRole('tab', { name: 'Environment' }))
  await screen.findByText('Server environment')
  fireEvent.click(screen.getByLabelText('Local env file'))
  fireEvent.click(screen.getByRole('option', { name: 'cms/.env' }))
  fireEvent.click(screen.getByText('Import env'))
  await waitFor(() => expect(screen.getByLabelText('POSTGRES_PASSWORD *')).toHaveValue('imported-password'))
  expect(screen.getByLabelText('POSTGRES_PASSWORD *')).toHaveAttribute('type', 'password')
  fireEvent.click(screen.getByText('Prepare server'))
  await screen.findByRole('alert')
  expect(api.deploySetupRun).toHaveBeenCalledWith(expect.objectContaining({ serverId: 'srv1', targetId: 'publish', mode: 'private-vpn', installCron: true, overwriteEnv: false, envValues: { POSTGRES_PASSWORD: 'imported-password' } }))
  expect(screen.getByText(/Completed before the error/)).toHaveTextContent('Prepare user')
})

it('keeps the dialog and selected server stable while provisioning', async () => {
  let finish
  api.deploySetupRun.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const servers = [...props.servers, { id: 'srv2', name: 'Production' }]
  const { rerender } = render(<DeploySetupModal {...props} servers={servers} />)
  await screen.findByLabelText('Server')
  await ready()
  fireEvent.click(screen.getByLabelText('Server'))
  fireEvent.click(screen.getByRole('option', { name: 'Production' }))
  await ready()
  fireEvent.click(screen.getByRole('tab', { name: 'Advanced' }))
  fireEvent.change(screen.getByLabelText('Remote base'), { target: { value: '/opt/production' } })
  fireEvent.click(screen.getByText('Prepare server'))
  expect(screen.getByLabelText('Close')).toBeDisabled()
  expect(screen.getByLabelText('Remote base')).toBeDisabled()
  expect(screen.getByRole('tab', { name: 'Deployment' })).toBeDisabled()
  rerender(<DeploySetupModal {...props} servers={servers} connections={{ srv1: 'connected' }} />)
  expect(api.deploySetupRun).toHaveBeenCalledWith(expect.objectContaining({ serverId: 'srv2', remoteBase: '/opt/production' }))
  finish({ success: false, error: 'retry' })
  await screen.findByRole('alert')
  expect(screen.getByLabelText('Close')).not.toBeDisabled()
  fireEvent.click(screen.getByRole('tab', { name: 'Deployment' }))
  expect(screen.getByLabelText('Server')).toHaveTextContent('Production')
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
  fireEvent.click(await screen.findByText('Prepare server'))
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
  fireEvent.click(await screen.findByText('Prepare server'))
  await screen.findByText('Connection lost')
  expect(screen.getByText('Prepare server')).not.toBeDisabled()
})

it('selects the deployment profile and exact workflow through the shared dropdowns', async () => {
  api.deploySetupPreview.mockResolvedValueOnce({ success: true, data: {
    ...preview, mode: 'github-direct',
    targets: [
      { id: 'ua', type: 'ansible', label: 'Production UA', playbook: 'deployment/prod.yml', secrets: ['INVENTORY_UA'] },
      { id: 'nl', type: 'ansible', label: 'Production NL', playbook: 'deployment/prod.yml', secrets: ['INVENTORY_NL'] },
    ]
  } })
  api.deploySetupRun.mockResolvedValue({ success: false, error: 'test failure' })
  render(<DeploySetupModal {...props} />)
  await screen.findByLabelText('Workflow / target')
  await ready()
  fireEvent.click(screen.getByLabelText('Workflow / target'))
  fireEvent.click(screen.getByRole('option', { name: 'Production NL' }))
  await ready()
  expect(screen.queryByRole('tab', { name: 'Environment' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByLabelText('Deployment profile'))
  fireEvent.click(screen.getByRole('option', { name: 'Server pulls images' }))
  await ready()
  fireEvent.click(screen.getByRole('tab', { name: 'Environment' }))
  fireEvent.change(screen.getByLabelText('POSTGRES_PASSWORD *'), { target: { value: 'existing-secret' } })
  fireEvent.click(screen.getByRole('tab', { name: 'Deployment' }))
  fireEvent.click(screen.getByLabelText('Deployment profile'))
  fireEvent.click(screen.getByRole('option', { name: 'GitHub → server' }))
  await ready()
  fireEvent.click(screen.getByText('Prepare server'))
  await screen.findByRole('alert')
  expect(api.deploySetupRun).toHaveBeenCalledWith(expect.objectContaining({ mode: 'github-direct', targetId: 'nl', envValues: { POSTGRES_PASSWORD: 'existing-secret' } }))
})

it('filters long environment forms without losing edited values across tabs', async () => {
  api.deploySetupPreview.mockResolvedValueOnce({ success: true, data: {
    ...preview,
    envFields: [...preview.envFields, ...Array.from({ length: 8 }, (_, i) => ({ key: `OPTIONAL_${i}`, value: '', sensitive: false }))]
  } })
  render(<DeploySetupModal {...props} />)
  await screen.findByRole('tab', { name: 'Environment' })
  await ready()
  fireEvent.click(screen.getByRole('tab', { name: 'Environment' }))
  fireEvent.change(screen.getByLabelText('POSTGRES_PASSWORD *'), { target: { value: 'my-secret' } })
  fireEvent.change(screen.getByLabelText('Filter variables'), { target: { value: 'optional' } })
  expect(screen.queryByLabelText('POSTGRES_PASSWORD *')).not.toBeInTheDocument()
  expect(screen.getByLabelText('OPTIONAL_0')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('tab', { name: 'Deployment' }))
  fireEvent.click(screen.getByRole('tab', { name: 'Environment' }))
  fireEvent.change(screen.getByLabelText('Filter variables'), { target: { value: 'postgres' } })
  expect(screen.getByLabelText('POSTGRES_PASSWORD *')).toHaveValue('my-secret')
  expect(screen.getByLabelText('POSTGRES_PASSWORD *')).toHaveAttribute('type', 'password')
})
