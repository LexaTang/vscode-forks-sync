import type { AppName, SyncMeta } from '../src/types'
import { describe, expect, it, vi } from 'vitest'
import { buildMergedSettings } from '../src/merger'

// Mock vscode and other internal modules
vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn().mockReturnValue([]),
    })),
  },
}))

vi.mock('../src/config', () => ({
  config: {},
}))

vi.mock('../src/utils', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}))

describe('per-key Merging Logic with 3 IDEs', () => {
  it('should merge independent changes from different IDEs', () => {
    const ideA: AppName = 'IDE-A'
    const ideB: AppName = 'IDE-B'
    const ideC: AppName = 'IDE-C'

    const syncMeta: SyncMeta = {
      [ideA]: {
        settingsKeys: { 'editor.fontSize': 1000 },
      },
      [ideB]: {
        settingsKeys: { 'editor.tabSize': 2000 },
      },
      [ideC]: {
        settingsKeys: { 'files.autoSave': 3000 },
      },
    }

    const snapshots = new Map<AppName, Record<string, any>>([
      [ideA, { 'editor.fontSize': 14 }],
      [ideB, { 'editor.tabSize': 2 }],
      [ideC, { 'files.autoSave': 'afterDelay' }],
    ])

    const { merged } = buildMergedSettings(syncMeta, snapshots)

    expect(merged['editor.fontSize']).toBe(14)
    expect(merged['editor.tabSize']).toBe(2)
    expect(merged['files.autoSave']).toBe('afterDelay')
  })

  it('should resolve conflicts based on latest timestamp (Winner Wins)', () => {
    const ideA: AppName = 'IDE-A'
    const ideB: AppName = 'IDE-B'

    const syncMeta: SyncMeta = {
      [ideA]: {
        settingsKeys: { 'editor.fontSize': 1000 },
      },
      [ideB]: {
        settingsKeys: { 'editor.fontSize': 2000 }, // B is newer
      },
    }

    const snapshots = new Map<AppName, Record<string, any>>([
      [ideA, { 'editor.fontSize': 12 }],
      [ideB, { 'editor.fontSize': 18 }],
    ])

    const { merged } = buildMergedSettings(syncMeta, snapshots)
    expect(merged['editor.fontSize']).toBe(18)
  })

  it('should respect tombstones (deletions) when they are newer', () => {
    const ideA: AppName = 'IDE-A'
    const ideB: AppName = 'IDE-B'

    const syncMeta: SyncMeta = {
      [ideA]: {
        settingsKeys: { 'key.to.delete': 1000 },
      },
      [ideB]: {
        settingsTombstones: { 'key.to.delete': 2000 }, // B deleted it later
      },
    }

    const snapshots = new Map<AppName, Record<string, any>>([
      [ideA, { 'key.to.delete': 'original' }],
      [ideB, {}],
    ])

    const { merged } = buildMergedSettings(syncMeta, snapshots)
    expect(merged).not.toHaveProperty('key.to.delete')
  })

  it('should recover a deleted key if an IDE updates it again even later', () => {
    const ideA: AppName = 'IDE-A'
    const ideB: AppName = 'IDE-B'

    const syncMeta: SyncMeta = {
      [ideA]: {
        settingsTombstones: { 'reborn.key': 1000 }, // A deleted at T1
      },
      [ideB]: {
        settingsKeys: { 'reborn.key': 2000 }, // B recreated at T2
      },
    }

    const snapshots = new Map<AppName, Record<string, any>>([
      [ideA, {}],
      [ideB, { 'reborn.key': 'new-life' }],
    ])

    const { merged } = buildMergedSettings(syncMeta, snapshots)
    expect(merged['reborn.key']).toBe('new-life')
  })

  it('complex 3-way interaction: A updates, B overwrites, C deletes', () => {
    const ideA: AppName = 'IDE-A'
    const ideB: AppName = 'IDE-B'
    const ideC: AppName = 'IDE-C'

    const syncMeta: SyncMeta = {
      [ideA]: { settingsKeys: { conflict: 100 } },
      [ideB]: { settingsKeys: { conflict: 200 } },
      [ideC]: { settingsTombstones: { conflict: 300 } }, // latest
    }

    const snapshots = new Map<AppName, Record<string, any>>([
      [ideA, { conflict: 'v1' }],
      [ideB, { conflict: 'v2' }],
      [ideC, {}],
    ])

    const { merged } = buildMergedSettings(syncMeta, snapshots)
    expect(merged).not.toHaveProperty('conflict')
  })

  it('complex 3-way interaction: A and B both had it, C introduces new key late', () => {
    const ideA: AppName = 'IDE-A'
    const ideB: AppName = 'IDE-B'
    const ideC: AppName = 'IDE-C'

    const syncMeta: SyncMeta = {
      [ideA]: { settingsKeys: { common: 100 } },
      [ideB]: { settingsKeys: { common: 200 } }, // winner for common
      [ideC]: { settingsKeys: { 'newly-added': 500 } }, // winner for newly-added
    }

    const snapshots = new Map<AppName, Record<string, any>>([
      [ideA, { common: 'old' }],
      [ideB, { common: 'new' }],
      [ideC, { 'newly-added': 'fresh' }],
    ])

    const { merged } = buildMergedSettings(syncMeta, snapshots)
    expect(merged.common).toBe('new')
    expect(merged['newly-added']).toBe('fresh')
  })
})
