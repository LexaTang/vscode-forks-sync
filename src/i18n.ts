import { env } from 'vscode'

type TranslationKey = string
type Translation = Record<TranslationKey, string>

// 英文翻译
const EN: Translation = {
  // Display name
  'displayName': 'Fork Sync',

  // Commands
  'cmd.syncProfile.title': 'Sync Everything',
  'cmd.syncSettings.title': 'Sync Settings',
  'cmd.syncKeybindings.title': 'Sync Keybindings',
  'cmd.syncExtensions.title': 'Sync Extensions',
  'cmd.category': 'Fork Sync',

  // Config
  'config.title': 'Fork Sync',
  'config.storagePath.description': 'The local directory used to store shared sync data between IDE forks.',
  'config.autoSync.description': 'Automatically sync on startup.',
  'config.promptOnAutoSync.description': 'Show a confirmation prompt before auto-syncing on startup.',
  'config.promptOnExtensionSync.description': 'Show a confirmation prompt before applying extension changes.',
  'config.settings.mergeMode.description': 'Strategy for resolving settings.json conflicts across IDEs.',
  'config.settings.mergeMode.override': 'Whole-file override: whichever IDE has the newest file mtime wins entirely.',
  'config.settings.mergeMode.merge': 'Per-key merge: each key is individually resolved to the value last changed by any IDE.',
  'config.settings.excludeKeys.description': 'Settings keys excluded from sync. Supports glob patterns like \'editor.*\'. Excluded keys are always kept local.',
  'config.settings.includeKeys.description': 'Optional settings whitelist. When non-empty, only matching keys participate in sync; all other keys stay local. Supports glob patterns like \'editor.*\'.',
  'config.settings.pokaYokeThreshold.description': 'Ask for confirmation before applying a settings pull that would overwrite this many synced keys or more.',
  'config.backupBeforeLocalWrite.description': 'Create a per-IDE backup before writing local settings.json or keybindings.json. Restore is manual.',
  'config.extensions.excludeExtensions.description': 'Extension IDs excluded from sync. Supports glob patterns and is matched case-insensitively.',
  'config.extensionsGallery.description': 'Open VSX-compatible gallery used for VSIX lookup. Fork Sync currently uses serviceUrl for Open VSX-style registries and falls back to VS Marketplace.',

  // Messages
  'msg.syncProfile.prompt': 'Do you want to sync your config?',
  'msg.syncProfile.sync': 'Sync',
  'msg.syncProfile.skip': 'Skip',
  'msg.syncProfile.complete': 'Config updated',

  'msg.settings.confirmApply': 'applying sync will overwrite {{count}} settings keys on this IDE. Continue?',
  'msg.settings.reviewDetails': 'Review Details',
  'msg.settings.continue': 'Continue',
  'msg.settings.cancel': 'Cancel',
  'msg.settings.confirmReview': 'Review the settings changes. Do you want to continue?',
  'msg.settings.syncDetails': '# {{displayName}} - Settings Sync Details\n\nThe following {{count}} keys will be modified or overwritten by the incoming sync:\n',
  'msg.settings.restored': 'Settings restored from storage',
  'msg.settings.initialized': 'Settings file initialized',
  'msg.settings.synced': 'Settings synced',

  'msg.keybindings.restored': 'Keybindings restored from storage',
  'msg.keybindings.initialized': 'Keybindings file initialized',
  'msg.keybindings.synced': 'Keybindings synced',

  'msg.extensions.confirmApply': 'applying sync will install/uninstall {{count}} extensions on this IDE. Continue?',
  'msg.extensions.installTitle': 'Installing extensions...',
  'msg.extensions.installed': 'Extensions installed',
  'msg.extensions.installFailed': 'Some extensions failed to install. Command continued with successfully installed extensions.',
  'msg.extensions.failedInstalls': '# Failed to install',
  'msg.extensions.confirmSkip': 'Skip {0}?',
  'msg.extensions.confirmUninstall': 'Uninstall {0}?',
  'msg.extensions.uninstallFailed': 'Failed to uninstall {0}',
  'msg.extensions.initialized': 'Extension list initialized',
  'msg.extensions.synced': 'Extensions synced',

  'msg.error.commandFailed': 'Command failed: {0}',
}

