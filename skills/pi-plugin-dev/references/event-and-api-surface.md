# Event & API Surface (0.87.1)

The complete subscription surface of `ExtensionAPI`, verified against
`dist/core/extensions/types.d.ts` on `@earendil-works/pi-coding-agent` 0.87.1.
Use this when the integration point is not already obvious from
`references/lifecycle-and-events.md`.

Re-verify after an engine upgrade:

```bash
node -e "const p=require.resolve('@earendil-works/pi-coding-agent/package.json');console.log(p)"
# then: grep -n '    on(event:' <root>/dist/core/extensions/types.d.ts
```

Or run `/plugin-dev doctor`, which prints the resolved engine version, docs
directory and changelog head.

---

## 1. Events

`pi.on(event, handler)` returns an unsubscribe function. Handlers run in
extension **load and registration order**; unsubscribing during a dispatch does
not cancel the dispatch already in progress.

| Event | When | Handler result |
|---|---|---|
| `project_trust` | Project trust decision is being resolved | notification |
| `resources_discover` | Extensions/skills/prompts/themes are discovered | can contribute resources |
| `session_start` | Session initialized, restored, resumed or forked | notification — restore branch state here |
| `session_info_changed` | Session name / metadata changed | notification |
| `session_before_switch` | Before switching to another session | cancelable |
| `session_before_fork` | Before forking | cancelable |
| `session_before_compact` | Before compaction | cancelable |
| `session_compact` | Compaction finished | notification |
| `session_compact_failed` | Compaction failed | notification |
| `session_before_tree` | Before `/tree` navigation | cancelable |
| `session_tree` | Tree navigation happened | notification |
| `session_shutdown` | Session closing (also on reload/replacement) | cleanup, **must be idempotent** |
| `context` | Conversation messages are assembled for a request | transform (system prompts/tool messages excluded) |
| `context_with_system` | Request-local transform that must own the whole transcript | keep a system message at index 0 |
| `cache_warming_decision` | Idle prompt-cache refresh is proposed | `{ action: "warm" \| "stop" }`, last handler wins |
| `before_provider_request` | Provider request about to be sent | transform |
| `before_provider_headers` | Provider headers about to be sent | transform |
| `after_provider_response` | Provider response received | notification |
| `before_agent_start` | A run is starting | can replace prompt / select tools / add guidelines |
| `agent_start` | Stream begins | notification |
| `agent_end` | Stream ends (retries/compaction may still follow) | notification |
| `agent_before_settle` | Last actionable boundary before rest | can append entries and request one continuation |
| `agent_settled` | Pi will not continue automatically | notification only |
| `ui_prompt_start` / `ui_prompt_end` | Interactive prompt shown / closed | notification |
| `turn_start` / `turn_end` | One reasoning turn | `turn_end` is actionable (entries + `continue: true`) |
| `message_start` / `message_update` | Message streaming begins / progresses | notification |
| `message_end` | Message finalized | can replace the message, preserving its role |
| `tool_execution_start` | Tool execution begins | notification |
| `tool_execution_update` | Periodic progress from a tool `onUpdate` | notification |
| `tool_execution_end` | Tool result finalized | notification |
| `model_select` / `thinking_level_select` | Model or thinking level changed | notification |
| `tool_call` | Before a tool executes | can mutate input or block the call |
| `tool_result` | A tool result is produced | handlers compose, each sees prior changes |
| `user_bash` | User-issued shell command | return `undefined` to pass on; `{ operations }` / `{ result }` stops propagation; a handler failure blocks the command |
| `input` | Raw user prompt | `{ action: "transform", text }` or `{ action: "continue" }` |

**Parallel calls:** tool calls from one assistant message can run in parallel.
Never assume a sibling call's start event or result exists. Match by
`toolCallId` and treat a missing start as a recoverable case.

---

## 2. `ExtensionAPI` methods

| Method | Purpose | Notes |
|---|---|---|
| `pi.on(event, handler)` | Observe / transform lifecycle | returns an unsubscribe function |
| `pi.registerTool(def)` | Add a model-callable tool | schema required since 0.86.0 — use `Type.Object({})` for no args |
| `pi.registerCommand(name, opts)` | Add a `/` command | `getArgumentCompletions` drives the menu |
| `pi.registerShortcut(key, { description, handler })` | Add a keyboard shortcut | handler gets `ctx` |
| `pi.registerFlag(name, { type, default, description })` / `pi.getFlag(name)` | Add / read a CLI flag | `type: "boolean" \| "string"` |
| `pi.registerProvider(...)` / `pi.unregisterProvider(name)` | Add a model provider | takes effect immediately |
| `pi.registerMessageRenderer(customType, fn)` | Render `pi.sendMessage` content | |
| `pi.registerEntryRenderer(customType, fn)` | Render `pi.appendEntry` content | keeps custom entries out of LLM context |
| `pi.registerMarkdownTransformer(fn)` | Transform assistant markdown | |
| `pi.appendEntry(customType, data)` | Persist non-context session data | restore from `sessionManager` on start |
| `pi.sendUserMessage(text)` / `pi.sendMessage(message)` | Inject user or custom content | custom content can be rendered |
| `pi.setActiveTools(names)` | Select active tools | names must already be registered |
| `pi.events` | Cross-extension event bus | best-effort; wrap `emit` in try/catch |
| `pi.jsonSchema(...)` / session-control helpers | See the engine types | |

## 3. `ExtensionContext`

`ctx.mode` is `"tui" | "rpc" | "json" | "print"`. `ctx.hasUI` is `true` in
**tui and rpc**. Terminal-only UI must be guarded by `mode`:

| UI call | tui | rpc | Guard |
|---|---|---|---|
| `notify`, `setStatus`, `setWidget`, `setTitle`, dialogs (`select`/`confirm`/`input`/`editor`) | yes | yes (fire-and-forget / sub-protocol) | `ctx.hasUI` |
| `custom()`, `onTerminalInput()` | yes | `custom()` → `undefined`, `onTerminalInput()` → no-op | `ctx.mode === "tui"` |

Other context fields: `cwd`, `sessionManager`, `modelRegistry`, `model`,
`scopedModels`, `thinkingLevel`, `signal`, `isIdle()`, `isProjectTrusted()`,
`abort()`, `hasPendingMessages()`, `shutdown()`, `getContextUsage()`,
`compact()`, `getSystemPrompt()`.

`ExtensionCommandContext` adds command-only operations: wait-until-idle,
reload, tree navigation and session replacement (`withSession`). Session
replacement invalidates the old context — keep only plain data across it.

---

## 4. Non-obvious contracts

- **The factory must not start processes, sockets, watchers or timers.** Some
  invocations load extensions without starting a session. Start long-lived
  resources from `session_start` (or from the command/tool that needs them) and
  release them in an idempotent `session_shutdown`.
- **`session_shutdown` converges from several paths** (quit, reload, session
  replacement, process exit). Guard the cleanup so running it twice is safe.
- **Tool results** need model-facing `content` plus a JSON-compatible `details`
  field (`details: undefined` when there is none). Throw to fail; returning an
  object never sets `isError`.
- **`terminate: true`** ends the loop only if every tool in the batch agrees.
- **Nested model calls**: include their `usage` in the tool result so session
  accounting stays accurate.
- **File mutation**: wrap a read-modify-write tool in `withFileMutationQueue()`.
- **Large results**: truncate the model-facing text and tell the model where to
  read the rest.
- **Skills and commands**: skills are available as `/skill:name` when
  `enableSkillCommands` is on; a slash-command menu is the exact reference for
  what loaded in the session.