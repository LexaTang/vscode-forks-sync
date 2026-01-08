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
} as const

export const DEFAULT_SYNC_META: SyncMeta = {}