// 简体中文翻译
const ZH_CN: Translation = {
  // Display name
  'displayName': 'Fork Sync',

  // Commands
  'cmd.syncProfile.title': '同步所有设置',
  'cmd.syncSettings.title': '同步设置',
  'cmd.syncKeybindings.title': '同步快捷键',
  'cmd.syncExtensions.title': '同步扩展',
  'cmd.category': 'Fork Sync',

  // Config
  'config.title': 'Fork Sync',
  'config.storagePath.description': '用于存储 IDE 之间共享同步数据的本地目录。',
  'config.autoSync.description': '在启动时自动同步。',
  'config.promptOnAutoSync.description': '在启动时自动同步前显示确认提示。',
  'config.promptOnExtensionSync.description': '在应用扩展更改前显示确认提示。',
  'config.settings.mergeMode.description': '解决 IDE 之间 settings.json 冲突的策略。',
  'config.settings.mergeMode.override': '整文件覆盖：具有最新文件 mtime 的 IDE 完全获胜。',
  'config.settings.mergeMode.merge': '按键合并：每个键单独解析为任何 IDE 最后修改的值。',
  'config.settings.excludeKeys.description': '从同步中排除的设置键。支持 glob 模式，如 \'editor.*\'。排除的键始终保持本地。',
  'config.settings.includeKeys.description': '可选的设置白名单。如果非空，仅匹配的键参与同步；所有其他键保持本地。支持 glob 模式，如 \'editor.*\'。',
  'config.settings.pokaYokeThreshold.description': '在应用可能覆盖此数量或更多同步键的设置拉取前要求确认。',
  'config.backupBeforeLocalWrite.description': '在写入本地 settings.json 或 keybindings.json 前创建按 IDE 分类的备份。恢复是手动的。',
  'config.extensions.excludeExtensions.description': '从同步中排除的扩展 ID。支持 glob 模式，不区分大小写。',
  'config.extensionsGallery.description': '用于 VSIX 查找的 Open VSX 兼容库。Fork Sync 目前为 Open VSX 风格的注册表使用 serviceUrl，并回退到 VS Marketplace。',

  // Messages
  'msg.syncProfile.prompt': '要同步你的配置吗？',
  'msg.syncProfile.sync': '同步',
  'msg.syncProfile.skip': '跳过',
  'msg.syncProfile.complete': '配置已更新',

  'msg.settings.confirmApply': '应用同步将在此 IDE 上覆盖 {{count}} 个设置键。继续？',
  'msg.settings.reviewDetails': '查看详情',
  'msg.settings.continue': '继续',
  'msg.settings.cancel': '取消',
  'msg.settings.confirmReview': '审查设置更改。要继续吗？',
  'msg.settings.syncDetails': '# {{displayName}} - 设置同步详情\n\n以下 {{count}} 个键将被修改或被传入同步覆盖：\n',
  'msg.settings.restored': '设置已从存储恢复',
  'msg.settings.initialized': '设置文件已初始化',
  'msg.settings.synced': '设置已同步',

  'msg.keybindings.restored': '快捷键已从存储恢复',
  'msg.keybindings.initialized': '快捷键文件已初始化',
  'msg.keybindings.synced': '快捷键已同步',

  'msg.extensions.confirmApply': '应用同步将在此 IDE 上安装/卸载 {{count}} 个扩展。继续？',
  'msg.extensions.installTitle': '正在安装扩展...',
  'msg.extensions.installed': '扩展已安装',
  'msg.extensions.installFailed': '某些扩展安装失败。命令继续执行已成功安装的扩展。',
  'msg.extensions.failedInstalls': '# 安装失败',
  'msg.extensions.confirmSkip': '跳过 {0}？',
  'msg.extensions.confirmUninstall': '卸载 {0}？',
  'msg.extensions.uninstallFailed': '卸载 {0} 失败',
  'msg.extensions.initialized': '扩展列表已初始化',
  'msg.extensions.synced': '扩展已同步',

  'msg.error.commandFailed': '命令失败：{0}',
}

function getLanguage(): string {
  const lang = env.language
  // VS Code language can be like 'zh-cn', 'en', 'en-us', etc.
  return lang.toLowerCase()
}

function getTranslations(): Translation {
  const lang = getLanguage()
  if (lang.startsWith('zh')) {
    return ZH_CN
  }
  return EN
}

/**
 * Get translation for a key with optional template variables
 * @param key Translation key
 * @param vars Optional object with template variables or single value for {0}
 * @returns Translated string
 */
export function t(key: string, vars?: Record<string, string | number> | string): string {
  const translations = getTranslations()
  let text = translations[key] || translations[`${key}`] || key

  if (vars === undefined) {
    return text
  }

  // Handle both object and string (for {0})
  if (typeof vars === 'string' || typeof vars === 'number') {
    text = text.replace('{0}', String(vars))
  }
  else {
    // Replace template variables like {{displayName}} or {{count}}
    Object.entries(vars).forEach(([k, v]) => {
      text = text.replace(new RegExp(`{{${k}}}`, 'g'), String(v))
    })
  }

  return text
}

/**
 * Get all translations for a language
 */
export function getI18n(): Translation {
  return getTranslations()
}

export { EN, ZH_CN }
