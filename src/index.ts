import type { ExtensionContext } from 'vscode'
import { defineExtension } from 'reactive-vscode'
import { commands } from 'vscode'
import { config } from './config'
import { MetaRecorder } from './recorder'
import { syncExtensions, syncKeybindings, syncProfile, syncSettings } from './sync'
import { ConfigWatcher } from './watcher'

const { activate, deactivate } = defineExtension(async (ctx: ExtensionContext) => {
  const recorder = new MetaRecorder()
  const configWatcher = new ConfigWatcher(ctx, recorder)

  ctx.subscriptions.push(
    commands.registerCommand(
      'vscode-forks-sync.syncProfile',
      () => syncProfile(ctx, recorder, { prompt: false, configWatcher }),
    ),
    commands.registerCommand(
      'vscode-forks-sync.syncSettings',
      () => syncSettings(ctx, recorder, { configWatcher }),
    ),
    commands.registerCommand(
      'vscode-forks-sync.syncKeybindings',
      () => syncKeybindings(ctx, recorder, { configWatcher }),
    ),
    commands.registerCommand(
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
