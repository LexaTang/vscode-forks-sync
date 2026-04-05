import { Buffer } from 'node:buffer'
import type { AppName } from './types'
import { env, Uri, workspace } from 'vscode'
import { config } from './config'
import { writeBackupFile } from './storage'
import { logger } from './utils'

interface WriteLocalFileOptions {
  backup?: boolean
}

async function maybeBackupLocalFile(path: string, kind: 'settings' | 'keybindings', backup = config.backupBeforeLocalWrite): Promise<void> {
  if (!backup)
    return

  try {
    const content = Buffer.from(await workspace.fs.readFile(Uri.file(path))).toString('utf-8')
    await writeBackupFile(kind, env.appName as AppName, content)
  }
  catch (error) {
    logger.warn(`Skipping ${kind} backup for ${path}`, error)
  }
}

async function writeLocalFile(path: string, content: string, kind: 'settings' | 'keybindings', options: WriteLocalFileOptions = {}): Promise<void> {
  await maybeBackupLocalFile(path, kind, options.backup)
  await workspace.fs.writeFile(Uri.file(path), Buffer.from(content, 'utf8'))
}

export async function getSettings(path: string): Promise<string> {
  try {
    return Buffer.from(await workspace.fs.readFile(Uri.file(path))).toString('utf-8')
  }
  catch (error) {
    logger.error(`Failed to read settings file: ${path}`, error)
    throw error
  }
}

export async function setSettings(path: string, settings: string | Record<string, unknown>, options: WriteLocalFileOptions = {}): Promise<void> {
  try {
    const content = typeof settings === 'string'
      ? settings
      : JSON.stringify(settings, null, 2)

    if (!content)
      throw new Error('Settings content is empty')

    await writeLocalFile(path, content, 'settings', options)
    logger.info(`Settings updated: ${path}`)
  }
  catch (error) {
    logger.error(`Failed to write settings file: ${path}`, error)
    throw error
  }
}

export async function getKeybindings(path: string): Promise<string> {
  try {
    return Buffer.from(await workspace.fs.readFile(Uri.file(path))).toString('utf-8')
  }
  catch (error) {
    logger.error(`Failed to read keybindings file: ${path}`, error)
    throw error
  }
}

export async function setKeybindings(path: string, keybindings: string, options: WriteLocalFileOptions = {}): Promise<void> {
  try {
    await writeLocalFile(path, keybindings, 'keybindings', options)
    logger.info(`Keybindings updated: ${path}`)
  }
  catch (error) {
    logger.error(`Failed to write keybindings file: ${path}`, error)
    throw error
  }
}
