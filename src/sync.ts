import type { ExtensionContext } from 'vscode'
import type { MetaRecorder } from './recorder'
import type { AppName, SettingsSyncChanges, SyncCommandContext } from './types'
import { env, window } from 'vscode'
import { config } from './config'
import { APP_NAMES } from './constants'
import {
  applyExtensions,
  getExtensionsPath,
  getLocalExtensions,
  readExtensionStorage,
  writeExtensionStorage,
} from './extensions'
import { displayName } from './generated/meta'
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
      `${displayName}: applying sync will overwrite ${overriddenKeys.length} settings keys on this IDE. Continue?`,
      { modal: true },
      'Continue',
      'Review Details',
      'Cancel',
    )

    if (result === 'Continue') {
      return true
    }
    else if (result === 'Review Details') {
      const details = [
        `# ${displayName} - Settings Sync Details\n`,
        `The following ${overriddenKeys.length} keys will be modified or overwritten by the incoming sync:\n`,
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
        'Review the settings changes. Do you want to continue?',
        'Continue',
      )
      if (finalResult === 'Continue')
        return true
      // If they cancel or dismiss, loop back to the modal prompt
    }
    else {
      return false
    }
  }
}

async function getMergedSettingsFromSnapshots(recorder: MetaRecorder): Promise<Record<string, unknown>> {
  const [syncMeta, snapshots] = await Promise.all([
    recorder.readAll(),
    readAllSettingsSnapshots(APP_NAMES),
  ])

  const merged = buildMergedSettings(syncMeta, snapshots)
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
      `${displayName}: Do you want to sync your config?`,
      'Sync',
      'Skip',
    )
    shouldSync = result === 'Sync'
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
    window.showInformationMessage(`${displayName}: Config updated`)
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
        window.showInformationMessage(`${displayName}: Settings restored from storage`)
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
      window.showInformationMessage(`${displayName}: Settings file initialized`)
    logger.info('Settings: initialized storage with local keys')
    return
  }

  const storageUri = getStorageFileUri('settings.json')
  const syncDirection = await recorder.compareMtime('settings', storageUri.fsPath, resolvedSettingsPath)

  if (syncDirection === 1) {
    const mergedResult = mergeMode === 'merge'
      ? mergeSettings(localSettings, await recorder.readAll(), await readAllSettingsSnapshots(APP_NAMES))
      : applySyncedSettings(localSettings, parseSettings(await readStorageFile('settings.json')))

    if (!(await confirmSettingsPull(mergedResult.overriddenKeys)))
      return

    const nextRaw = stringifySettings(mergedResult.syncedSettings)
    if (nextRaw !== localRaw) {
      await runWithSuppressedWrite('settings', nextRaw, async () => {
        await setSettings(settingsPath!, nextRaw)
      }, options)
    }

    await writeSettingsSnapshot(currentIde, stringifySettings(filterSettingsKeys(mergedResult.syncedSettings)))
    await recorder.updateMtime('settings')
    logger.info('Settings: pulled from storage')
  }
  else if (syncDirection === -1) {
    const previousSnapshot = parseSettings((await readSettingsSnapshot(currentIde)) ?? '{}')
    const changes = diffSettingsKeys(previousSnapshot, filteredLocal)

    if (changes.upserted.length > 0 || changes.deleted.length > 0) {
      await pushMergedSettingsFromCurrentIde(recorder, currentIde, filteredLocal, changes)
      logger.info(`Settings: tracked ${changes.upserted.length} updated and ${changes.deleted.length} deleted keys`)
    }
  }

  if (!silent)
    window.showInformationMessage(`${displayName}: Settings synced`)
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
        window.showInformationMessage(`${displayName}: Keybindings restored from storage`)
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
      window.showInformationMessage(`${displayName}: Keybindings file initialized`)
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
    window.showInformationMessage(`${displayName}: Keybindings synced`)
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
    await writeExtensionStorage(currentIde, localIds, null)
    await recorder.updateMtime('extensions')
    if (!silent)
      window.showInformationMessage(`${displayName}: Extension list initialized`)
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
    await writeExtensionStorage(currentIde, localIds, storage)
    await recorder.updateMtime('extensions')
    logger.info(`Extensions: pushed local list for ${currentIde}`)
  }

  if (!silent)
    window.showInformationMessage(`${displayName}: Extensions synced`)
}
