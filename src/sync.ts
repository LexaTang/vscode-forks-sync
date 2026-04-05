import type { ExtensionContext } from 'vscode'
import type { MetaRecorder } from './recorder'
import type { SyncCommandContext } from './types'
import { env, window } from 'vscode'
import { codeName, config } from './config'
import { displayName } from './generated/meta'
import { jsonStringify } from './json'
import {
  diffSettingsKeys,
  mergeSettings,
  overrideSettings,
  parseSettings,
  stringifySettings,
} from './merger'
import { getKeybindings, getSettings, setKeybindings, setSettings } from './profile'
import {
  applyExtensions,
  getLocalExtensions,
  readExtensionStorage,
  writeExtensionStorage,
} from './extensions'
import {
  ensureStorageDirectory,
  getStorageFileUri,
  readStorageFile,
  storageFileExists,
  writeStorageFile,
} from './storage'
import { findConfigFile, logger } from './utils'
import type { AppName } from './types'

// ─── Full profile sync ────────────────────────────────────────────────────────

export async function syncProfile(
  ctx: ExtensionContext,
  recorder: MetaRecorder,
  options: SyncCommandContext = {},
): Promise<void> {
  const { prompt = true, silent = false } = options

  let shouldSync = true
  if (prompt) {
    const result = await window.showInformationMessage(
      `${displayName}: Do you want to sync your config?`,
      'Sync',
      'Skip',
    )
    shouldSync = result === 'Sync'
  }

  if (!shouldSync)
    return

  await ensureStorageDirectory()

  const opts = { ...options, silent: true }
  await Promise.all([
    syncSettings(ctx, recorder, opts),
    syncKeybindings(ctx, recorder, opts),
    syncExtensions(ctx, recorder, {
      ...opts,
      prompt: config.promptOnExtensionSync,
    }),
  ])

  if (!silent)
    window.showInformationMessage(`${displayName}: Config updated`)
}

// ─── Settings sync ────────────────────────────────────────────────────────────

export async function syncSettings(
  ctx: ExtensionContext,
  recorder: MetaRecorder,
  options: SyncCommandContext = {},
): Promise<void> {
  const { silent = false } = options
  const currentIde = env.appName as AppName
  const settingsPath = await findConfigFile(ctx, 'settings.json')

  if (!settingsPath) {
    logger.error('Settings file not found')
    if (!silent)
      window.showInformationMessage(`${displayName}: Settings file not found`)
    return
  }

  const localRaw = await getSettings(settingsPath)
  const localSettings = parseSettings(localRaw)
  const mergeMode = (config['settings.mergeMode'] as string) ?? 'merge'
  const hasStorage = await storageFileExists('settings.json')

  // ── First sync: push local to storage ──
  if (!hasStorage) {
    const filtered = mergeMode === 'merge'
      ? (() => {
          // Record all existing keys as "owned by this IDE" at current time
          const now = Date.now()
          recorder.updateSettingsKeys(Object.keys(localSettings), now)
          return localSettings
        })()
      : overrideSettings(localSettings)

    await writeStorageFile('settings.json', stringifySettings(filtered))
    await recorder.updateMtime('settings')

    if (!silent)
      window.showInformationMessage(`${displayName}: Settings file initialized`)
    return
  }

  // ── Subsequent syncs ──
  const storageUri = getStorageFileUri('settings.json')
  const syncDirection = await recorder.compareMtime('settings', storageUri.fsPath, settingsPath)

  if (syncDirection === 1) {
    // Storage is newer → pull into local
    const storageRaw = await readStorageFile('settings.json')
    const storageSettings = parseSettings(storageRaw)

    if (mergeMode === 'merge') {
      // Merge: only apply keys where storage has a newer timestamp than our local record
      const syncMeta = await recorder.readAll()
      const merged = mergeSettings(
        storageSettings,
        localSettings,
        syncMeta,
        new Map([[currentIde, localSettings]]),
        currentIde,
      )
      await setSettings(settingsPath, stringifySettings(merged))
    }
    else {
      // Override: whole-file replace
      await setSettings(settingsPath, storageRaw)
    }
    logger.info('Settings: pulled from storage')
  }
  else if (syncDirection === -1) {
    // Local is newer → push to storage
    if (mergeMode === 'merge') {
      const storageRaw = await readStorageFile('settings.json')
      const storageSettings = parseSettings(storageRaw)
      const changedKeys = diffSettingsKeys(storageSettings, localSettings)

      if (changedKeys.length > 0) {
        await recorder.updateSettingsKeys(changedKeys)
        logger.info(`Settings: tracked ${changedKeys.length} changed keys`)
      }

      // Build a new merged snapshot combining storage and local changes
      const syncMeta = await recorder.readAll()
      const merged = mergeSettings(
        storageSettings,
        localSettings,
        syncMeta,
        new Map([[currentIde, localSettings]]),
        currentIde,
      )
      await writeStorageFile('settings.json', stringifySettings(merged))
    }
    else {
      await writeStorageFile('settings.json', stringifySettings(overrideSettings(localSettings)))
    }

    await recorder.updateMtime('settings')
    logger.info('Settings: pushed to storage')
  }

  if (!silent)
    window.showInformationMessage(`${displayName}: Settings synced`)
}

