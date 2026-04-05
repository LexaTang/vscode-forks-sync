import type { AppName, AppSyncMeta, SettingsSyncChanges, SyncMeta, SyncType } from './types'
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
  }

  getAppName(): AppName {
    return this.appName
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
    const sorted = Object.keys(meta).sort().reduce((acc, key) => {
      acc[key as AppName] = meta[key as AppName]
      return acc
    }, {} as SyncMeta)
    await writeStorageFile(this.filename, jsonStringify(sorted))
  }

  private getStoragePath(key: SyncType): Uri {
    switch (key) {
      case 'settings': return getStorageFileUri('settings.json')
      case 'extensions': return getStorageFileUri('extensions.json')
      case 'keybindings': return getStorageFileUri('keybindings.json')
    }
  }

  async getStorageMtime(key: SyncType): Promise<number> {
    const uri = this.getStoragePath(key)
    try {
      const stat = await workspace.fs.stat(Uri.file(uri.fsPath))
      return stat.mtime
    }
    catch {
      return 0
    }
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

  async compareMtime(type: SyncType, storagePath: string, appPath: string): Promise<1 | -1 | 0 | undefined> {
    try {
      const hasStorage = await storageFileExists(`${type}.json`)
      if (!hasStorage)
        return -1

      const result = await compareFsMtime(storagePath, appPath)
      logger.info(`compare ${type} mtime result: ${result}`)
      return result
    }
    catch (error) {
      logger.error(`Failed to compare ${type} mtime`, error)
      return undefined
    }
  }

  async applySettingsChanges(changes: SettingsSyncChanges, timestamp: number = Date.now(), app: AppName = this.appName): Promise<void> {
    const meta = await this.read()
    const appMeta: AppSyncMeta = meta[app] ?? {}
    const valueMap = { ...(appMeta.settingsKeys ?? {}) }
    const tombstoneMap = { ...(appMeta.settingsTombstones ?? {}) }

    for (const key of changes.upserted) {
      valueMap[key] = timestamp
      delete tombstoneMap[key]
    }

    for (const key of changes.deleted) {
      tombstoneMap[key] = timestamp
      delete valueMap[key]
    }

    appMeta.settingsKeys = valueMap
    appMeta.settingsTombstones = tombstoneMap
    meta[app] = appMeta
    await this.write(meta)
  }

  async readAll(): Promise<SyncMeta> {
    return this.read()
  }
}
