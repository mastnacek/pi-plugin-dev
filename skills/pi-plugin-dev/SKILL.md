---
name: pi-plugin-dev
description: Expert guide for creating, editing, testing, and debugging Pi coding agent plugins, extensions, skills, and packages. Triggers on any task involving Pi extensions, custom tools, slash commands, autocomplete, or Pi agent APIs.
---

# Pi Plugin & Skill Development

Authoritative guide for developing extensions and skills for `@earendil-works/pi-coding-agent`.

## Core Philosophy & Progressive Disclosure

Do not load full API references unless needed. Follow these fast rules, then read specific reference files on demand:

- Command completions & Trailing Space Contract: `references/command-completions.md`
- Custom tools, TypeBox & StringEnum: `references/tools-and-schema.md`
- Lifecycle events & engine boundaries (version-relative, re-derive after every upgrade): `references/lifecycle-and-events.md`
- Every event + `ExtensionAPI` method, with contracts: `references/event-and-api-surface.md`
- State persistence (branch-aware vs global): `references/state-persistence.md`
- TUI components, width safety & subagent isolation: `references/tui-and-components.md`
- **Vertical Slice Architecture (folder layout, slice membership decisions): `references/vsa-architecture.md`**
- Official local Pi docs & changelog: `references/api-docs-index.md`

---

## 0. Pin to Latest (before anything else)

**Never build against a version you merely assume is current.** Engine APIs move
every few weeks, and a plugin written against a stale surface type-checks against
a lie. Before the first edit of any plugin task:

```bash
# 1. What does npm publish as latest?
npm view @earendil-works/pi-coding-agent version

# 2. What is actually installed and what does this repo pin?
node -e "console.log(require('@earendil-works/pi-coding-agent/package.json').version)"
grep -rn "pi-coding-agent" package.json

# 3. If the repo pin is behind, align it BEFORE writing code, then re-derive the
#    surface you are about to use from the installed types.
npm install
```

Three rules follow from this:

- **The pin must equal `latest`, not a range you inherited.** A stale `^0.85.1`
  in a workspace `devDependencies` silently type-checks every plugin in the
  monorepo against a two-major-versions-old API while the runtime is newer. That
  is not a lint nit: it produces code that compiles against types the running
  engine does not have.
- **Derive the surface from the installed `dist/`, not from memory or this file.**
  Grep the event table before you rely on any event name or return contract:
  ```bash
  grep -n '    on(event:' <engine package root>/dist/core/extensions/types.d.ts
  ```
- **Re-read the changelog top for breaking changes** before trusting any event,
  `SessionEntry` shape, or tool result contract. See `references/api-docs-index.md`.

`/plugin-dev doctor` prints installed vs. latest and warns on a gap, so it is the
fastest way to confirm you are current. Version claims in these skill files are
examples, not authority — the installed package always wins.

---

## Fast Development Checklist

### 1. Package Manifest (`package.json`)
- Use `"type": "module"`.
- Core packages (`@earendil-works/pi-ai`, `@earendil-works/pi-agent-core`, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, `typebox`) MUST be in `peerDependencies: { "*": "*" }`. Never bundle them in `dependencies`.
- Third-party runtime libraries go into `dependencies` (Pi uses production installs, so `devDependencies` are absent at runtime).
- Add a `pi` manifest (`extensions` / `skills` paths) and a `files` array so the package cannot publish the whole checkout, and ship a `test` script so the plugin proves it does something beyond compiling.
- Install the package from its GitHub repository (`git:github.com/<owner>/<repo>`), never from the local development checkout — a local path drifts from the repo and defeats distribution (AGENTS §8). After the first successful commit+push, `pi-plugin-dev` offers this install automatically (`/plugin-dev install on|off`).

### 2. Custom Tools (`pi.registerTool`)
- **String Enums:** Always use `StringEnum(["a", "b"] as const)` from `@earendil-works/pi-ai`. Never use `Type.Union`/`Type.Literal` (breaks Google Gemini API).
- **Error Reporting:** Always `throw new Error(...)` to signal a tool error (`isError: true`). Returning an object never sets the error flag.
- **Payloads:** Must be strictly JSON-compatible (arrays readonly).

### 3. Autocomplete & Slash Commands (`getArgumentCompletions`)
- **Trailing Space Contract:**
  - Non-terminal choices (have sub-parameters): append space (`value: `${subcmd} ``). Tab confirms and immediately offers next parameter level.
  - Terminal choices (final leaf options): no space (`value: `${subcmd}``). Tab confirms selection as final.
