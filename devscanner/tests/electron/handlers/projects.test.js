// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import Module from 'module'
import { privateProject, directProject, write } from '../../fixtures/deploy-project'

const { analyzeProject } = require('../../../electron/utils/analysis')
const { detectDeploySetup } = require('../../../electron/utils/deploy-setup')
const originalLoad = Module._load
let registerProjectsHandlers
try {
  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return { dialog: {} }
    if (request === '../utils/settings-store') return { loadSettings: () => ({}), saveSettings: vi.fn() }
    if (request === '../utils/app-log') return { logError: vi.fn(), startTimer: () => vi.fn() }
    return originalLoad.apply(this, arguments)
  }
  ;({ registerProjectsHandlers } = require('../../../electron/handlers/projects'))
} finally {
  Module._load = originalLoad
}

let root, scan
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'devscanner-scan-'))
  const handlers = {}
  registerProjectsHandlers({ handle: (name, handler) => { handlers[name] = handler } }, {})
  scan = (folder = root) => handlers['scan-folder'](null, folder)
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

function nodeProject(relativePath) {
  write(root, relativePath + '/package.json', JSON.stringify({ scripts: { dev: 'vite' } }))
  return path.join(root, relativePath)
}

describe('scanning categorized projects', () => {
  it('returns actual monolith and solo roots and resolves deployment files from those roots', async () => {
    const vpn = path.join(root, 'kr/kpcep')
    privateProject(vpn)
    nodeProject('kr/kpcep/cms')
    nodeProject('kr/kpcep/frontend')
    const direct = nodeProject('ocp/strapi-astro-monolith')
    directProject(direct)
    nodeProject('ocp/strapi-astro-monolith/backend')
    nodeProject('ocp/strapi-astro-monolith/frontend')
    const solo = nodeProject('pets/solo')

    const result = await scan()
    expect(result.success).toBe(true)
    expect(result.data.map(project => project.path)).toEqual([vpn, direct, solo])
    expect(result.data.map(project => project.relativePath)).toEqual(['kr/kpcep', 'ocp/strapi-astro-monolith', 'pets/solo'])
    expect(result.data[0].subprojects.map(project => project.name)).toEqual(['cms', 'frontend'])
    expect(result.data[1].subprojects.map(project => project.name)).toEqual(['backend', 'frontend'])
    expect(analyzeProject(path.join(root, 'kr'))).toBeNull()
    expect(analyzeProject(path.join(root, 'ocp'))).toBeNull()
    expect(detectDeploySetup(result.data[0].path)).toMatchObject({ projectName: 'kpcep', mode: 'private-vpn', composeFile: 'deploy/stack.yml' })
    expect(detectDeploySetup(result.data[1].path).targets).toHaveLength(2)
  })

  it('handles nested categories and identical project names without merging them', async () => {
    const first = nodeProject('work/customer/web/app')
    const second = nodeProject('personal/app')
    const { data } = await scan()
    expect(data.map(project => project.path).sort()).toEqual([first, second].sort())
    expect(data.map(project => project.relativePath).sort()).toEqual(['personal/app', 'work/customer/web/app'])
  })

  it('scans direct children and a selected solo project itself', async () => {
    const solo = nodeProject('solo')
    expect((await scan()).data.map(project => project.path)).toEqual([solo])
    expect((await scan(solo)).data).toMatchObject([{ path: solo, relativePath: 'solo' }])
  })

  it('keeps a Git repository with its application in a subfolder as one deployable project', async () => {
    write(root, 'pets/devlib/.git/HEAD', 'ref: refs/heads/main\n')
    nodeProject('pets/devlib/devscanner')
    const projectPath = path.join(root, 'pets/devlib')
    const { data } = await scan(projectPath)
    expect(data).toHaveLength(1)
    expect(data[0]).toMatchObject({ path: projectPath, name: 'devlib', type: 'monorepo', git: { branch: 'main' } })
    expect(data[0].subprojects.map(project => project.name)).toEqual(['devscanner'])
  })

  it('recognizes a Git worktree root and workspace configuration without a root package manifest', async () => {
    write(root, 'work/tree/.git', 'gitdir: ../../.git/worktrees/tree\n')
    write(root, 'work/workspace/pnpm-workspace.yaml', 'packages:\n  - packages/*\n')
    nodeProject('work/tree/app')
    nodeProject('work/workspace/packages/one')
    nodeProject('work/workspace/packages/two')
    expect((await scan()).data.map(project => project.relativePath)).toEqual(['work/tree', 'work/workspace'])
  })

  it.each([
    ['frontend', 'backend'],
    ['frontend', 'cms'],
    ['council-front', 'council-backend'],
  ])('keeps an unversioned %s/%s monolith together', async (frontend, backend) => {
    nodeProject('work/monolith/' + frontend)
    nodeProject('work/monolith/' + backend)
    expect((await scan()).data).toMatchObject([{ relativePath: 'work/monolith', type: 'monorepo' }])
    expect((await scan()).data).toHaveLength(1)
  })

  it('does not merge unrelated component names or arbitrary sibling projects', async () => {
    nodeProject('work/first-frontend')
    nodeProject('work/second-backend')
    nodeProject('personal/alpha')
    nodeProject('personal/beta')
    expect((await scan()).data.map(project => project.relativePath)).toEqual([
      'personal/alpha', 'personal/beta', 'work/first-frontend', 'work/second-backend'
    ])
  })

  it('excludes generated and hidden tooling directories from roots and monolith components', async () => {
    for (const dir of ['node_modules', 'dist', 'release', '.opencode', '.kilo']) {
      nodeProject(dir + '/generated')
      nodeProject('work/app/' + dir)
    }
    write(root, 'work/app/.git/HEAD', 'ref: refs/heads/main\n')
    nodeProject('work/app/frontend')
    const { data } = await scan()
    expect(data.map(project => project.relativePath)).toEqual(['work/app'])
    expect(data[0].subprojects.map(project => project.name)).toEqual(['frontend'])
  })

  it('skips broken symlinks and cycles, returning an aliased project only once', async () => {
    const projectPath = nodeProject('work/app')
    fs.symlinkSync(root, path.join(root, 'work/loop'), 'dir')
    fs.symlinkSync(path.join(root, 'missing'), path.join(root, 'work/broken'), 'dir')
    fs.symlinkSync(projectPath, path.join(root, 'work/z-alias'), 'dir')
    expect((await scan()).data.map(project => project.relativePath)).toEqual(['work/app'])
  })

  it('returns an error for a missing scan root and an empty list for an empty folder', async () => {
    expect(await scan(path.join(root, 'missing'))).toMatchObject({ success: false, error: 'Folder not found or inaccessible' })
    expect(await scan()).toEqual({ success: true, data: [] })
  })
})
