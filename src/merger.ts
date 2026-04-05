import type { SyncMeta } from './types'
import micromatch from 'micromatch'
import { config } from './config'
import { jsonParse, jsonStringify } from './json'
import { logger } from './utils'

// ─── Key filtering ─────────────────────────────────────────────────────────────

/**
 * Apply whitelist + blacklist key filters to a flat settings object.
 *
 * Order of operations:
 *   1. If useIncludeKeys is true, keep only keys matching includeKeys patterns.
 *   2. Remove any keys matching excludeKeys patterns.
 */
export function filterSettingsKeys(settings: Record<string, unknown>): Record<string, unknown> {
  const includePatterns: string[] = (config['settings.includeKeys'] as string[]) ?? []
  const excludePatterns: string[] = (config['settings.excludeKeys'] as string[]) ?? []
  const useWhitelist: boolean = (config['settings.useIncludeKeys'] as boolean) ?? false

  let keys = Object.keys(settings)

  // 1. Whitelist filter
  if (useWhitelist && includePatterns.length > 0) {
    keys = micromatch(keys, includePatterns)
  }

  // 2. Blacklist filter
  if (excludePatterns.length > 0) {
    const excluded = new Set(micromatch(keys, excludePatterns))
    keys = keys.filter(k => !excluded.has(k))
  }

  return Object.fromEntries(keys.map(k => [k, settings[k]]))
}

// ─── Override mode ─────────────────────────────────────────────────────────────

/**
 * Simple whole-file override: return `incoming` filtered through key rules.
 * Used when mergeMode === 'override'.
 */
export function overrideSettings(incoming: Record<string, unknown>): Record<string, unknown> {
  return filterSettingsKeys(incoming)
}

// ─── Merge mode ────────────────────────────────────────────────────────────────

/**
 * Compute which keys changed between the previous snapshot and the current state.
 * Returns the set of changed key names.
 */
export function diffSettingsKeys(
  previous: Record<string, unknown>,
  current: Record<string, unknown>,
): string[] {
  const changed: string[] = []
  const allKeys = new Set([...Object.keys(previous), ...Object.keys(current)])

  for (const key of allKeys) {
    const prev = JSON.stringify(previous[key])
    const curr = JSON.stringify(current[key])
    if (prev !== curr)
      changed.push(key)
  }

  return changed
}

/**
 * Build the authoritative merged settings object from the last storage snapshot
 * and the SyncMeta (which contains per-key timestamps per IDE).
 *
 * Algorithm:
 *   For every key that appears in any IDE's settingsKeys map:
 *     - find the IDE that last wrote it (highest timestamp)
 *     - use that IDE's value from the `ideSnapshots` map
 *
 * Keys that appear in `storageSnapshot` but no IDE has a timestamp for are kept
 * from storageSnapshot (legacy / first-time).
 *
 * Keys in `localSettings` (current IDE) that have never been tracked at all are
 * preserved (local-only keys survive).
 */
export function mergeSettings(
  storageSnapshot: Record<string, unknown>,
  localSettings: Record<string, unknown>,
  syncMeta: SyncMeta,
  ideSnapshots: Map<string, Record<string, unknown>>,
  currentIde: string,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...storageSnapshot }

  // Collect every key that any IDE has a recorded timestamp for
  const allTrackedKeys = new Set<string>()
  for (const appMeta of Object.values(syncMeta)) {
    for (const key of Object.keys(appMeta?.settingsKeys ?? {}))
      allTrackedKeys.add(key)
  }

  for (const key of allTrackedKeys) {
    let bestTimestamp = 0
    let bestValue: unknown = storageSnapshot[key]

    for (const [ideName, appMeta] of Object.entries(syncMeta)) {
      const ts = appMeta?.settingsKeys?.[key] ?? 0
      if (ts > bestTimestamp) {
        const snapshot = ideSnapshots.get(ideName)
        if (snapshot && key in snapshot) {
          bestTimestamp = ts
          bestValue = snapshot[key]
        }
      }
    }

    result[key] = bestValue
  }

  // Preserve local-only keys (never synced by anyone)
  for (const [key, value] of Object.entries(localSettings)) {
    if (!allTrackedKeys.has(key) && !(key in storageSnapshot)) {
      result[key] = value
    }
  }

  // Apply key filters before returning
  return filterSettingsKeys(result)
}

// ─── Parse/stringify helpers ───────────────────────────────────────────────────

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
