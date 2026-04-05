import type { ExtensionConfig, ExtensionStorage, ExtensionsDiff } from './types'
import type { ConfigWatcher } from './watcher'
import type { MetaRecorder } from './recorder'
import { commands, extensions, ProgressLocation, Uri, window } from 'vscode'
import { config } from './config'
import { downloadVsixPackage } from './downloader'
import { displayName, extensionId } from './generated/meta'
import { jsonParse, jsonStringify } from './json'
import { getStorageFileUri, readStorageFile, storageFileExists, writeStorageFile } from './storage'
import { logger, readFile } from './utils'
import type { AppName } from './types'
import { join, dirname } from 'node:path'

// ─── Local extension reading ───────────────────────────────────────────────────

export function getExtensionsPath(): string | undefined {
  const ext = extensions.all.find((e: any) => !e.packageJSON.isBuiltin)
  if (!ext) {
    logger.warn('Could not find extensions directory')
    return undefined
  }
  return dirname(ext.extensionPath)
}

export async function readExtensionConfig(): Promise<ExtensionConfig[]> {
  const extPath = getExtensionsPath()
  if (!extPath)
    throw new Error('Could not find extensions directory')
  const uri = Uri.file(join(extPath, 'extensions.json'))
  return jsonParse(await readFile(uri))
}

export async function getUserExtensionIds(): Promise<string[]> {
  try {
    const cfg = await readExtensionConfig()
    return cfg.map(e => e.identifier.id)
  }
  catch (error) {
    logger.error('Failed to read extensions.json, falling back to API', error)
    return extensions.all
      .filter((e: any) => !e.packageJSON.isBuiltin)
      .map((e: any) => e.id)
  }
}

function normalizeIds(ids: string[], perIdeExcludes: string[] = []): string[] {
  const globalExcluded = ((config['extensions.excludeExtensions'] as string[] | undefined) ?? [])
    .map(id => id.toLowerCase())
  const allExcluded = new Set([...globalExcluded, ...perIdeExcludes.map(id => id.toLowerCase())])
  return ids
    .map(id => id.toLowerCase())
    .filter(id => !allExcluded.has(id) && id !== extensionId.toLowerCase())
}

/** Read per-IDE exclude list from the stored extensions.json. */
async function readPerIdeExcludes(currentIde: AppName): Promise<string[]> {
  try {
    const storage = await readExtensionStorage()
    return storage?.excludePerIde?.[currentIde] ?? []
  }
  catch {
    return []
  }
}

export async function getLocalExtensions(): Promise<string[]> {
  const { env } = await import('vscode')
  const currentIde = env.appName as AppName
  const perIdeExcludes = await readPerIdeExcludes(currentIde)
  return normalizeIds(await getUserExtensionIds(), perIdeExcludes)
}

// ─── Storage model ─────────────────────────────────────────────────────────────

const EXTENSIONS_FILE = 'extensions.json'

export async function readExtensionStorage(): Promise<ExtensionStorage | null> {
  if (!(await storageFileExists(EXTENSIONS_FILE)))
    return null
  return jsonParse<ExtensionStorage>(await readStorageFile(EXTENSIONS_FILE))
}

/**
 * Compute the union of all perIde lists.
 */
function computeMerged(perIde: Partial<Record<AppName, string[]>>): string[] {
  const all = new Set<string>()
  for (const ids of Object.values(perIde)) {
    if (ids) ids.forEach(id => all.add(id))
  }
  return [...all].sort()
}

/**
 * Update this IDE's perIde entry with `successfulIds` (only successfully
 * installed extensions), then recompute `merged`.
 *
 * The gallery field is taken from the plugin config at write-time so every
 * IDE that reads the file knows where to download from.
 */
export async function writeExtensionStorage(
  currentIde: AppName,
  successfulIds: string[],
  existing: ExtensionStorage | null,
): Promise<void> {
  const perIde = existing?.perIde ? { ...existing.perIde } : {} as Partial<Record<AppName, string[]>>
  perIde[currentIde] = normalizeIds(successfulIds)

  const gallery = (config.extensionsGallery as ExtensionStorage['gallery']) ?? {
    serviceUrl: 'https://open-vsx.org/vscode/gallery',
    itemUrl: 'https://open-vsx.org/vscode/item',
  }

  const storage: ExtensionStorage = {
    gallery,
    perIde,
    merged: computeMerged(perIde),
  }

  await writeStorageFile(EXTENSIONS_FILE, jsonStringify(storage))
  logger.info(`Extension storage updated for ${currentIde}: ${storage.merged.length} total extensions`)
}

