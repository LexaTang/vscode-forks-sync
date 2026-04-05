import { Buffer } from 'node:buffer'
import { dirname } from 'node:path'
import type { AppName, BackupKind } from './types'
import { Uri, workspace } from 'vscode'
import { jsonParse } from './json'
import { config } from './config'
import { logger, readFile, resolvePathUri } from './utils'

function sanitizeAppName(appName: AppName): string {
  return appName.replace(/[<>:"/\\|?*]/g, '_')
}

async function ensureDirectory(uri: Uri): Promise<void> {
  try {
    await workspace.fs.stat(uri)
  }
  catch {
    await workspace.fs.createDirectory(uri)
  }
}

export function getStorageUri(): Uri {
  return resolvePathUri(config.storagePath)
}

export function getStateDirectoryUri(kind: 'settings'): Uri {
  return Uri.joinPath(getStorageUri(), '.state', kind)
}

export function getBackupDirectoryUri(kind: BackupKind): Uri {
  return Uri.joinPath(getStorageUri(), '.backups', kind)
}

export function getStorageFileUri(filename: string): Uri {
  return Uri.joinPath(getStorageUri(), filename)
}

export function getSettingsSnapshotUri(appName: AppName): Uri {
  return Uri.joinPath(getStateDirectoryUri('settings'), `${sanitizeAppName(appName)}.json`)
}

export async function ensureStorageDirectory(): Promise<void> {
  const storageUri = getStorageUri()
  await ensureDirectory(storageUri)
  await ensureDirectory(Uri.joinPath(storageUri, '.state'))
  await ensureDirectory(getStateDirectoryUri('settings'))
  await ensureDirectory(Uri.joinPath(storageUri, '.backups'))
  await ensureDirectory(getBackupDirectoryUri('settings'))
  await ensureDirectory(getBackupDirectoryUri('keybindings'))
  await ensureDirectory(Uri.joinPath(storageUri, 'vsix'))
}

export async function storageFileExists(filename: string): Promise<boolean> {
  const fileUri = getStorageFileUri(filename)
  try {
    await workspace.fs.stat(fileUri)
    return true
  }
  catch {
    return false
  }
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
    await ensureStorageDirectory()
    await ensureDirectory(Uri.file(dirname(fileUri.fsPath)))
    await workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf-8'))
    logger.info(`Storage file updated: ${filename}`)
  }
  catch (error) {
    logger.error(`Failed to write storage file: ${filename}`, error)
    throw error
  }
}

export async function readSettingsSnapshot(appName: AppName): Promise<string | undefined> {
  const uri = getSettingsSnapshotUri(appName)
  try {
    return await readFile(uri)
  }
  catch {
    return undefined
  }
}

export async function writeSettingsSnapshot(appName: AppName, content: string): Promise<void> {
  const uri = getSettingsSnapshotUri(appName)
  await ensureStorageDirectory()
  await workspace.fs.writeFile(uri, Buffer.from(content, 'utf-8'))
  logger.info(`Updated settings snapshot for ${appName}`)
}

export async function readAllSettingsSnapshots(appNames: readonly AppName[]): Promise<Map<AppName, Record<string, unknown>>> {
  const snapshots = new Map<AppName, Record<string, unknown>>()

  await Promise.all(appNames.map(async (appName) => {
    const content = await readSettingsSnapshot(appName)
    if (!content)
      return

    try {
      snapshots.set(appName, jsonParse<Record<string, unknown>>(content))
    }
    catch (error) {
      logger.warn(`Failed to parse settings snapshot for ${appName}`, error)
    }
  }))

  return snapshots
}

export async function writeBackupFile(kind: BackupKind, appName: AppName, content: string): Promise<Uri> {
  const now = new Date()
  const timestamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('') + '-' + [
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('')

  const uri = Uri.joinPath(getBackupDirectoryUri(kind), `${sanitizeAppName(appName)}-${timestamp}.json`)
  await ensureStorageDirectory()
  await workspace.fs.writeFile(uri, Buffer.from(content, 'utf-8'))
  logger.info(`Created ${kind} backup for ${appName}: ${uri.fsPath}`)
  return uri
}
