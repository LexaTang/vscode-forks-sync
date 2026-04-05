import { Buffer } from 'node:buffer'
import { homedir, platform } from 'node:os'
import process from 'node:process'
import { useLogger } from 'reactive-vscode'
import { Uri, workspace } from 'vscode'
import { displayName } from './generated/meta'

import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { config } from './config'

let _baseLogger: ReturnType<typeof useLogger> | undefined
function getBaseLogger() {
  if (!_baseLogger)
    _baseLogger = useLogger(displayName)
  return _baseLogger
}

async function writeLogToFile(level: string, message: string, ...args: any[]) {
  try {
    const storageDir = resolvePathUri(config.storagePath).fsPath
    await mkdir(storageDir, { recursive: true })
    const logPath = join(storageDir, 'vscode-forks-sync.log')
    
    const now = new Date()
    const ts = now.toISOString().replace('T', ' ').slice(0, 19)
    const { env } = await import('vscode')
    
    let fullMessage = `[${ts}] [${env.appName}] [${level}] ${message}`
    if (args.length > 0) {
      fullMessage += ' ' + args.map(a => 
        a instanceof Error ? a.stack || a.message : 
        typeof a === 'object' ? JSON.stringify(a) : String(a)
      ).join(' ')
    }
    fullMessage += '\n'
    
    await appendFile(logPath, fullMessage, 'utf-8')
  } catch (err) {
    console.error('Failed to write to log file:', err)
  }
}

export const logger = {
  info: (message: string, ...args: any[]) => {
    getBaseLogger().info(message, ...args)
    writeLogToFile('INFO', message, ...args)
  },
  warn: (message: string, ...args: any[]) => {
    getBaseLogger().warn(message, ...args)
    writeLogToFile('WARN', message, ...args)
  },
  error: (message: string, ...args: any[]) => {
    getBaseLogger().error(message, ...args)
    writeLogToFile('ERROR', message, ...args)
  },
}

import type { ExtensionContext } from 'vscode'

export async function findConfigFile(ctx: ExtensionContext, file: string): Promise<string | undefined> {
  const userDir = Uri.joinPath(ctx.globalStorageUri, '../../').fsPath
  const path = join(userDir, file)
  
  try {
    await workspace.fs.stat(Uri.file(path))
    logger.info(`Found ${file} at: ${path}`)
    return path
  }
  catch {
    logger.warn(`Could not find ${file} at API location: ${path}`)
    return undefined
  }
}

export function resolvePathUri(path: string): Uri {
  if (path.startsWith('~')) {
    return Uri.file(path.replace('~', homedir()))
  }
  return Uri.file(path)
}

export async function readFile(uri: Uri): Promise<string> {
  const buffer = await workspace.fs.readFile(uri)
  return Buffer.from(buffer).toString('utf-8')
}

export async function compareFsMtime(path1: string, path2: string): Promise<1 | -1 | 0 | undefined> {
  try {
    const [stat1, stat2] = await Promise.all([
      workspace.fs.stat(Uri.file(path1)),
      workspace.fs.stat(Uri.file(path2)),
    ])
    if (stat1.mtime > stat2.mtime)
      return 1
    else if (stat1.mtime < stat2.mtime)
      return -1
    else
      return 0
  }
  catch (error) {
    logger.warn(`Failed to compare file modification times: ${error}`)
  }
}