- **Full Prefix Replacement:** `item.value` replaces the *entire* argument line after `/cmd `, so N-th level values must be prefixed with their parent path (`value: "preset fast"`, not `"fast"`), while `item.label` remains the leaf token (`fast`).
- **Current-Value State Annotation (mandatory for settings menus):** an `on|off` / enum / preset menu must show the value actually in effect. Put `✓` in the active `item.label`, ` · ● AKTIVNÍ` in its `item.description`, and annotate the parent-level description too. Never put the marker in `item.value` (it is inserted verbatim), and never use ANSI — `description` already runs through `theme.description`. Details and reference implementation: `references/command-completions.md`.
- **Lazy Parameter Completion (mandatory):** a non-terminal subcommand with enumerable parameters MUST return its child list as soon as the token is fully typed — not only after the trailing space. The engine closes the picker on Tab and forces file completion once a space exists, so the trailing-space form alone strands the user. Details and code: `references/command-completions.md`.

### 4. Lifecycle & Event Cleanliness
- `pi.on(event, handler)` returns an unsubscribe function. Store every one and drain them in `session_shutdown` — that handler is the drainer itself, so it does not need to be stored. Full event + API surface: `references/event-and-api-surface.md`.
- Never start processes, sockets, watchers or timers in the extension factory: some invocations load extensions without starting a session. Start long-lived resources from `session_start` and make `session_shutdown` idempotent (quit, reload, session replacement and exit all converge there).
- Tool calls from one assistant message can run in parallel: never assume a sibling call's start event or result exists.
- `turn_end` and `agent_before_settle` are actionable boundaries in current 0.87.x: they can inject structural entries. Confirm against the installed `types.d.ts` after any upgrade.

### 5. State Persistence
- **Conversation-linked state:** Store state in tool result `details` and restore on `session_start` from `ctx.sessionManager.getBranch()`. Survives `/tree` and branch switching.
- **TUI-only session state:** Append via `pi.appendEntry(customType, data)` and restore from `ctx.sessionManager.getEntries()`. Never enters LLM context.
- **Global config:** Store in `~/.pi/agent/<plugin>.json`. Ensure directory exists before writing.

### 6. Vertical Slice Architecture (mandatory for plugins over ~300 lines)
- Layout: thin `index.ts` composition root + `src/shared/` kernel + `src/slices/<feature>/` with `index.ts` barrels. Full layout, sizing rules and the slice-membership decision tree: `references/vsa-architecture.md`.
- **Slices never import each other** — only via `src/shared/`. The composition root is the only multi-slice importer.
- Split files by concept, never by line count; hard limit 400 lines per file.

### 7. Terminal-Only UI & Width Safety (`hasUI` is not enough)
- `ctx.hasUI` is `true` in **RPC as well as TUI**. `ctx.ui.custom()` returns `undefined` in RPC and `ctx.ui.onTerminalInput()` is a no-op, so guard both with `ctx.mode === "tui"`.
- `notify` / `setStatus` / `setWidget` and dialog methods are fine behind `ctx.hasUI`; json and print modes have no UI at all, so keep tool and event behavior independent of rendering.
- **TUI Width Safety:** `pi-tui` `TUI.doRender` hard-crashes if a rendered line exceeds terminal width. Always compute display width via `visibleWidth()` and clamp via `truncateToWidth()` (see `references/tui-and-components.md`).

### 8. Subagent Recursion Guard
- Subagent processes spawned by `pi-subagents` or child sessions load all global extensions.
- Guard against hook recursion at the entry point of `index.ts`:
  `if (process.env.PI_SUBAGENT === "true" || Boolean(process.env.PI_CHILD_SESSION)) return;`

### 9. Scaffolding & Compliant Generation
- Use `/plugin-dev scaffold <dir>` or tool `plugin_dev_scaffold` to generate 100% compliant starter skeletons adhering to VSA layout, peerDependencies isolation, TypeBox schemas, and tests.

### 10. Interactive TUI Dashboard
- Inspect live session scorecard, invariant compliance, resolved config cascade, and engine doctor via `/plugin-dev dashboard`.

---

## Live Engine Documentation

The installed engine docs are the ultimate source of truth. Resolve them at
runtime — never hardcode an install path (it changes with the node version,
the machine and the store layout). Confirm the version is `latest` first (§0):

```bash
# What npm publishes right now — this is the version you must build against.
npm view @earendil-works/pi-coding-agent version

# Fastest: the doctor prints engine version, latest-on-npm, docs dir and
# changelog head, and warns when the installed version lags.
/plugin-dev doctor

# Or resolve it by hand. require.resolve() is blocked here because the engine's
# package.json has an exports map with no "." entry, so walk node_modules:
node -e "const fs=require('node:fs'),p=require('node:path');for(let d=process.cwd();;d=p.dirname(d)){const c=p.join(d,'node_modules','@earendil-works','pi-coding-agent','package.json');if(fs.existsSync(c)){console.log(c);break}if(p.dirname(d)===d)break}"
```

- Docs directory: `<engine package root>/docs` — `extensions.md`, `tui.md`, `packages.md`, `skills.md`, `session-format.md`, `settings.md`, `custom-provider.md`, `rpc-extension-ui.md`, `environment-variables.md`.
- Changelog: `<engine package root>/CHANGELOG.md`.
- Pi may also export `PI_PACKAGE_DIR` pointing at the running package directory.
- File-by-file topic index: `references/api-docs-index.md`.
