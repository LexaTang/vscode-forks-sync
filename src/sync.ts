import type { ExtensionContext } from 'vscode'
import type { MetaRecorder } from './recorder'
import type { AppName, SettingsSyncChanges, SyncCommandContext } from './types'
import { env, Uri, window } from 'vscode'
import { config } from './config'
import {
  applyExtensions,
  getExtensionsPath,
  getLocalExtensions,
  readExtensionStorage,
  writeExtensionStorage,
} from './extensions'
import { t } from './i18n'
import {
  applySyncedSettings,
  buildMergedSettings,
  diffSettingsKeys,
  filterSettingsKeys,
  mergeSettings,
  parseSettings,
  stringifySettings,
} from './merger'
import { getKeybindings, getSettings, setKeybindings, setSettings } from './profile'
import {
  ensureStorageDirectory,
  getStorageFileUri,
  readAllSettingsSnapshots,
  readSettingsSnapshot,
  readStorageFile,
  storageFileExists,
  writeSettingsSnapshot,
  writeStorageFile,
} from './storage'
import { findConfigFile, logger, resolveConfigFilePath } from './utils'

async function runWithSuppressedWrite(
  type: 'settings' | 'keybindings',
  raw: string,
  fn: () => Promise<void>,
  options: SyncCommandContext,
): Promise<void> {
  if (!options.configWatcher) {
    await fn()
    return
  }

  options.configWatcher.rememberContent(type, raw)
  await options.configWatcher.runWithSuppressed(type, fn)
}

async function confirmSettingsPull(overriddenKeys: string[]): Promise<boolean> {
  const threshold = Number(config['settings.pokaYokeThreshold'] ?? 10)
  if (!Number.isFinite(threshold) || threshold < 1 || overriddenKeys.length < threshold)
    return true

  while (true) {
    const result = await window.showWarningMessage(
      `${t('displayName')}: ${t('msg.settings.confirmApply', { count: overriddenKeys.length })}`,
      { modal: true },
      t('msg.settings.continue'),
      t('msg.settings.reviewDetails'),
      t('msg.settings.cancel'),
    )

    if (result === t('msg.settings.continue')) {
      return true
    }
    else if (result === t('msg.settings.reviewDetails')) {
      const details = [
        t('msg.settings.syncDetails', { displayName: t('displayName'), count: overriddenKeys.length }),
        ...overriddenKeys.sort().map(k => `• \`${k}\``),
        '',
      ]

      const { workspace: ws } = await import('vscode')
      const doc = await ws.openTextDocument({
        content: details.join('\n'),
        language: 'markdown',
      })
      await window.showTextDocument(doc)

      const finalResult = await window.showInformationMessage(
        t('msg.settings.confirmReview'),
        t('msg.settings.continue'),
      )
      if (finalResult === t('msg.settings.continue'))
        return true
      // If they cancel or dismiss, loop back to the modal prompt
    }
    else {
      return false
    }
  }
}

async function getMergedSettingsFromSnapshots(recorder: MetaRecorder): Promise<Record<string, unknown>> {
  const syncMeta = await recorder.readAll()
  const snapshots = await readAllSettingsSnapshots(Object.keys(syncMeta))

  const { merged } = buildMergedSettings(syncMeta, snapshots)
  if (Object.keys(merged).length > 0)
    return merged

  if (await storageFileExists('settings.json'))
    return parseSettings(await readStorageFile('settings.json'))

  return {}
}

async function pushMergedSettingsFromCurrentIde(
  recorder: MetaRecorder,
  currentIde: AppName,
  localSettings: Record<string, unknown>,
  changes: SettingsSyncChanges,
): Promise<void> {
  const timestamp = Date.now()
  const filteredLocal = filterSettingsKeys(localSettings)

  await recorder.applySettingsChanges(changes, timestamp, currentIde)
  await writeSettingsSnapshot(currentIde, stringifySettings(filteredLocal))

  const merged = await getMergedSettingsFromSnapshots(recorder)
  await writeStorageFile('settings.json', stringifySettings(merged))
  await recorder.updateMtime('settings', currentIde, timestamp)
}

