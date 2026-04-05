import type { ExtensionContext, FileSystemWatcher, Uri } from 'vscode'
import type { MetaRecorder } from './recorder'
import { extensions, workspace } from 'vscode'
import { codeName } from './config'
import { diffSettingsKeys, parseSettings, stringifySettings } from './merger'
import { getKeybindings, getSettings } from './profile'
import {
  getLocalExtensions,
  readExtensionStorage,
  writeExtensionStorage,
} from './extensions'
import { readStorageFile, storageFileExists, writeStorageFile } from './storage'
import { findConfigFile, logger } from './utils'
import type { AppName } from './types'
import { env } from 'vscode'

export class ConfigWatcher {
  private ctx: ExtensionContext
  private recorder: MetaRecorder
  private keybindingsWatcher?: FileSystemWatcher
  private debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()
  private prevSettingsRaw?: string
  private isSyncingExtensions: boolean = false

  constructor(ctx: ExtensionContext, recorder: MetaRecorder) {
    this.ctx = ctx
    this.recorder = recorder
  }

  setSyncingExtensions(value: boolean): void {
    this.isSyncingExtensions = value
  }

  async start(): Promise<void> {
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

  // ─── Settings watcher ──────────────────────────────────────────────────────

  private watchSettings(): void {
    const disposable = workspace.onDidChangeConfiguration(() => {
      this.debounce('settings', async () => {
        try {
          const settingsPath = await findConfigFile(this.ctx, 'settings.json')
          if (!settingsPath)
            return

          const raw = await getSettings(settingsPath)
          if (!raw || raw === this.prevSettingsRaw)
            return

          const hasStorage = await storageFileExists('settings.json')

          if (!hasStorage) {
            await writeStorageFile('settings.json', raw)
            await this.recorder.updateMtime('settings')
            this.prevSettingsRaw = raw
            return
          }

          // Detect changed keys and update timestamps
          const storageRaw = await readStorageFile('settings.json')
          const prevSettings = parseSettings(storageRaw)
          const nowSettings = parseSettings(raw)
          const changedKeys = diffSettingsKeys(prevSettings, nowSettings)

          if (changedKeys.length > 0) {
            await this.recorder.updateSettingsKeys(changedKeys)
            logger.info(`Watcher: tracked ${changedKeys.length} changed settings keys`)
          }

          // Write a new merged snapshot
          await writeStorageFile('settings.json', stringifySettings({ ...prevSettings, ...nowSettings }))
          await this.recorder.updateMtime('settings')
          this.prevSettingsRaw = raw

          logger.info('Watcher: settings synced to storage')
        }
        catch (error) {
          logger.error('Watcher: failed to sync settings', error)
        }
      })
    })
    this.ctx.subscriptions.push(disposable)
  }

  // ─── Extensions watcher ────────────────────────────────────────────────────

  private watchExtensions(): void {
    const disposable = extensions.onDidChange(() => {
      if (this.isSyncingExtensions) {
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

  // ─── Keybindings watcher ───────────────────────────────────────────────────

  private async watchKeybindings(): Promise<void> {
    const keybindingsPath = await findConfigFile(this.ctx, 'keybindings.json')
    if (!keybindingsPath) {
      logger.warn('Watcher: keybindings file not found, skipping')
      return
    }

    this.keybindingsWatcher = workspace.createFileSystemWatcher(keybindingsPath)
    this.keybindingsWatcher.onDidChange(async (_uri: Uri) => {
      this.debounce('keybindings', async () => {
        try {
          const content = await getKeybindings(keybindingsPath)
          await writeStorageFile('keybindings.json', content)
          await this.recorder.updateMtime('keybindings')
          logger.info('Watcher: keybindings synced to storage')
        }
        catch (error) {
          logger.error('Watcher: failed to sync keybindings', error)
        }
      })
    })

    this.ctx.subscriptions.push(this.keybindingsWatcher)
  }

  // ─── Debounce helper ───────────────────────────────────────────────────────

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
