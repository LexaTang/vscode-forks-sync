import type { EDITOR_CONFIG_NAME_MAP } from './constants'

// ─── IDE / App ────────────────────────────────────────────────────────────────

export type AppName = keyof typeof EDITOR_CONFIG_NAME_MAP

export type SyncType = 'settings' | 'extensions' | 'keybindings'

export type SettingsMergeMode = 'override' | 'merge'

// ─── Sync metadata (vscode-forks-sync.json) ──────────────────────────────────────────

/**
 * Per-IDE sync metadata stored in vscode-forks-sync.json.
 *
 * In "override" mode only the top-level timestamps are used.
 * In "merge" mode `settingsKeys` additionally tracks the last time each
 * individual settings key was written by *this* IDE, enabling per-key winner
 * resolution across IDEs.
 */
export interface AppSyncMeta {
  settings?: number
  keybindings?: number
  extensions?: number
  /**
   * Map of settings key → Unix timestamp (ms) of last write by this IDE.
   * Only populated when mergeMode === 'merge'.
   */
  settingsKeys?: Record<string, number>
}

export type SyncMeta = Partial<Record<AppName, AppSyncMeta>>

// ─── Extensions storage (extensions.json) ────────────────────────────────────

export interface ExtensionsGallery {
  serviceUrl: string
  itemUrl?: string
  /** Template for resolving asset URLs, e.g. open-vsx uses a custom one. */
  resourceUrlTemplate?: string
}

/**
 * New extensions.json format.
 *
 * `perIde`  – per-IDE list of *successfully installed* extension IDs.
 *             Updated only after a successful install; failed installs never
 *             remove other IDEs' contributions.
 * `merged`  – union of all perIde lists; this is what other IDEs install from.
 * `gallery` – the gallery endpoint written at upload time so any IDE can
 *             download extensions from the same source.
 */
export interface ExtensionStorage {
  gallery?: ExtensionsGallery
  perIde: Partial<Record<AppName, string[]>>
  merged: string[]
  /**
   * Per-IDE list of extension IDs that failed to install (even via VSIX).
   * Written after a failed install attempt so users can see what needs manual action.
   */
  failedInstalls?: Partial<Record<AppName, string[]>>
  /**
   * Per-IDE exclusion list — extensions in this list are excluded from sync
   * on that specific IDE only, without affecting other IDEs.
   * Users can add entries here when an extension consistently fails to install.
   */
  excludePerIde?: Partial<Record<AppName, string[]>>
}

// ─── VSCode extension config on disk ─────────────────────────────────────────

export interface ExtensionConfig {
  identifier: ExtensionIdentifier
  version: string
  location: ExtensionLocation
  relativeLocation: string
  metadata: ExtensionMetadata
}

export interface ExtensionIdentifier {
  id: string
  uuid: string
}

export interface ExtensionLocation {
  $mid: number
  path: string
  scheme: string
}

export interface ExtensionMetadata {
  installedTimestamp: number
  pinned: boolean
  source: string
  id: string
  publisherId: string
  publisherDisplayName: string
  targetPlatform: string
  updated: boolean
  isPreReleaseVersion: boolean
  hasPreReleaseVersion: boolean
  isApplicationScoped: boolean
  isMachineScoped: boolean
  isBuiltin: boolean
  preRelease: boolean
}

// ─── VS Marketplace query ─────────────────────────────────────────────────────

export interface ExtensionQueryResponse {
  results: {
    extensions: MarketplaceExtension[]
  }[]
}

export interface MarketplaceExtension {
  extensionId: string
  extensionName: string
  displayName: string
  publisher: {
    publisherId: string
    publisherName: string
    displayName: string
  }
  versions: MarketplaceExtensionVersion[]
}

export interface MarketplaceExtensionVersion {
  version: string
  lastUpdated: string
  files: MarketplaceExtensionFile[]
}

export interface MarketplaceExtensionFile {
  assetType: string
  source: string
}

// ─── Open VSX query ───────────────────────────────────────────────────────────

export interface OpenVsxExtension {
  namespaceUrl: string
  files: Record<string, string>
  name: string
  namespace: string
  version: string
  downloadCount: number
}

// ─── Internal diff helpers ────────────────────────────────────────────────────

export interface ExtensionsDiff {
  toInstall: string[]
  toDelete: string[]
}

export interface SyncCommandContext {
  prompt?: boolean
  silent?: boolean
  configWatcher?: import('./watcher').ConfigWatcher
}
