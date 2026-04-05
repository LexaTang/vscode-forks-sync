import type { ExtensionContext, FileSystemWatcher, Uri } from 'vscode'
import type { MetaRecorder } from './recorder'
import type { AppName, SyncType } from './types'
import { env, extensions, workspace } from 'vscode'
import { APP_NAMES } from './constants'
import {
  getLocalExtensions,
  readExtensionStorage,
  writeExtensionStorage,
} from './extensions'
import {
  buildMergedSettings,
  diffSettingsKeys,
  filterSettingsKeys,
  parseSettings,
  stringifySettings,
} from './merger'
import { getKeybindings, getSettings } from './profile'
import {
  ensureStorageDirectory,
  readAllSettingsSnapshots,
  readSettingsSnapshot,
  writeSettingsSnapshot,
  writeStorageFile,
} from './storage'
import { findConfigFile, logger } from './utils'

export class ConfigWatcher {
  private ctx: ExtensionContext
  private recorder: MetaRecorder
  private keybindingsWatcher?: FileSystemWatcher
  private debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()
  private suppressions: Record<SyncType, number> = {
    settings: 0,
    keybindings: 0,
    extensions: 0,
  }

  private prevSettingsRaw?: string
  private prevKeybindingsRaw?: string

  constructor(ctx: ExtensionContext, recorder: MetaRecorder) {
    this.ctx = ctx
    this.recorder = recorder
  }

  rememberContent(type: 'settings' | 'keybindings', raw: string): void {
    if (type === 'settings')
      this.prevSettingsRaw = raw
    else
      this.prevKeybindingsRaw = raw
  }

  async runWithSuppressed(type: SyncType, fn: () => Promise<void>): Promise<void> {
    this.suppressions[type] += 1
    try {
      await fn()
    }
    finally {
      this.suppressions[type] = Math.max(0, this.suppressions[type] - 1)
    }
  }

  private isSuppressed(type: SyncType): boolean {
    return this.suppressions[type] > 0
  }

  async start(): Promise<void> {
    await this.primeKnownContent()
    this.watchSettings()
    this.watchExtensions()
    await this.watchKeybindings()
    logger.info('Config watcher started')
  }

  dispose(): void {
    this.keybindingsWatcher?.dispose()
    this.debounceTimers.forEach(t => clearTimeout(t))
    this.debounceTimers.clear()
    logger.info('Config watcher disposed')
  }

  private async primeKnownContent(): Promise<void> {
    const [settingsPath, keybindingsPath] = await Promise.all([
      findConfigFile(this.ctx, 'settings.json'),
      findConfigFile(this.ctx, 'keybindings.json'),
    ])

    if (settingsPath)
      this.prevSettingsRaw = await getSettings(settingsPath)

    if (keybindingsPath)
      this.prevKeybindingsRaw = await getKeybindings(keybindingsPath)
  }

  private watchSettings(): void {
    const disposable = workspace.onDidChangeConfiguration(() => {
      if (this.isSuppressed('settings'))
        return

      this.debounce('settings', async () => {
        try {
          const currentIde = env.appName as AppName
          const settingsPath = await findConfigFile(this.ctx, 'settings.json')
          if (!settingsPath)
            return

          const raw = await getSettings(settingsPath)
          if (!raw || raw === this.prevSettingsRaw)
            return

          await ensureStorageDirectory()

          const currentSettings = parseSettings(raw)
          const previousSnapshot = parseSettings((await readSettingsSnapshot(currentIde)) ?? '{}')
          const changes = diffSettingsKeys(previousSnapshot, currentSettings)

          if (changes.upserted.length === 0 && changes.deleted.length === 0) {
            this.prevSettingsRaw = raw
            return
          }

          const filteredCurrent = filterSettingsKeys(currentSettings)
          const timestamp = Date.now()

          await this.recorder.applySettingsChanges(changes, timestamp, currentIde)
          await writeSettingsSnapshot(currentIde, stringifySettings(filteredCurrent))

          const merged = buildMergedSettings(
            await this.recorder.readAll(),
            await readAllSettingsSnapshots(APP_NAMES),
          )
          await writeStorageFile('settings.json', stringifySettings(merged))
          await this.recorder.updateMtime('settings', currentIde, timestamp)
          this.prevSettingsRaw = raw

          logger.info(`Watcher: settings synced to storage (${changes.upserted.length} updated, ${changes.deleted.length} deleted)`)
        }
        catch (error) {
          logger.error('Watcher: failed to sync settings', error)
        }
      })
    })
    this.ctx.subscriptions.push(disposable)
  }

  private watchExtensions(): void {
    const disposable = extensions.onDidChange(() => {
      if (this.isSuppressed('extensions')) {
        logger.info('Watcher: skipping extension sync (currently syncing)')
        return
      }

      this.debounce('extensions', async () => {
        try {
          const currentIde = env.appName as AppName
          const localIds = await getLocalExtensions()
          const existing = await readExtensionStorage()
          await writeExtensionStorage(currentIde, localIds, existing)
          await this.recorder.updateMtime('extensions')
          logger.info('Watcher: extensions synced to storage')
        }
        catch (error) {
          logger.error('Watcher: failed to sync extensions', error)
        }
      })
    })
    this.ctx.subscriptions.push(disposable)
  }

  private async watchKeybindings(): Promise<void> {
    const keybindingsPath = await findConfigFile(this.ctx, 'keybindings.json')
    if (!keybindingsPath) {
      logger.warn('Watcher: keybindings file not found, skipping')
      return
    }

    this.keybindingsWatcher = workspace.createFileSystemWatcher(keybindingsPath)
    this.keybindingsWatcher.onDidChange(async (_uri: Uri) => {
      if (this.isSuppressed('keybindings'))
        return

      this.debounce('keybindings', async () => {
        try {
          const content = await getKeybindings(keybindingsPath)
          if (content === this.prevKeybindingsRaw)
            return

          await ensureStorageDirectory()
          await writeStorageFile('keybindings.json', content)
          await this.recorder.updateMtime('keybindings')
          this.prevKeybindingsRaw = content
          logger.info('Watcher: keybindings synced to storage')
        }
        catch (error) {
          logger.error('Watcher: failed to sync keybindings', error)
        }
      })
    })

    this.ctx.subscriptions.push(this.keybindingsWatcher)
  }

  private debounce(key: string, fn: () => Promise<void>, delay = 500): void {
    const existing = this.debounceTimers.get(key)
    if (existing)
      clearTimeout(existing)

    const timer = setTimeout(async () => {
      await fn()
      this.debounceTimers.delete(key)
    }, delay)

    this.debounceTimers.set(key, timer)
  }
}
