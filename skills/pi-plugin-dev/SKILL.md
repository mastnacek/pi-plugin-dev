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
- Lifecycle events & 0.87.x engine boundaries: `references/lifecycle-and-events.md`
- State persistence (branch-aware vs global): `references/state-persistence.md`
- Official local Pi docs & changelog: `references/api-docs-index.md`

---

## Fast Development Checklist

### 1. Package Manifest (`package.json`)
- Use `"type": "module"`.
- Core packages (`@earendil-works/pi-ai`, `@earendil-works/pi-agent-core`, `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, `typebox`) MUST be in `peerDependencies: { "*": "*" }`. Never bundle them in `dependencies`.
- Third-party runtime libraries go into `dependencies` (Pi uses production installs, so `devDependencies` are absent at runtime).

### 2. Custom Tools (`pi.registerTool`)
- **String Enums:** Always use `StringEnum(["a", "b"] as const)` from `@earendil-works/pi-ai`. Never use `Type.Union`/`Type.Literal` (breaks Google Gemini API).
- **Error Reporting:** Always `throw new Error(...)` to signal a tool error (`isError: true`). Returning an object never sets the error flag.
- **Payloads:** Must be strictly JSON-compatible (arrays readonly).

### 3. Autocomplete & Slash Commands (`getArgumentCompletions`)
- **Trailing Space Contract:**
  - Non-terminal choices (have sub-parameters): append space (`value: `${subcmd} ``). Tab confirms and immediately offers next parameter level.
  - Terminal choices (final leaf options): no space (`value: `${subcmd}``). Tab confirms selection as final.
- **Full Prefix Replacement:** `item.value` replaces the *entire* argument line after `/cmd `, so N-th level values must be prefixed with their parent path (`value: "preset fast"`, not `"fast"`), while `item.label` remains the leaf token (`fast`).

### 4. Lifecycle & Event Cleanliness
- `pi.on(event, handler)` returns an unsubscribe function. Always store and call it during `session_shutdown` or process signals to prevent memory leaks and zombie listeners.
- `turn_end` and `agent_before_settle` are actionable boundaries in 0.87.x (can inject structural entries).

### 5. State Persistence
- **Conversation-linked state:** Store state in tool result `details` and restore on `session_start` from `ctx.sessionManager.getBranch()`. Survives `/tree` and branch switching.
- **TUI-only session state:** Append via `pi.appendEntry(customType, data)` and restore from `ctx.sessionManager.getEntries()`. Never enters LLM context.
- **Global config:** Store in `~/.pi/agent/<plugin>.json`. Ensure directory exists before writing.

---

## Live Engine Documentation

The installed engine docs are the ultimate source of truth:
- Root: `D:\02_knihovny_path\node-v22.17.1-win-x64\node_modules\@earendil-works\pi-coding-agent\docs`
- Changelog: `D:\02_knihovny_path\node-v22.17.1-win-x64\node_modules\@earendil-works\pi-coding-agent\CHANGELOG.md`
