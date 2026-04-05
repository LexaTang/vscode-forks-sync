import type { AppName, MergeSettingsResult, SettingsSyncChanges, SyncMeta } from './types'
import micromatch from 'micromatch'
import { config } from './config'
import { jsonParse, jsonStringify } from './json'
import { logger } from './utils'

function getWhitelistPatterns(): string[] {
  return ((config['settings.includeKeys'] as string[] | undefined) ?? []).filter(Boolean)
}

function getExcludePatterns(): string[] {
  return ((config['settings.excludeKeys'] as string[] | undefined) ?? []).filter(Boolean)
}

export function isKeyIncluded(key: string): boolean {
  const includePatterns = getWhitelistPatterns()
  if (includePatterns.length === 0)
    return true
  return micromatch.isMatch(key, includePatterns)
}

export function isKeyExcluded(key: string): boolean {
  const excludePatterns = getExcludePatterns()
  if (excludePatterns.length === 0)
    return false
  return micromatch.isMatch(key, excludePatterns)
}

export function shouldSyncKey(key: string): boolean {
  return isKeyIncluded(key) && !isKeyExcluded(key)
}

export function filterSettingsKeys(settings: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(settings).filter(([key]) => shouldSyncKey(key)),
  )
}

export function diffSettingsKeys(
  previous: Record<string, unknown>,
  current: Record<string, unknown>,
): SettingsSyncChanges {
  const filteredPrevious = filterSettingsKeys(previous)
  const filteredCurrent = filterSettingsKeys(current)
  const upserted: string[] = []
  const deleted: string[] = []
  const allKeys = new Set([...Object.keys(filteredPrevious), ...Object.keys(filteredCurrent)])

  for (const key of allKeys) {
    const hasPrev = key in filteredPrevious
    const hasCurrent = key in filteredCurrent

    if (!hasCurrent && hasPrev) {
      deleted.push(key)
      continue
    }

    if (hasCurrent && (!hasPrev || JSON.stringify(filteredPrevious[key]) !== JSON.stringify(filteredCurrent[key])))
      upserted.push(key)
  }

  return { upserted, deleted }
}

export function buildMergedSettings(
  syncMeta: SyncMeta,
  ideSnapshots: Map<AppName, Record<string, unknown>>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = {}
  const trackedKeys = new Set<string>()

  for (const appMeta of Object.values(syncMeta)) {
    Object.keys(appMeta?.settingsKeys ?? {}).forEach(key => trackedKeys.add(key))
    Object.keys(appMeta?.settingsTombstones ?? {}).forEach(key => trackedKeys.add(key))
  }

  for (const key of trackedKeys) {
    let latestValueTimestamp = 0
    let latestTombstoneTimestamp = 0
    let winningIde: AppName | undefined

    for (const [ideName, appMeta] of Object.entries(syncMeta) as [AppName, SyncMeta[AppName]][]) {
      const valueTimestamp = appMeta?.settingsKeys?.[key] ?? 0
      const tombstoneTimestamp = appMeta?.settingsTombstones?.[key] ?? 0

      if (valueTimestamp > latestValueTimestamp) {
        latestValueTimestamp = valueTimestamp
        winningIde = ideName
      }

      if (tombstoneTimestamp > latestTombstoneTimestamp)
        latestTombstoneTimestamp = tombstoneTimestamp
    }

    if (!winningIde || latestTombstoneTimestamp >= latestValueTimestamp)
      continue

    const snapshot = ideSnapshots.get(winningIde)
    if (snapshot && key in snapshot)
      merged[key] = snapshot[key]
  }

  return merged
}

export function applySyncedSettings(
  localSettings: Record<string, unknown>,
  syncedSettings: Record<string, unknown>,
): MergeSettingsResult {
  const result: Record<string, unknown> = { ...localSettings }
  const localSyncKeys = Object.keys(filterSettingsKeys(localSettings))
  const affectedKeys = new Set([...localSyncKeys, ...Object.keys(syncedSettings)])
  const overriddenKeys: string[] = []

  for (const key of localSyncKeys)
    delete result[key]

  for (const [key, value] of Object.entries(syncedSettings))
    result[key] = value

  for (const key of affectedKeys) {
    if (JSON.stringify(localSettings[key]) !== JSON.stringify(result[key]))
      overriddenKeys.push(key)
  }

  return {
    syncedSettings: result,
    overriddenKeys,
  }
}

export function mergeSettings(
  localSettings: Record<string, unknown>,
  syncMeta: SyncMeta,
  ideSnapshots: Map<AppName, Record<string, unknown>>,
): MergeSettingsResult {
  return applySyncedSettings(localSettings, buildMergedSettings(syncMeta, ideSnapshots))
}

export function parseSettings(raw: string): Record<string, unknown> {
  try {
    return jsonParse<Record<string, unknown>>(raw)
  }
  catch (error) {
    logger.error('Failed to parse settings JSON', error)
    return {}
  }
}

export function stringifySettings(settings: Record<string, unknown>): string {
  return jsonStringify(settings)
}