// ─── Keybindings sync ─────────────────────────────────────────────────────────

export async function syncKeybindings(
  ctx: ExtensionContext,
  recorder: MetaRecorder,
  options: SyncCommandContext = {},
): Promise<void> {
  const { silent = false } = options
  const keybindingsPath = await findConfigFile(ctx, 'keybindings.json')

  if (!keybindingsPath) {
    logger.error('Keybindings file not found')
    if (!silent)
      window.showInformationMessage(`${displayName}: Keybindings file not found`)
    return
  }

  const hasStorage = await storageFileExists('keybindings.json')
  if (!hasStorage) {
    await writeStorageFile('keybindings.json', await getKeybindings(keybindingsPath))
    await recorder.updateMtime('keybindings')
    if (!silent)
      window.showInformationMessage(`${displayName}: Keybindings file initialized`)
    return
  }

  const storageUri = getStorageFileUri('keybindings.json')
  const syncDirection = await recorder.compareMtime('keybindings', storageUri.fsPath, keybindingsPath)

  if (syncDirection === 1) {
    await setKeybindings(keybindingsPath, await readStorageFile('keybindings.json'))
    logger.info('Keybindings: pulled from storage')
  }
  else if (syncDirection === -1) {
    await writeStorageFile('keybindings.json', await getKeybindings(keybindingsPath))
    await recorder.updateMtime('keybindings')
    logger.info('Keybindings: pushed to storage')
  }

  if (!silent)
    window.showInformationMessage(`${displayName}: Keybindings synced`)
}

// ─── Extensions sync ──────────────────────────────────────────────────────────

export async function syncExtensions(
  _ctx: ExtensionContext,
  recorder: MetaRecorder,
  options: SyncCommandContext = {},
): Promise<void> {
  const { prompt = true, silent = false } = options
  const currentIde = env.appName as AppName

  const storage = await readExtensionStorage()

  // ── First sync: push local to storage ──
  if (!storage) {
    const localIds = await getLocalExtensions()
    await writeExtensionStorage(currentIde, localIds, null)
    await recorder.updateMtime('extensions')
    if (!silent)
      window.showInformationMessage(`${displayName}: Extension list initialized`)
    return
  }

  const storageUri = getStorageFileUri('extensions.json')
  const syncDirection = await recorder.compareMtime(
    'extensions',
    storageUri.fsPath,
    // Use extensions directory mtime as the "local" reference
    (() => {
      try {
        const { getExtensionsPath } = require('./extensions')
        return getExtensionsPath() ?? storageUri.fsPath
      }
      catch {
        return storageUri.fsPath
      }
    })(),
  )

  if (syncDirection === 1) {
    // Storage has merged list that's newer → install what we're missing
    await applyExtensions(storage.merged, currentIde, storage, recorder, prompt, options.configWatcher)
  }
  else if (syncDirection === -1 || syncDirection === 0) {
    // Local changed (or same) → update our perIde entry
    const localIds = await getLocalExtensions()
    await writeExtensionStorage(currentIde, localIds, storage)
    await recorder.updateMtime('extensions')
    logger.info(`Extensions: pushed local list for ${currentIde}`)
  }

  if (!silent)
    window.showInformationMessage(`${displayName}: Extensions synced`)
}
