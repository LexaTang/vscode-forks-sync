# Fork Sync

**Synchronize settings, keybindings and extensions across VSCode and its forks** (Cursor, Windsurf, VSCodium, etc.) using a local shared directory — no GitHub Gist required.

## Features

- **Local-only sync** — all data lives in a folder you control (`~/.vscode-forks-sync` by default)
- **Per-IDE sync timestamps** — each IDE independently tracks when it last synced each config type
- **Smart settings merge** — choose between _override_ (last-write-wins by file) or _merge_ (per-key last-write-wins) modes
- **Key blacklist & whitelist** — exclude machine-specific keys (e.g. `telemetry.*`) or sync only a curated set via glob patterns
- **Failure-safe extension list** — extensions are tracked per-IDE; a failed install in one IDE never removes extensions contributed by another
- **Configurable extension gallery** — defaults to [open-vsx.org](https://open-vsx.org) with VS Marketplace as fallback for VSIX downloads

## Supported IDEs

- Visual Studio Code
- Visual Studio Code Insiders
- Cursor
- Windsurf / Windsurf Next
- VSCodium / VSCodium Insiders
- Antigravity

## Configuration

| Setting | Default | Description |
|---|---|---|
| `vscode-forks-sync.storagePath` | `~/.vscode-forks-sync` | Shared sync directory |
| `vscode-forks-sync.autoSync` | `true` | Sync on startup |
| `vscode-forks-sync.settings.mergeMode` | `merge` | `override` or `merge` |
| `vscode-forks-sync.settings.excludeKeys` | `[...]` | Keys never synced (glob patterns) |
| `vscode-forks-sync.settings.useIncludeKeys` | `false` | Enable whitelist mode |
| `vscode-forks-sync.settings.includeKeys` | `[]` | Keys to sync in whitelist mode |
| `vscode-forks-sync.extensions.excludeExtensions` | `[]` | Extensions never synced |
| `vscode-forks-sync.extensionsGallery` | open-vsx | Gallery for VSIX downloads |

## License

[MIT](./LICENSE) License © [jinghaihan](https://github.com/jinghaihan), [lexatang](https://github.com/lexatang)
