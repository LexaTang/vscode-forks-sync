export type AppName = string

export type SyncType = 'settings' | 'extensions' | 'keybindings'

export type SettingsMergeMode = 'override' | 'merge'

export type BackupKind = 'settings' | 'keybindings'

export interface AppSyncMeta {
  settings?: number
  keybindings?: number
  extensions?: number
  settingsKeys?: Record<string, number>
  settingsTombstones?: Record<string, number>
}

export type SyncMeta = Partial<Record<AppName, AppSyncMeta>>

export interface SettingsSyncChanges {
  upserted: string[]
  deleted: string[]
}

export interface MergeSettingsResult {
  syncedSettings: Record<string, unknown>
  overriddenKeys: string[]
  keySources?: Record<string, string>
}

export interface ExtensionsGallery {
  serviceUrl: string
  itemUrl?: string
}

export interface ExtensionStorage {
  gallery?: ExtensionsGallery
  perIde: Partial<Record<AppName, string[]>>
  merged: string[]
  failedInstalls?: Partial<Record<AppName, string[]>>
  excludePerIde?: Partial<Record<AppName, string[]>>
}

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

export interface OpenVsxExtension {
  namespaceUrl: string
  files: Record<string, string>
  name: string
  namespace: string
  version: string
  downloadCount: number
}

export interface ExtensionsDiff {
  toInstall: string[]
  toDelete: string[]
}

export interface SyncCommandContext {
  prompt?: boolean
  silent?: boolean
  configWatcher?: import('./watcher').ConfigWatcher
}
