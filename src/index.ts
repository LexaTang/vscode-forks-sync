import type { ExtensionContext } from 'vscode'
import { defineExtension } from 'reactive-vscode'
import { commands, window } from 'vscode'
import { config } from './config'
import { displayName } from './generated/meta'
import { MetaRecorder } from './recorder'
import { syncExtensions, syncKeybindings, syncProfile, syncSettings } from './sync'
import { ConfigWatcher } from './watcher'

const { activate, deactivate } = defineExtension(async (ctx: ExtensionContext) => {
  const { logger } = await import('./utils')
  logger.info('Fork Sync activated')

  const recorder = new MetaRecorder()
  const configWatcher = new ConfigWatcher(ctx, recorder)

  const register = (id: string, fn: () => Promise<void>) => {
    return commands.registerCommand(id, async () => {
      try {
        await fn()
      }
      catch (err) {
        logger.error(`Command ${id} failed`, err)
        window.showErrorMessage(`${displayName}: Command failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    })
  }

  ctx.subscriptions.push(
    register(
      'vscode-forks-sync.syncProfile',
      () => syncProfile(ctx, recorder, { prompt: false, configWatcher }),
    ),
    register(
      'vscode-forks-sync.syncSettings',
      () => syncSettings(ctx, recorder, { configWatcher }),
    ),
    register(
      'vscode-forks-sync.syncKeybindings',
      () => syncKeybindings(ctx, recorder, { configWatcher }),
    ),
    register(
      'vscode-forks-sync.syncExtensions',
      () => syncExtensions(ctx, recorder, {
        prompt: config.promptOnExtensionSync,
        configWatcher,
      }),
    ),
  )

  if (config.autoSync) {
    await syncProfile(ctx, recorder, {
      prompt: config.promptOnAutoSync,
      silent: !config.promptOnAutoSync,
      configWatcher,
    })
  }

  await configWatcher.start()

  ctx.subscriptions.push({
    dispose: () => configWatcher.dispose(),
  })
})

export { activate, deactivate }