// ─── Diff & install ───────────────────────────────────────────────────────────

export async function getExtensionsDiff(target: string[]): Promise<ExtensionsDiff | undefined> {
  const installed = await getLocalExtensions()
  const targetSet = new Set(normalizeIds(target))
  const installedSet = new Set(installed)

  const toInstall = [...targetSet].filter(id => !installedSet.has(id))
  const toDelete = installed.filter(id => !targetSet.has(id))

  if (toInstall.length === 0 && toDelete.length === 0)
    return undefined

  return { toInstall, toDelete }
}

function formatMessage(title: string, list?: string[]): string {
  const parts = [displayName, title]
  if (list && list.length > 0)
    parts.push(...list.map(e => `• ${e}`))
  return parts.join('\n')
}

/**
 * Apply the merged extension list to the current IDE.
 *
 * Returns the set of successfully installed IDs so the caller can update
 * perIde in the storage file.
 */
export async function applyExtensions(
  mergedList: string[],
  currentIde: AppName,
  storage: ExtensionStorage | null,
  recorder: MetaRecorder,
  prompt: boolean = true,
  watcher?: ConfigWatcher,
): Promise<void> {
  const diff = await getExtensionsDiff(mergedList)
  if (!diff)
    return

  const { toInstall, toDelete } = diff

  if (prompt) {
    const action = await window.showWarningMessage(
      formatMessage(
        `• ${toInstall.length} extension${toInstall.length !== 1 ? 's' : ''} to install\n• ${toDelete.length} extension${toDelete.length !== 1 ? 's' : ''} to remove`,
      ),
      { modal: true },
      'Apply Changes',
      'Review Details',
    )

    if (action === 'Review Details') {
      const details: string[] = [`${displayName} - Extension Sync Details\n`]
      if (toInstall.length > 0)
        details.push('Installing:', ...toInstall.map(e => `  • ${e}`), '\n')
      if (toDelete.length > 0) {
        details.push('Removing:', ...toDelete.map(e => `  • ${e}`), '\n')
      }
      
      const { workspace } = await import('vscode')
      const doc = await workspace.openTextDocument({
        content: details.join('\n'),
        language: 'markdown',
      })
      await window.showTextDocument(doc)
      
      const result = await window.showInformationMessage(
        'Review the changes. Do you want to continue?',
        { modal: true },
        'Continue',
      )
      if (result !== 'Continue')
        return
    }
    else if (action !== 'Apply Changes') {
      return
    }
  }

  if (watcher)
    watcher.setSyncingExtensions(true)

  try {
    const failedToInstall: string[] = []
    let needsReload = false

    await window.withProgress(
      {
        location: ProgressLocation.Notification,
        title: 'Fork Sync: Syncing Extensions',
        cancellable: false,
      },
      async (progress) => {
        const total = toInstall.length + toDelete.length
        let completed = 0

        for (const id of toDelete) {
          try {
            progress.report({ message: `Uninstalling ${id}...`, increment: (++completed / total) * 100 })
            await commands.executeCommand('workbench.extensions.uninstallExtension', id)
            needsReload = true
            logger.info(`Uninstalled extension: ${id}`)
          }
          catch (error) {
            logger.error(`Failed to uninstall ${id}`, error)
          }
        }

        for (const id of toInstall) {
          try {
            progress.report({ message: `Installing ${id}...`, increment: (++completed / total) * 100 })
            await commands.executeCommand('workbench.extensions.installExtension', id)
            needsReload = true
            logger.info(`Installed extension: ${id}`)
          }
          catch (error) {
            failedToInstall.push(id)
            logger.error(`Failed to install ${id}`, error)
          }
        }
      },
    )

    // Try VSIX fallback for failed installs
    if (failedToInstall.length > 0) {
      const action = await window.showWarningMessage(
        formatMessage('Failed to install:', failedToInstall),
        { modal: true },
        'Try downloading VSIX',
      )
      if (action === 'Try downloading VSIX') {
        const { succeeded } = await installFromVsix(failedToInstall, storage, watcher)
        needsReload = needsReload || succeeded.length > 0
      }
    }

    // Update perIde based on what's now actually installed
    const nowInstalled = await getLocalExtensions()
    await writeExtensionStorage(currentIde, nowInstalled, storage)
    await recorder.updateMtime('extensions')

    if (needsReload) {
      const reload = await window.showInformationMessage(
        formatMessage('Extension sync complete. Reload window to apply changes?'),
        'Reload',
        'Later',
      )
      if (reload === 'Reload')
        await commands.executeCommand('workbench.action.reloadWindow')
    }
  }
  finally {
    if (watcher)
      watcher.setSyncingExtensions(false)
  }
}

