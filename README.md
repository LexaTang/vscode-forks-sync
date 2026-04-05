# Fork Sync

Use a local shared folder to sync `settings.json`, `keybindings.json`, and extensions across VS Code forks such as VS Code, Cursor, Windsurf, and VSCodium.

## What it does

- Local-only sync, no Gist or cloud account
- Per-IDE sync timestamps
- `settings.json` supports `override` and per-key `merge`
- `keybindings.json` stays whole-file sync by design
- Settings blacklist / whitelist with glob patterns
- Poka-yoke confirmation before large settings overwrites
- Extension union sync so failed installs in one IDE do not remove entries from another
- Open VSX-style gallery config with VS Marketplace fallback for VSIX lookup
- Automatic local backup before writing `settings.json` or `keybindings.json`

## Settings behavior

### `settings.mergeMode`

- `override`: replace the synced settings subset with the storage version
- `merge`: per-key last-write-wins using per-IDE snapshots and delete tombstones

Only keys inside the sync scope are touched. Keys outside the scope always stay local.

### Sync scope

- `vscode-forks-sync.settings.excludeKeys`: keys excluded from sync
- `vscode-forks-sync.settings.includeKeys`: optional whitelist; when non-empty, only matching keys sync

Both support glob patterns such as `editor.*` or `terminal.integrated.*`.

Default exclusions include `vscode-forks-sync.*` so the extension does not overwrite its own machine-specific settings.

### Poka-yoke

`vscode-forks-sync.settings.pokaYokeThreshold` controls when Fork Sync asks for confirmation before applying a large settings pull.

## Keybindings behavior

`keybindings.json` is not merged per key. It is synced as a whole file because array-based keybindings are not safe to reconcile with the same strategy as settings.

## Extension behavior

`extensions.json` stores per-IDE successful installs plus a merged union list. Failed installs are recorded and preserved, and you can add them to a per-IDE exclude list if a fork cannot install them.

`vscode-forks-sync.extensionsGallery` is meant for Open VSX-compatible galleries. Fork Sync uses `serviceUrl` for Open VSX-style registries and falls back to VS Marketplace if lookup fails.

## Backups

Before Fork Sync writes local `settings.json` or `keybindings.json`, it creates a backup in the shared storage folder.

Default layout:

```text
~/.vscode-forks-sync/
  .backups/
    settings/
      <AppName>-YYYYMMDD-HHmmss.json
    keybindings/
      <AppName>-YYYYMMDD-HHmmss.json
```

You restore manually by copying a backup over your local file.

## Main settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `vscode-forks-sync.storagePath` | `~/.vscode-forks-sync` | Shared sync directory |
| `vscode-forks-sync.autoSync` | `true` | Sync on startup |
| `vscode-forks-sync.promptOnAutoSync` | `true` | Ask before startup sync |
| `vscode-forks-sync.promptOnExtensionSync` | `true` | Ask before applying extension changes |
| `vscode-forks-sync.settings.mergeMode` | `merge` | `override` or per-key `merge` |
| `vscode-forks-sync.settings.excludeKeys` | built-in defaults | Excluded settings glob patterns |
| `vscode-forks-sync.settings.includeKeys` | `[]` | Optional whitelist glob patterns |
| `vscode-forks-sync.settings.pokaYokeThreshold` | `10` | Confirm large settings pulls |
| `vscode-forks-sync.backupBeforeLocalWrite` | `true` | Backup before local settings/keybindings writes |
| `vscode-forks-sync.extensions.excludeExtensions` | `[]` | Excluded extension glob patterns |
| `vscode-forks-sync.extensionsGallery` | Open VSX | Open VSX-style gallery descriptor |

## License

[MIT](./LICENSE) License © [jinghaihan](https://github.com/jinghaihan), [lexatang](https://github.com/lexatang)
