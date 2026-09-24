# Architectural Patterns & Design Inspiration for Pi Plugins
> Synthesized from a deep-dive audit of the top 20 most downloaded plugins on [pi.dev/packages](https://pi.dev/packages) (including `pi-mcp-adapter`, `pi-subagents`, `rpiv-mono`, `pi-lens`, `pi-powerline-footer`, `pi-goal-x`, `context-mode`, and `plannotator`).
> Tailored specifically for **`pi-plugin-dev`** and future Pi agent extensions.

---

## 1. Executive Summary & Core Architectural Themes

Analyzing the most successful plugins in the Pi ecosystem reveals four distinct architectural pillars:

1. **Defensive TUI & Safe Rendering:**
   `pi-tui` does not tolerate malformed inputs or line overflows. Top plugins isolate their rendering logic, enforce strict width truncation, and use state-driven component hierarchies.
2. **Tiered Configuration & Non-Destructive Persistence:**
   Settings follow a strict cascade: Global (`~/.pi/agent/settings.json`) → Project (`.pi/settings.json`) → Session Entry (`ctx.sessionManager`). Writing configuration must never strip unknown keys or crash on invalid JSON.
3. **Decoupled Architecture (Core State vs. UI vs. Tools):**
   State logic is completely headless and framework-agnostic. Visual surfaces (HUD, widgets, cards) and tools/commands merely observe or dispatch actions to the core state machine.
4. **Lifecycle Discipline & Recursion Safety:**
   Extensions retain every listener unsubscribe token to drain them on `session_shutdown`. They also explicitly detect delegated subagents to prevent cascading hook recursion.

---

## 2. Deep Dive: Key Patterns by Subsystem

### A. TUI Rendering & Width-Safety (Source: `pi-lens` & `rpiv-mono`)

#### The Hard-Crash Gotcha (`pi-lens`)
In `pi-lens/clients/tui-fit.ts`:
> `pi-tui`'s `TUI.doRender` **hard-crashes the host** on any line longer than terminal width: `"Rendered line N exceeds terminal width"`.
> Furthermore, two incompatible signatures exist across versions:
> - Pure-JS `pi-tui`: `truncateToWidth(text, maxWidth, ellipsis: string)`
> - Native `@oh-my-pi >= 16`: `truncateToWidth(text, maxWidth, ellipsisKind: Ellipsis, pad, tabWidth)`

**Pattern for `pi-plugin-dev`:**
Every line passed to `Component.render(width)`, `ctx.ui.setWidget()`, or HUD overlays must run through an adaptive width-truncation helper:
```typescript
export function fitLineToWidth(line: string, width: number): string {
  if (width <= 0) return "";
  const vWidth = visibleWidth(line);
  if (vWidth <= width) return line;
  return truncateToWidth(line, width, "…");
}
```

#### Stateful Reactive Components (`rpiv-mono / rpiv-ask-user-question`)
In `rpiv-mono`, interactive TUI overlays follow a pure prop-driven model:
- `StatefulView<P> extends Component { setProps(props: P): void; }`
- Container layouts (`Container`, `Spacer`, `DynamicBorder`) wrap sub-views.
- Discriminated union focus states (e.g. `focused: 'tabs' | 'options' | 'notes'`).
- Hotkey routing: `Tab` for switching sections, `Ctrl+]` to toggle/collapse view, `Enter` to commit, `Esc` to dismiss.

**Application to `pi-plugin-dev`:**
Build an interactive **Audit & Doctor Dashboard** modal (`/plugin-dev dashboard`) where developers can navigate through tabs:
- `[Scorecard]`: Live rule adherence (% compliant).
- `[Invariants]`: Real-time detection of `StringEnum`, trailing space, and unsubscribe leaks.
- `[Config Cascade]`: View resolved global vs project settings.
- `[Scratchpad / Test]`: Live test bar for command autocomplete.

---

### B. Settings Architecture & Safe Persistence (Source: `pi-powerline-footer` & `pi-mcp-adapter`)

#### Tiered Resolution & Non-Destructive Writes
In `pi-powerline-footer/index.ts`:
1. **Never throw on corrupted settings:** Log debug message and fall back to safe defaults so startup never halts.
2. **Never overwrite with partial data on parse failure:** If `settings.json` has invalid JSON, refuse to save from slash command; notify user to fix manually rather than destroying their file.
3. **Preserve sibling keys:** When updating plugin settings, read existing file as `Record<string, unknown>`, merge `settings["pluginDev"] = { ... }`, and write back formatted JSON.

```typescript
function readWritableSettings(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return {};
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null; // Refuse overwrite on parse error
  }
}
```

#### Session Branch-Aware State
To allow settings/toggles (like HUD or widget on/off) to survive `/compact` or `/tree` branch hopping:
- Save active toggles into a custom session entry: `pi.appendEntry("pi-plugin-dev:runtime", config)`.
- On `session_start`, scan `ctx.sessionManager.getEntries()` in reverse to restore the last active configuration for that specific branch.

---

### C. Execution Interception & Context Filtering (Source: `pi-goal-x` & `context-mode`)

#### Subagent Recursion Guard
In `pi-goal-x/extensions/goal.ts`:
When Pi spawns subagents, subagents load the same extensions. If an extension hooks `context` or `tool_execution_start` blindly, child agents duplicate parent work or enter infinite loops.

```typescript
export function isDelegatedSession(): boolean {
  return process.env.PI_SUBAGENT === "true" || !!process.env.PI_CHILD_SESSION;
}

export default function(pi: ExtensionAPI): void {
  if (isDelegatedSession()) {
    // Disable active auditor/HUD in subagents, or attach lightweight pass-through
    return;
  }
  // Register full development suite for parent agent
}
```

#### Durable Transcript Cards
Rather than polluting the chat with raw text notifications, use durable message/entry renderers:
```typescript
pi.registerEntryRenderer<SkillAuditPayload>(
  SKILL_AUDIT_ENTRY_TYPE,
  (entry, { expanded }, theme) => renderSkillAuditEntry(entry.data, expanded, theme)
);
// Later append upon goal/task settlement:
pi.appendEntry(SKILL_AUDIT_ENTRY_TYPE, auditSummary);
```

---

### D. Inter-Extension Communication (Source: `pi-subagents` & `pi-plugin-dev`)

Top plugins expose a shared event bus channel:
- `pi-plugin-dev` already defines `pi.events.emit("pi-plugin-dev:state", payload)`.
- **Pattern:** Other UI plugins (e.g. `pi-powerline-footer`, custom status bars, `pi-sidebar`) can listen on this event channel and display the skill name or rule compliance percentage without depending on `pi-plugin-dev` code directly.
- Always wrap `pi.events.emit()` in a `try/catch` block so telemetry never breaks the primary agent loop.

---

## 3. Concrete Recommendations for `pi-plugin-dev`

| Area | Current Status in `pi-plugin-dev` | Proposed Enhancement Inspired by Top Plugins |
|---|---|---|
| **Crash Protection** | Basic text lines | Adopt `pi-lens` `tui-fit` width safety before calling `render(width)` or `setWidget`. |
| **Interactive UI** | Passive HUD + Docked Widget | Add an interactive Modal Dashboard (`rpiv-mono` pattern) via `ctx.ui.custom` with tabbed inspection. |
| **Scaffolding Tool** | Linter/Auditor only | Add `/plugin-dev scaffold` command & tool to generate 100% compliant skeletons (manifest, TypeBox StringEnum, peerDeps). |
| **Live AST Gate** | Post-execution audit in tracker | Intercept `edit`/`write` tool calls before execution to warn agent in real-time if a non-compliant pattern is being written. |
| **Settings Management** | Custom JSON files | Support direct namespace in `settings.json` (`"pluginDev": { ... }`) alongside local config, following `pi-powerline-footer`. |

---

## 4. Reference Index of Analyzed Repositories

- **`pi-lens`** (`D:/01_programovani/pi/plugins/inspirace/pi-lens`) — Width safety (`clients/tui-fit.ts`), deep configuration resolution (`clients/config-resolve.ts`), diagnostic caching.
- **`rpiv-mono`** (`D:/01_programovani/pi/plugins/inspirace/rpiv-mono`) — Component architecture (`packages/rpiv-ask-user-question/view/`), dialog container, keyboard routing.
- **`pi-powerline-footer`** (`D:/01_programovani/pi/plugins/inspirace/pi-powerline-footer`) — Safe `settings.json` read/write, global state persistence with `Symbol.for()`, ANSI styling.
- **`pi-goal-x`** (`D:/01_programovani/pi/plugins/inspirace/pi-goal-x`) — Entry renderers, subagent context gating (`goal-session-safety.ts`), state machine separation.
- **`pi-mcp-adapter`** (`D:/01_programovani/pi/plugins/inspirace/pi-mcp-adapter`) — Tool schema normalization, dynamic lifecycle management, resilient retry loops.