/**
 * Attempt to install extensions by downloading VSIX packages.
 * Uses the gallery URL from storage if available, then falls back to VS Marketplace.
 *
 * Downloaded VSIXs are cached in the storage/vsix/ directory.
 * Failed installs are persisted to extensions.json under `failedInstalls[currentIde]`.
 */
export async function installFromVsix(
  ids: string[],
  storage: ExtensionStorage | null,
  watcher?: ConfigWatcher,
): Promise<{ succeeded: string[], failed: string[] }> {
  const succeeded: string[] = []
  const failed: string[] = []

  if (watcher)
    watcher.setSyncingExtensions(true)

  try {
    await window.withProgress({
      location: ProgressLocation.Notification,
      title: 'Fork Sync: Downloading VSIX',
      cancellable: false,
    }, async (progress) => {
      const total = ids.length
      let completed = 0

      for (const id of ids) {
        try {
          progress.report({ message: `Downloading ${id}...`, increment: (++completed / total) * 100 })
          const uri = await downloadVsixPackage(id, storage?.gallery ?? null)
          // VSIX is kept in storage/vsix/ for future use — do NOT delete it
          await commands.executeCommand('workbench.extensions.installExtension', uri)
          succeeded.push(id)
          logger.info(`Installed ${id} from VSIX`)
        }
        catch (error) {
          failed.push(id)
          logger.error(`Failed to install ${id} via VSIX`, error)
        }
      }
    })

    // ── Persist failed installs to extensions.json ──
    if (failed.length > 0) {
      const { env } = await import('vscode')
      const currentIde = env.appName as AppName
      const latestStorage = await readExtensionStorage()
      const base = latestStorage ?? { perIde: {}, merged: [] } as ExtensionStorage
      const existingFailed = base.failedInstalls ? { ...base.failedInstalls } : {} as Partial<Record<AppName, string[]>>
      // Merge with any existing failures (deduplicated)
      const prevFailed = existingFailed[currentIde] ?? []
      existingFailed[currentIde] = [...new Set([...prevFailed, ...failed])]
      await writeStorageFile(EXTENSIONS_FILE, jsonStringify({ ...base, failedInstalls: existingFailed }))
      logger.warn(`Persisted ${failed.length} failed install(s) to extensions.json for ${currentIde}: ${failed.join(', ')}`)

      // ── Non-modal notification: offer to add to per-IDE exclude list ──
      const failedCount = failed.length
      const label = failedCount === 1 ? failed[0] : `${failedCount} extensions`
      // showWarningMessage without { modal: true } is a non-blocking notification toast
      window.showWarningMessage(
        `Fork Sync: Could not install ${label} on ${currentIde}. Add to this IDE's exclude list to stop retrying?`,
        'Add to Exclude List',
        'View Details',
      ).then(async (action) => {
        if (action === 'Add to Exclude List') {
          const freshStorage = await readExtensionStorage()
          const freshBase = freshStorage ?? { perIde: {}, merged: [] } as ExtensionStorage
          const existingExcludes = freshBase.excludePerIde ? { ...freshBase.excludePerIde } : {} as Partial<Record<AppName, string[]>>
          const prevExcludes = existingExcludes[currentIde] ?? []
          existingExcludes[currentIde] = [...new Set([...prevExcludes, ...failed])]
          await writeStorageFile(EXTENSIONS_FILE, jsonStringify({ ...freshBase, excludePerIde: existingExcludes }))
          logger.info(`Added to per-IDE exclude list for ${currentIde}: ${failed.join(', ')}`)
          window.showInformationMessage(
            `Fork Sync: Added ${label} to ${currentIde}'s exclude list. They will be skipped in future syncs.`,
          )
        }
        else if (action === 'View Details') {
          const { workspace: ws } = await import('vscode')
          const doc = await ws.openTextDocument({
            content: [
              `# Fork Sync — Failed Installs on ${currentIde}`,
              '',
              'The following extensions could not be installed via VSIX:',
              ...failed.map(id => `  • ${id}`),
              '',
              'These have been recorded in extensions.json under `failedInstalls`.',
              'You can manually install them or click "Add to Exclude List" to skip them in future syncs.',
            ].join('\n'),
            language: 'markdown',
          })
          await window.showTextDocument(doc)
        }
      })
    }
  }
  finally {
    if (watcher)
      watcher.setSyncingExtensions(false)
  }

  return { succeeded, failed }
}
