import { Buffer } from 'node:buffer'
import { Uri, workspace } from 'vscode'
import { config } from './config'
import { logger, readFile } from './utils'

export async function getSettings(path: string): Promise<string> {
  try {
    return Buffer.from(await workspace.fs.readFile(Uri.file(path))).toString('utf-8')
  }
  catch (error) {
    logger.error(`Failed to read settings file: ${path}`, error)
    throw error
  }
}

export async function setSettings(path: string, settings: string | Record<string, unknown>): Promise<void> {
  try {
    const content = typeof settings === 'string'
      ? settings
      : JSON.stringify(settings, null, 2)

    if (!content)
      throw new Error('Settings content is empty')

    await workspace.fs.writeFile(Uri.file(path), Buffer.from(content, 'utf8'))
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

export async function setKeybindings(path: string, keybindings: string): Promise<void> {
  try {
    await workspace.fs.writeFile(Uri.file(path), Buffer.from(keybindings, 'utf8'))
    logger.info(`Keybindings updated: ${path}`)
  }
  catch (error) {
    logger.error(`Failed to write keybindings file: ${path}`, error)
    throw error
  }
}