export async function syncProfile(
  ctx: ExtensionContext,
  recorder: MetaRecorder,
  options: SyncCommandContext = {},
): Promise<void> {
  const { prompt = true, silent = false } = options

  let shouldSync = true
  if (prompt) {
    const result = await window.showInformationMessage(
      `${t('displayName')}: ${t('msg.syncProfile.prompt')}`,
      t('msg.syncProfile.sync'),
      t('msg.syncProfile.skip'),
    )
    shouldSync = result === t('msg.syncProfile.sync')
  }

  if (!shouldSync)
    return

  logger.info('Profile: sync started')
  await ensureStorageDirectory()

  const opts = { ...options, silent: true }
  await syncSettings(ctx, recorder, opts)
  await syncKeybindings(ctx, recorder, opts)
  await syncExtensions(ctx, recorder, {
    ...opts,
    prompt: config.promptOnExtensionSync,
  })

  if (!silent)
    window.showInformationMessage(`${t('displayName')}: ${t('msg.syncProfile.complete')}`)
  logger.info('Profile: sync complete')
}

export async function syncSettings(
  ctx: ExtensionContext,
  recorder: MetaRecorder,
  options: SyncCommandContext = {},
): Promise<void> {
  const { silent = false } = options
  const currentIde = env.appName as AppName
  let settingsPath = await findConfigFile(ctx, 'settings.json')

  await ensureStorageDirectory()

  if (!settingsPath) {
    const hasStorage = await storageFileExists('settings.json')
    if (hasStorage) {
      // Create the local file and pull from storage
      const path = await resolveConfigFilePath(ctx, 'settings.json')
      const raw = await readStorageFile('settings.json')
      await setSettings(path, raw, { backup: false })
      await recorder.updateMtime('settings')
      logger.info(`Settings: local file missing, created from storage at ${path}`)
      if (!silent)
        window.showInformationMessage(`${t('displayName')}: ${t('msg.settings.restored')}`)
      return
    }
    else {
      // No local file and no storage — create empty local file and initialize
      const path = await resolveConfigFilePath(ctx, 'settings.json')
      await setSettings(path, '{}', { backup: false })
      settingsPath = path
      logger.info(`Settings: local file missing, created empty at ${path}`)
    }
  }

  // At this point settingsPath is guaranteed to be set (either found or just created)
  const resolvedSettingsPath: string = settingsPath!
  const localRaw = await getSettings(resolvedSettingsPath)
  const localSettings = parseSettings(localRaw)
  const filteredLocal = filterSettingsKeys(localSettings)
  const mergeMode = (config['settings.mergeMode'] as string) ?? 'merge'
  const hasStorage = await storageFileExists('settings.json')

  if (!hasStorage) {
    const changes = diffSettingsKeys({}, filteredLocal)
    await pushMergedSettingsFromCurrentIde(recorder, currentIde, filteredLocal, changes)

    if (!silent)
      window.showInformationMessage(`${t('displayName')}: ${t('msg.settings.initialized')}`)
    logger.info('Settings: initialized storage with local keys')
    return
  }

  const storageUri = getStorageFileUri('settings.json')
  const previousSnapshotRaw = await readSettingsSnapshot(currentIde)
  const isFirstSync = !previousSnapshotRaw

  // ── PUSH: content-driven (snapshot diff) ─────────────────────────────────
  // Always check for local changes regardless of mtime.
  // mtime is unreliable for push decisions: a newly-created settings.json on a
  // fresh IDE will have a very recent mtime even though it has no user changes.
  const baseForDiff = previousSnapshotRaw ? parseSettings(previousSnapshotRaw) : {}
  const changes = diffSettingsKeys(baseForDiff, filteredLocal)
  const hasPushChanges = !previousSnapshotRaw || changes.upserted.length > 0 || changes.deleted.length > 0

  if (hasPushChanges) {
    await pushMergedSettingsFromCurrentIde(recorder, currentIde, filteredLocal, changes)
    const upsertedKeys = changes.upserted.length > 0 ? ` [${changes.upserted.join(', ')}]` : ''
    const deletedKeys = changes.deleted.length > 0 ? ` [${changes.deleted.join(', ')}]` : ''
    logger.info(`Settings: pushed — ${changes.upserted.length} upserted${upsertedKeys}, ${changes.deleted.length} deleted${deletedKeys}${isFirstSync ? ' (first sync)' : ''}`)
  }

  // ── PULL: mtime-driven guard ──────────────────────────────────────────────
  // Only pull if storage is newer than local. This prevents overwriting local
  // edits that haven't been pushed yet (e.g., if push was skipped for some reason).
  // Exception: a new IDE with no settings should always pull, regardless of mtime.
  const localIsEmpty = Object.keys(filteredLocal).length === 0
  let storageStat: { mtime: number } | undefined
  let localStat: { mtime: number } | undefined
  try {
    const { workspace: ws } = await import('vscode')
    ;[storageStat, localStat] = await Promise.all([
      ws.fs.stat(storageUri),
      ws.fs.stat(Uri.file(resolvedSettingsPath)),
    ])
  }
  catch { /* stat failure → skip pull */ }

  const storageIsNewer = storageStat && localStat ? storageStat.mtime > localStat.mtime : false
  const shouldPull = (isFirstSync && localIsEmpty) || storageIsNewer

  if (shouldPull) {
    if (isFirstSync && localIsEmpty)
      logger.info('Settings: new IDE with empty settings — pulling from storage')

    const syncMeta = await recorder.readAll()
    const mergedResult = mergeMode === 'merge'
      ? mergeSettings(localSettings, syncMeta, await readAllSettingsSnapshots(Object.keys(syncMeta)))
      : applySyncedSettings(localSettings, parseSettings(await readStorageFile('settings.json')))

    // Skip poka-yoke for first sync on a new/empty IDE (nothing to overwrite)
    if (!isFirstSync && !(await confirmSettingsPull(mergedResult.overriddenKeys)))
      return

    const nextRaw = stringifySettings(mergedResult.syncedSettings)
    if (nextRaw !== localRaw) {
      await runWithSuppressedWrite('settings', nextRaw, async () => {
        await setSettings(settingsPath!, nextRaw)
      }, options)
    }

    await writeSettingsSnapshot(currentIde, stringifySettings(filterSettingsKeys(mergedResult.syncedSettings)))
    await recorder.updateMtime('settings')

    // Build detailed pulled keys log
    if (mergedResult.overriddenKeys.length > 0) {
      if (mergedResult.keySources) {
        const pulledDetails = mergedResult.overriddenKeys.map(k => `${k} (from ${mergedResult.keySources![k] || 'unknown'})`)
        logger.info(`Settings: pulled ${mergedResult.overriddenKeys.length} keys from storage: ${pulledDetails.join(', ')}`)
      }
      else {
        logger.info(`Settings: pulled ${mergedResult.overriddenKeys.length} keys from storage: ${mergedResult.overriddenKeys.join(', ')}`)
      }
    }
    else {
      logger.info('Settings: pulled from storage (no local overrides)')
    }
  }

  if (!silent)
    window.showInformationMessage(`${t('displayName')}: ${t('msg.settings.synced')}`)
}

