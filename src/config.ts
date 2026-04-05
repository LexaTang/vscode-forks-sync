import { defineConfigObject } from 'reactive-vscode'
import { env } from 'vscode'
import { EDITOR_CONFIG_NAME_MAP } from './constants'
import * as Meta from './generated/meta'

/** The config directory name for the current IDE (e.g. "Code", "Cursor"). */
export const codeName = (EDITOR_CONFIG_NAME_MAP as Record<string, string>)[env.appName] || env.appName

export const config = defineConfigObject<Meta.ScopedConfigKeyTypeMap>(
  Meta.scopedConfigs.scope,
  Meta.scopedConfigs.defaults,
)
