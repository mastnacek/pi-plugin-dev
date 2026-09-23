# Official Pi Engine Documentation Index

All authoritative documentation files are located on this machine inside the installed engine directory:

## Base Paths

- **Engine Root:** `D:\02_knihovny_path\node-v22.17.1-win-x64\node_modules\@earendil-works\pi-coding-agent\`
- **Docs Directory:** `D:\02_knihovny_path\node-v22.17.1-win-x64\node_modules\@earendil-works\pi-coding-agent\docs\`
- **Examples Directory:** `D:\02_knihovny_path\node-v22.17.1-win-x64\node_modules\@earendil-works\pi-coding-agent\examples\`
- **Engine Changelog:** `D:\02_knihovny_path\node-v22.17.1-win-x64\node_modules\@earendil-works\pi-coding-agent\CHANGELOG.md`

---

## Key Documentation Files by Topic

When implementing or debugging, read these specific files directly rather than guessing APIs:

| Topic | Local File Path |
|---|---|
| **Extensions & Tools** | `D:\02_knihovny_path\node-v22.17.1-win-x64\node_modules\@earendil-works\pi-coding-agent\docs\extensions.md` |
| **Agent Skills** | `D:\02_knihovny_path\node-v22.17.1-win-x64\node_modules\@earendil-works\pi-coding-agent\docs\skills.md` |
| **TUI & Components** | `D:\02_knihovny_path\node-v22.17.1-win-x64\node_modules\@earendil-works\pi-coding-agent\docs\tui.md` |
| **Packages & npm Distribution** | `D:\02_knihovny_path\node-v22.17.1-win-x64\node_modules\@earendil-works\pi-coding-agent\docs\packages.md` |
| **Session Format & Entries** | `D:\02_knihovny_path\node-v22.17.1-win-x64\node_modules\@earendil-works\pi-coding-agent\docs\session-format.md` |
| **Custom Providers** | `D:\02_knihovny_path\node-v22.17.1-win-x64\node_modules\@earendil-works\pi-coding-agent\docs\custom-provider.md` |
| **Models Registry** | `D:\02_knihovny_path\node-v22.17.1-win-x64\node_modules\@earendil-works\pi-coding-agent\docs\models.md` |
| **Keybindings** | `D:\02_knihovny_path\node-v22.17.1-win-x64\node_modules\@earendil-works\pi-coding-agent\docs\keybindings.md` |
| **Settings & Flags** | `D:\02_knihovny_path\node-v22.17.1-win-x64\node_modules\@earendil-works\pi-coding-agent\docs\settings.md` |
| **Prompt Templates** | `D:\02_knihovny_path\node-v22.17.1-win-x64\node_modules\@earendil-works\pi-coding-agent\docs\prompt-templates.md` |
| **SDK Embedding** | `D:\02_knihovny_path\node-v22.17.1-win-x64\node_modules\@earendil-works\pi-coding-agent\docs\sdk.md` |

---

## How to Verify Current Version & Breaking Changes

Before writing or refactoring any plugin:

1. Check installed engine version:
   ```bash
   node -e "console.log(require('@earendil-works/pi-coding-agent/package.json').version)"
   ```
2. Check the top of `CHANGELOG.md` for recent breaking changes affecting `ExtensionEvent`, `SessionEntry`, `ToolResultMessage`, or `SessionManager`:
   ```bash
   head -n 40 D:\02_knihovny_path\node-v22.17.1-win-x64\node_modules\@earendil-works\pi-coding-agent\CHANGELOG.md
   ```