export async function syncKeybindings(
  ctx: ExtensionContext,
  recorder: MetaRecorder,
  options: SyncCommandContext = {},
): Promise<void> {
  const { silent = false } = options
  let keybindingsPath = await findConfigFile(ctx, 'keybindings.json')

  await ensureStorageDirectory()

  if (!keybindingsPath) {
    const hasStorage = await storageFileExists('keybindings.json')
    if (hasStorage) {
      // Create the local file and pull from storage
      const path = await resolveConfigFilePath(ctx, 'keybindings.json')
      const raw = await readStorageFile('keybindings.json')
      await setKeybindings(path, raw, { backup: false })
      await recorder.updateMtime('keybindings')
      logger.info(`Keybindings: local file missing, created from storage at ${path}`)
      if (!silent)
        window.showInformationMessage(`${t('displayName')}: ${t('msg.keybindings.restored')}`)
      return
    }
    else {
      // No local file and no storage — create empty local file and initialize
      const path = await resolveConfigFilePath(ctx, 'keybindings.json')
      await setKeybindings(path, '[]', { backup: false })
      keybindingsPath = path
      logger.info(`Keybindings: local file missing, created empty at ${path}`)
    }
  }

  // At this point keybindingsPath is guaranteed to be set (either found or just created)
  const resolvedKeybindingsPath: string = keybindingsPath!

  const hasStorage = await storageFileExists('keybindings.json')
  if (!hasStorage) {
    const raw = await getKeybindings(resolvedKeybindingsPath)
    await writeStorageFile('keybindings.json', raw)
    await recorder.updateMtime('keybindings')
    if (!silent)
      window.showInformationMessage(`${t('displayName')}: ${t('msg.keybindings.initialized')}`)
    logger.info('Keybindings: initialized storage with local keys')
    return
  }

  const storageUri = getStorageFileUri('keybindings.json')
  const syncDirection = await recorder.compareMtime('keybindings', storageUri.fsPath, resolvedKeybindingsPath)

  if (syncDirection === 1) {
    const raw = await readStorageFile('keybindings.json')
    await runWithSuppressedWrite('keybindings', raw, async () => {
      await setKeybindings(resolvedKeybindingsPath, raw)
    }, options)
    await recorder.updateMtime('keybindings')
    logger.info('Keybindings: pulled from storage')
  }
  else if (syncDirection === -1) {
    await writeStorageFile('keybindings.json', await getKeybindings(resolvedKeybindingsPath))
    await recorder.updateMtime('keybindings')
    logger.info('Keybindings: pushed to storage')
  }

  if (!silent)
    window.showInformationMessage(`${t('displayName')}: ${t('msg.keybindings.synced')}`)
}

