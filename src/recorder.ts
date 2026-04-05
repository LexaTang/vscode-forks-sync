import type { AppName, AppSyncMeta, SyncMeta, SyncType } from './types'
import { env, Uri, workspace } from 'vscode'
import { DEFAULT_SYNC_META } from './constants'
import { jsonParse, jsonStringify } from './json'
import { getStorageFileUri, readStorageFile, storageFileExists, writeStorageFile } from './storage'
import { compareFsMtime, logger } from './utils'

export class MetaRecorder {
  private filename = 'vscode-forks-sync.json'
  private appName: AppName

  constructor() {
    this.appName = env.appName as AppName
    this.ensure()
  }

  getAppName(): AppName {
    return this.appName
  }

  private getStoragePath(key: SyncType): Uri {
    switch (key) {
      case 'settings': return getStorageFileUri('settings.json')
      case 'extensions': return getStorageFileUri('extensions.json')
      case 'keybindings': return getStorageFileUri('keybindings.json')
    }
  }

  private async ensure(): Promise<void> {
    const hasStorage = await storageFileExists(this.filename)
    if (!hasStorage)
      await writeStorageFile(this.filename, jsonStringify(DEFAULT_SYNC_META))
  }

  private async read(): Promise<SyncMeta> {
    await this.ensure()
    const content = await readStorageFile(this.filename)
    return jsonParse<SyncMeta>(content)
  }

  private async write(meta: SyncMeta): Promise<void> {
    // Keep keys sorted for stable diffs
    const sorted = Object.keys(meta).sort().reduce((acc, key) => {
      acc[key as AppName] = meta[key as AppName]
      return acc
    }, {} as SyncMeta)
    await writeStorageFile(this.filename, jsonStringify(sorted))
  }

  async getStorageMtime(key: SyncType): Promise<number> {
    const uri = this.getStoragePath(key)
    const stat = await workspace.fs.stat(Uri.file(uri.fsPath))
    return stat.mtime
  }

  async getMtime(type: SyncType, app: AppName = this.appName): Promise<number | undefined> {
    const meta = await this.read()
    return meta[app]?.[type]
  }

  async updateMtime(type: SyncType, app: AppName = this.appName, mtime: number = Date.now()): Promise<void> {
    const meta = await this.read()
    meta[app] = { ...meta[app], [type]: mtime }
    await this.write(meta)
  }

  /**
   * Compare the storage file's disk mtime against the last time *this IDE*
   * uploaded.
   *
   * Returns:
   *   1  → storage is newer (pull from storage)
   *  -1  → local is newer  (push to storage)
   *   0  → in sync
   */
  async compareMtime(type: SyncType, storagePath: string, appPath: string): Promise<1 | -1 | 0 | undefined> {
    try {
      const storageMtime = await this.getStorageMtime(type)
      const recordedMtime = await this.getMtime(type, this.appName)

      logger.info(`compare ${type} mtime: storage=${storageMtime} recorded=${recordedMtime}`)

      if (!storageMtime)
        return -1 // no storage file yet → push
      if (!recordedMtime) {
        await this.updateMtime(type)
        return 1 // we've never synced → pull
      }
      if (storageMtime > recordedMtime)
        return 1
      else if (storageMtime < recordedMtime)
        return -1
      else
        return 0
    }
    catch (error) {
      logger.error(`Failed to compare ${type} mtime`, error)
      return await compareFsMtime(storagePath, appPath)
    }
  }

  // ─── Per-key settings timestamps (merge mode) ───────────────────────────────

  /**
   * Record a batch of settings key → timestamp updates for this IDE.
   * Called after we detect which keys changed relative to the last snapshot.
   */
  async updateSettingsKeys(changedKeys: string[], timestamp: number = Date.now()): Promise<void> {
    const meta = await this.read()
    const appMeta: AppSyncMeta = meta[this.appName] ?? {}
    const existing = appMeta.settingsKeys ?? {}
    for (const key of changedKeys)
      existing[key] = timestamp
    appMeta.settingsKeys = existing
    meta[this.appName] = appMeta
    await this.write(meta)
  }

  /**
   * Get the timestamp for a specific settings key as written by a particular IDE.
   * Returns 0 if never recorded.
   */
  async getSettingsKeyMtime(key: string, app: AppName = this.appName): Promise<number> {
    const meta = await this.read()
    return meta[app]?.settingsKeys?.[key] ?? 0
  }

  /**
   * Read the *full* SyncMeta — used by the merger to build the global key-level
   * timestamp map across all IDEs.
   */
  async readAll(): Promise<SyncMeta> {
    return this.read()
  }
}
