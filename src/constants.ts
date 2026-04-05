import type { SyncMeta } from './types'

/// keep-sorted
export const EDITOR_CONFIG_NAME_MAP = {
  'Antigravity': 'Antigravity',
  'Cursor': 'Cursor',
  'Visual Studio Code - Insiders': 'Code - Insiders',
  'Visual Studio Code': 'Code',
  'VSCodium - Insiders': 'VSCodium - Insiders',
  'VSCodium': 'VSCodium',
  'Windsurf': 'Windsurf',
  'Windsurf Next': 'Windsurf Next',
} as const

export const DEFAULT_SYNC_META: SyncMeta = {}

export const VSCODE_MARKETPLACE_QUERY_URL = 'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery'

export const DEFAULT_EXTENSIONS_GALLERY = {
  serviceUrl: 'https://open-vsx.org/vscode/gallery',
  itemUrl: 'https://open-vsx.org/vscode/item',
}
