# pi-plugin-dev

> Progressive context revelation skill for creating, editing, testing, and debugging **Pi coding agent plugins, extensions, and skills**.

Verified against `@earendil-works/pi-coding-agent` **v0.87.1** — always re-verify with `/plugin-dev doctor`, which reports the latest version published on npm.

## Rule 0: Pin to Latest

Before writing or editing any plugin, establish the engine version from npm and align the repo pin to it. A stale `devDependencies` pin is not a lint nit: in a workspace it silently type-checks every plugin against an older API than the one running, so the build passes while the runtime contract has moved on.

```bash
npm view @earendil-works/pi-coding-agent version   # the version you must build against
/plugin-dev doctor                                 # installed vs. latest, warns on a gap
```

`/plugin-dev doctor` gained an **Engine latest** check that compares the installed engine against the npm registry and warns with the exact gap. The registry call is bounded by a 3 s timeout and degrades to `unknown` offline, so it never blocks the rest of the report. The comparison logic lives in `src/engine-version.ts` as pure functions, so the rule is unit-tested without a registry or a filesystem.

Rule 0 is documented in full in `skills/pi-plugin-dev/SKILL.md` §0 and in `references/api-docs-index.md`.

## Features

- **Skill Action & Guidance Visualizer:** Real-time visual tracking of active skills, loaded references, inspected files, and actions taken (inspired by \`pi-mcp-viz\`).
- **Real-Time Instruction Auditor:** Live verification gates on every edit: Trailing Space Contract, lazy parameter expansion, current-value markers, `StringEnum`, `throw`-based errors, core packages in `peerDependencies`, listener cleanup, `ctx.mode === "tui"` guards, state reconciliation, manifest hygiene and install sources. Detection is comment-blind (a file that merely *mentions* `unsubscribe` no longer passes) and prefers `warn` over `fail` unless the skill states a hard rule.
- **Per-File Line Limit Monitor:** Source code files edited via `edit`/`write` are checked against a hard line limit (default **400 lines**, soft advisory at 300, configurable via `maxFileLines` in `~/.pi/agent/pi-plugin-dev.json`). An oversized file is rejected (`isError: true`) with mandatory split instructions — the agent must extract cohesive sections into new modules instead of retrying. Modeled on pi-lotusscript-modular's `maxProcedureLines`, at file granularity. Dependency, build and lock files are exempt. `.md`/`.txt` docs are never gated.
- **Consult-Before-Edit Gates (hard enforcement):** `edit`/`write` on source files is **blocked** (`block: true`) until required sources were consulted this session: (1) *Skill gate* — a Pi skill entry point (`SKILL.md`) must have been read first (default ON, `enforceSkillBeforeEdit`); (2) *MCP gate* — tool calls matching configured patterns (e.g. `kb_search`, `mcp__knowledge_base*`) must have run first (`requiredMcpToolsBeforeEdit` array in `~/.pi/agent/pi-plugin-dev.json`, default empty). Turns the "Skill Before Edit" rule from prose into enforcement; the hook proves the call happened, not that it was relevant.
- **Install Offer After Push:** when the agent commits and pushes a Pi package to GitHub, `/plugin-dev` offers to install it as a package (`git:github.com/<owner>/<repo>`, global or project scope) once the agent settles. Only Pi packages with a GitHub `origin` qualify, the commit must have happened in the same session, and packages already declared in `settings.json` are never offered. `/plugin-dev install on|off` controls it.
- **Floating HUD Overlay:** High-contrast, non-blocking modal in the top-right corner (\`ctx.ui.custom\` overlay) showing live focus and compliance badges.
- **Docked Editor Widget:** Compact above-editor status card showing active guidance and verified gates.
- **Durable Transcript Cards:** Audit receipt appended to chat log on agent settlement.
- **Progressive Context Disclosure:** Lightweight entry point (\`SKILL.md\`) that loads detailed specifications only on demand, saving thousands of API tokens per session.
- **The Trailing Space Contract:** Exact specification for slash command autocompletion chaining (\`item.value\` space vs non-space rules).
- **Lazy Parameter Completion & Live State Markers:** A fully typed non-terminal token expands its parameters immediately, and settings rows carry \`✓\` + \` · ● AKTIVNÍ\` for the value actually in effect.
- **Schema & TypeBox Rules:** Mandatory \`StringEnum\` patterns from \`@earendil-works/pi-ai\` (avoiding Google Gemini 400 Bad Request errors) and error reporting via \`throw\`.
- **0.87.x Engine Boundaries:** Canonical `SessionManager` context, append-only edits, and actionable `turn_end` / `agent_before_settle` hooks. Re-derive against the installed `types.d.ts` after every engine upgrade.
- **State Persistence Guide:** Branch-aware session state (\`details\` + \`getBranch()\`), hidden TUI entries, and global config.
- **Live Local Engine Docs:** Engine version, docs directory and changelog are resolved at runtime (`createRequire` + node_modules walk-up), never hardcoded to one machine or node path.

## Commands

Manage visualizer and compliance settings with `/plugin-dev`:

| Command | Description |
|---|---|
| `/plugin-dev status` | Display live compliance scorecard and loaded skill audit |
| `/plugin-dev doctor` | Installed engine version **vs. latest on npm** (warns on a gap), docs path, changelog head, install sources, SKILL.md frontmatter, package self-audit |
| `/plugin-dev hud on\|off` | Toggle floating HUD overlay in top-right corner |
| `/plugin-dev widget on\|off` | Toggle docked status widget above editor |
| `/plugin-dev card on\|off` | Toggle durable audit summary cards in chat log |
| `/plugin-dev install on\|off` | Offer to install a freshly pushed Pi plugin from GitHub (never from the local checkout) |
| `/plugin-dev reset` | Clear current run history and loaded guidance trackers |
| `/plugin-dev help` | Show command help banner |

## Installation

Install directly into Pi via Git:

```bash
pi install git:github.com/mastnacek/pi-plugin-dev
```

Or try without installing:

```bash
pi --skill git:github.com/mastnacek/pi-plugin-dev
```

## Usage

When active, the agent automatically activates this skill on plugin/skill authoring tasks, or invoke directly:

```bash
/skill:pi-plugin-dev
```

## References & Structure

```text
pi-plugin-dev/
├── SKILL.md                          # Entry point, checklist & triggers
├── references/
│   ├── command-completions.md        # Trailing Space Contract & lazy completion engine
│   ├── tools-and-schema.md           # TypeBox, StringEnum rule, tool execution contract
│   ├── lifecycle-and-events.md       # Event lifecycle, boundary rules, unsubscribe cleanup
│   ├── event-and-api-surface.md      # Every event + ExtensionAPI method, with result contracts
│   ├── state-persistence.md          # Branch-aware session state vs global config
│   ├── tui-and-components.md         # Width safety, hasUI vs ctx.mode, subagent isolation
│   ├── vsa-architecture.md           # Slice layout & slice-membership decision tree
│   └── api-docs-index.md             # Runtime-resolved engine docs + pin-to-latest (§0)
└── src/
    └── engine-version.ts             # compareVersions, npm latest fetch, the §0 check
```

## Testing

```bash
npm run check   # tsc --noEmit
npm test        # 72 tests, no terminal required
```

The suite pins the auditor rules (including the two false results the first
version produced: a comment-only "unsubscribe" mention, and `pi.on()` calls with
no stored unsubscriber), the command menu contracts, the doctor report and the
tracker/auditor hand-off.

## License

MIT © [mastnacek](https://github.com/mastnacek)
