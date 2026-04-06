import type { AppName } from '../src/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MetaRecorder } from '../src/recorder'
import { syncSettings } from '../src/sync'

// Mock Infrastructure

let remoteStorage: Record<string, string> = {}
let snapshots: Record<string, string> = {}
let localFiles: Record<string, Record<string, string>> = {}
let virtualMtimes: Record<string, number> = {}

let currentIde: AppName = 'IDE-A'

vi.mock('vscode', () => {
  return {
    Uri: {
      file: (path: string) => ({ fsPath: path, scheme: 'file', toString: () => path }),
      parse: (path: string) => ({ fsPath: path, scheme: 'file', toString: () => path }),
    },
    env: {
      get appName() { return currentIde as string },
    },
    window: {
      showInformationMessage: vi.fn(),
      showWarningMessage: vi.fn(),
      showTextDocument: vi.fn(),
    },
    workspace: {
      fs: {
        stat: vi.fn(async (uri) => {
          const path = uri.fsPath
          return { mtime: virtualMtimes[path] || 0 }
        }),
        writeFile: vi.fn(),
        readFile: vi.fn(),
      },
      openTextDocument: vi.fn(),
      getConfiguration: vi.fn(() => ({
        get: vi.fn().mockReturnValue([]),
      })),
    },
    ProgressLocation: { Notification: 1 },
  }
})

vi.mock('../src/storage', () => ({
  ensureStorageDirectory: vi.fn(),
  storageFileExists: vi.fn(async name => !!remoteStorage[name]),
  readStorageFile: vi.fn(async name => remoteStorage[name]),
  writeStorageFile: vi.fn(async (name, content) => {
    remoteStorage[name] = content
    virtualMtimes[`remote://${name}`] = Date.now()
  }),
  getStorageFileUri: vi.fn(name => ({ fsPath: `remote://${name}`, scheme: 'file', toString: () => `remote://${name}` })),
  readSettingsSnapshot: vi.fn(async ide => snapshots[ide]),
  writeSettingsSnapshot: vi.fn(async (ide, content) => { snapshots[ide] = content }),
  readAllSettingsSnapshots: vi.fn(async (ides) => {
    const map = new Map()
    for (const ide of ides) {
      if (snapshots[ide])
        map.set(ide, JSON.parse(snapshots[ide]))
    }
    return map
  }),
  getSettingsSnapshotUri: vi.fn(ide => ({ fsPath: `snapshot-${ide}.json` })),
}))

vi.mock('../src/profile', () => ({
  findConfigFile: vi.fn(async () => `local://${currentIde}/settings.json`),
  getSettings: vi.fn(async (path) => {
    const [,, ide] = path.split('/')
    return localFiles[ide]['settings.json']
  }),
  setSettings: vi.fn(async (path, content) => {
    const [,, ide] = path.split('/')
    localFiles[ide]['settings.json'] = content
    virtualMtimes[path] = Date.now()
  }),
}))

vi.mock('../src/utils', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
  findConfigFile: vi.fn(async () => `local://${currentIde}/settings.json`),
  resolveConfigFilePath: vi.fn(async (_ctx, name) => `local://${currentIde}/${name}`),
  compareFsMtime: vi.fn(async (st, lc) => {
    const tst = virtualMtimes[st] || 0
    const tlc = virtualMtimes[lc] || 0
    return tst > tlc ? 1 : (tlc > tst ? -1 : 0)
  }),
}))

vi.mock('../src/config', () => ({
  config: {
    'settings.mergeMode': 'merge',
    'settings.pokaYokeThreshold': 99,
  },
}))

vi.mock('../src/i18n', () => ({
  t: vi.fn(key => key),
}))

vi.mock('../src/extensions', () => ({
  applyExtensions: vi.fn(),
  getExtensionsPath: vi.fn(),
  getLocalExtensions: vi.fn(async () => []),
  readExtensionStorage: vi.fn(async () => null),
  writeExtensionStorage: vi.fn(),
}))

describe('e2E Sync Flow Simulation (3 IDEs)', () => {
  beforeEach(() => {
    remoteStorage = {}
    snapshots = {}
    virtualMtimes = {}
    localFiles = {
      'IDE-A': { 'settings.json': '{}' },
      'IDE-B': { 'settings.json': '{}' },
      'IDE-C': { 'settings.json': '{}' },
    }
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  it('flow: A pushes -> B pulls -> B modifies -> A pulls update', async () => {
    const recorder = new MetaRecorder()

    // 1. IDE-A pushes (T=100)
    currentIde = 'IDE-A'
    vi.setSystemTime(100)
    localFiles['IDE-A']['settings.json'] = JSON.stringify({ fontSize: 16 })
    virtualMtimes['local://IDE-A/settings.json'] = 100
    await syncSettings({} as any, recorder, { silent: true })

    // 2. IDE-B pulls (T=200)
    currentIde = 'IDE-B'
    vi.setSystemTime(200)
    await syncSettings({} as any, recorder, { silent: true })
    expect(JSON.parse(localFiles['IDE-B']['settings.json']).fontSize).toBe(16)

    // 3. IDE-B updates (T=300)
    vi.setSystemTime(300)
    localFiles['IDE-B']['settings.json'] = JSON.stringify({ fontSize: 20 })
    virtualMtimes['local://IDE-B/settings.json'] = 300
    await syncSettings({} as any, recorder, { silent: true })

    // 4. IDE-A pulls update (T=400)
    currentIde = 'IDE-A'
    vi.setSystemTime(400)
    await syncSettings({} as any, recorder, { silent: true })
    expect(JSON.parse(localFiles['IDE-A']['settings.json']).fontSize).toBe(20)
  })

  it('flow: conflict Resolution (B wins by being later)', async () => {
    const recorder = new MetaRecorder()

    // Use current logic to initialize
    remoteStorage['settings.json'] = JSON.stringify({ key: 'val1' })
    remoteStorage['vscode-forks-sync.json'] = JSON.stringify({ 'IDE-Base': { settingsKeys: { key: 10 } } })
    virtualMtimes['remote://settings.json'] = 10
    snapshots['IDE-Base'] = JSON.stringify({ key: 'val1' })

    // IDE-A pull
    currentIde = 'IDE-A'
    await syncSettings({} as any, recorder, { silent: true })
    // IDE-B pull
    currentIde = 'IDE-B'
    await syncSettings({} as any, recorder, { silent: true })

    // A updates at T=500
    vi.setSystemTime(500)
    currentIde = 'IDE-A'
    localFiles['IDE-A']['settings.json'] = JSON.stringify({ key: 'val-A' })
    virtualMtimes['local://IDE-A/settings.json'] = 500
    await syncSettings({} as any, recorder, { silent: true })

    // B updates at T=1000
    vi.setSystemTime(1000)
    currentIde = 'IDE-B'
    localFiles['IDE-B']['settings.json'] = JSON.stringify({ key: 'val-B' })
    virtualMtimes['local://IDE-B/settings.json'] = 1000
    await syncSettings({} as any, recorder, { silent: true })

    // A pulls update (T=1500)
    vi.setSystemTime(1500)
    currentIde = 'IDE-A'
    await syncSettings({} as any, recorder, { silent: true })
    expect(JSON.parse(localFiles['IDE-A']['settings.json']).key).toBe('val-B')
  })
})
