# Official Pi Engine Documentation Index

Authoritative docs ship inside the installed engine package, so their location
depends on the machine, the node install and the store layout. **Resolve the
root at runtime; never paste an absolute path into a skill file.**

## Resolve the base paths

```bash
# 0. FIRST: what does npm publish as latest? This is the version you build
#    against (SKILL.md §0). If the repo pin lags, align it and reinstall BEFORE
#    reading any types.
npm view @earendil-works/pi-coding-agent version
npm view @earendil-works/pi-coding-agent dist-tags --json   # 'latest' vs 'legacy-node20'

# 1. Engine version
/plugin-dev doctor          # prints installed version, latest-on-npm, docs dir
                            # and changelog head; warns when the pin lags
# (the extension resolves it with createRequire + a node_modules walk-up, and
# honours PI_PACKAGE_DIR when Pi pins its own package directory)

# 2. By hand — require.resolve() cannot be used here: the engine's package.json
#    has an exports map without a "." entry (ERR_PACKAGE_PATH_NOT_EXPORTED).
node -e "const fs=require('node:fs'),p=require('node:path');for(let d=process.cwd();;d=p.dirname(d)){const c=p.join(d,'node_modules','@earendil-works','pi-coding-agent','package.json');if(fs.existsSync(c)){console.log(c);break}if(p.dirname(d)===d)break}"
```

Base paths, once the package root is known:

| What | Path |
|---|---|
| Docs directory | `<engine package root>/docs` |
| Examples directory | `<engine package root>/examples` |
| Changelog | `<engine package root>/CHANGELOG.md` |
| Extension & event types | `<engine package root>/dist/core/extensions/types.d.ts` |

## Key documentation files by topic

| Topic | File in `<engine package root>/docs/` |
|---|---|
| Extensions, tools, events, commands, UI context | `extensions.md` |
| Agent Skills specification & discovery | `skills.md` |
| TUI components, focus, overlays, themes | `tui.md` |
| Packages, `pi` manifest, distribution | `packages.md` |
| Session format & entries | `session-format.md` |
| Sessions, branching, resume | `sessions.md` |
| Custom providers | `custom-provider.md` |
| Models registry | `models.md` |
| Keybindings | `keybindings.md` |
| Settings, resources, flags | `settings.md` |
| Prompt templates | `prompt-templates.md` |
| RPC extension UI (modes, unsupported calls) | `rpc-extension-ui.md` |
| Environment variables | `environment-variables.md` |
| Security & project trust | `security.md` |
| SDK embedding | `sdk.md` |
| Compaction | `compaction.md` |
| Containerization / sandboxing | `containerization.md` |

Skill-owned companions: `references/event-and-api-surface.md` (every event and
`ExtensionAPI` method, engine-verified), `references/lifecycle-and-events.md`
(quick event reference) and `references/tools-and-schema.md` (tool contract).

## Verify the version and the breaking changes

Before writing or refactoring any plugin:

1. Determine the installed engine version **and the latest published one**:
   ```bash
   npm view @earendil-works/pi-coding-agent version
   /plugin-dev doctor
   ```
   If the repo `devDependencies` pin is behind npm's `latest`, fix the pin and
   `npm install` first. A stale pin type-checks every plugin in the workspace
   against an older API than the one actually running.
2. Read the top of the changelog for breaking changes affecting
   `ExtensionEvent`, `SessionEntry`, `ToolResultMessage` or `SessionManager`:
   ```bash
   node -e "const fs=require('node:fs'),p=require('node:path');for(let d=process.cwd();;d=p.dirname(d)){const c=p.join(d,'node_modules','@earendil-works','pi-coding-agent','CHANGELOG.md');if(fs.existsSync(c)){console.log(fs.readFileSync(c,'utf8').split(/\r?\n/).slice(0,40).join('\n'));break}if(p.dirname(d)===d)break}"
   ```
3. Re-derive the subscription surface after an upgrade:
   ```bash
   grep -n '    on(event:' <engine package root>/dist/core/extensions/types.d.ts
   ```
   The event list, the result contract of each event, and the return type of
   `pi.on()` all change between minors. Treat any event list in a skill file as
   a hint and the installed `types.d.ts` as the contract.
