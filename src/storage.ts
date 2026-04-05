import { Buffer } from 'node:buffer'
import { Uri, workspace } from 'vscode'
import { config } from './config'
import { logger, readFile, resolvePathUri } from './utils'

export function getStorageUri(): Uri {
  return resolvePathUri(config.storagePath)
}

export async function ensureStorageDirectory(): Promise<void> {
  const storageUri = getStorageUri()
  try {
    await workspace.fs.stat(storageUri)
  }
  catch {
    await workspace.fs.createDirectory(storageUri)
    logger.info(`Created storage directory: ${storageUri.fsPath}`)
  }
}

export async function storageFileExists(filename: string): Promise<boolean> {
  const fileUri = Uri.joinPath(getStorageUri(), filename)
  try {
    await workspace.fs.stat(fileUri)
    return true
  }
  catch {
    return false
  }
}

export function getStorageFileUri(filename: string): Uri {
  return Uri.joinPath(getStorageUri(), filename)
}

export async function readStorageFile(filename: string): Promise<string> {
  try {
    return await readFile(getStorageFileUri(filename))
  }
  catch (error) {
    logger.error(`Failed to read storage file: ${filename}`, error)
    throw error
  }
}

export async function writeStorageFile(filename: string, content: string): Promise<void> {
  const fileUri = getStorageFileUri(filename)
  try {
    await workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf-8'))
    logger.info(`Storage file updated: ${filename}`)
  }
  catch (error) {
    logger.error(`Failed to write storage file: ${filename}`, error)
    throw error
  }
}