export async function syncExtensions(
  _ctx: ExtensionContext,
  recorder: MetaRecorder,
  options: SyncCommandContext = {},
): Promise<void> {
  const { prompt = true, silent = false } = options
  const currentIde = env.appName as AppName

  await ensureStorageDirectory()

  const storage = await readExtensionStorage()

  if (!storage) {
    const localIds = await getLocalExtensions()
    await writeExtensionStorage(currentIde, { successfulIds: localIds }, null)
    await recorder.updateMtime('extensions')
    if (!silent)
      window.showInformationMessage(`${t('displayName')}: ${t('msg.extensions.initialized')}`)
    logger.info(`Extensions: initialized storage with local list for ${currentIde}`)
    return
  }

  const storageUri = getStorageFileUri('extensions.json')
  const localPath = getExtensionsPath() ?? storageUri.fsPath
  const syncDirection = await recorder.compareMtime('extensions', storageUri.fsPath, localPath)

  if (syncDirection === 1) {
    await applyExtensions(storage.merged, currentIde, storage, recorder, prompt, options.configWatcher)
  }
  else if (syncDirection === -1) {
    const localIds = await getLocalExtensions()
    await writeExtensionStorage(currentIde, { successfulIds: localIds }, storage)
    await recorder.updateMtime('extensions')
    logger.info(`Extensions: pushed local list for ${currentIde}`)
  }

  if (!silent)
    window.showInformationMessage(`${t('displayName')}: ${t('msg.extensions.synced')}`)
}
