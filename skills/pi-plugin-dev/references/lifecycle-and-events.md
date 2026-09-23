# Lifecycle Events & Engine Compatibility

## 1. Lifecycle Events Overview

Pi extensions interact with the harness through typed lifecycle events via `pi.on(event, handler)`.

Complete event + API table (all 39 events, handler results, every `pi.` method): `references/event-and-api-surface.md`.

### Event Subscription Cleanliness
Every call to `pi.on()` returns an **unsubscribe function** (since Pi 0.86.0). Store each one and drain them on `session_shutdown`; the `session_shutdown` registration itself is the drainer and does not need to be stored:
```typescript
const unsubscribers: Array<() => void> = [];

/** Older engine typings declare pi.on() as void, so only store a callable. */
const track = (result: unknown): void => {
  if (typeof result === "function") unsubscribers.push(result as () => void);
};

export default function (pi: ExtensionAPI): void {
  track(pi.on("turn_start", async (event, ctx) => { /* ... */ }));
  track(pi.on("agent_settled", async (event, ctx) => { /* ... */ }));

  pi.on("session_shutdown", () => {
    while (unsubscribers.length > 0) unsubscribers.pop()?.();
  });
}
```

### Resource Ownership
- **Never** start processes, sockets, watchers or timers in the extension factory: some invocations load extensions without starting a session. Start long-lived resources from `session_start` (or from the command/tool that needs them).
- `session_shutdown` converges from quit, reload, session replacement and process exit — the cleanup must be idempotent.
- Tool calls from one assistant message can run in parallel: never assume a sibling call's start event or result exists. Match by `toolCallId`; a missing start event is a recoverable case, not a crash.

---

## 2. Event Reference

### Session Lifecycle
- `session_start` `{ reason: "startup" | "reload" | "new" | "resume" | "fork", previousSessionFile? }`: Initialized, restored, or branched. Best place to restore plugin state from session history and set up statusline badges (`ctx.ui.setStatus`).
- `session_shutdown`: Cleanup time. Terminate child processes, clear intervals, unsubscribe handlers.
- `session_before_switch` / `session_before_fork` / `session_before_compact` / `session_before_tree`: Cancelable gates before switching, forking, or compacting.
- `session_compact`: Compaction completed.
- `session_tree`: Navigation in tree occurred.

### Agent & LLM Boundaries
- `input`: Intercepts raw user prompt. Return `{ action: "transform", text: "..." }` or `{ action: "continue" }`.
- `before_agent_start`: Hook run before prompt reaches provider. Can modify system prompt (`systemPrompt`, `forceSystemPrompt`, or `systemPromptOptions`).
- `agent_start`: Generation stream begins.
- `turn_start`: Beginning of one reasoning turn.
- `turn_end`: End of reasoning turn. **Actionable boundary (0.87.x):** return `{ entries: [...event.entries, draft], continue: true }` to force another turn.
- `agent_before_settle`: Actionable finish gate. Can append entries and force continuation before final rest.
- `agent_settled`: Final notification. The agent has settled; no further continuation allowed here.

### Tool Call Hooks
- `tool_call`: Intercept before tool execution. Can block execution or return `{ action: "block", reason: "..." }`.
- `tool_execution_start`: Execution starts.
- `tool_execution_update`: Periodic progress from tool `onUpdate`.
- `tool_result`: Intercept output before LLM sees it. Can modify content or details.
- `tool_execution_end`: Finalized tool result.

### User Shell Execution
- `user_bash`: Fired on user-issued terminal commands. **Fails closed (0.86.0+):** Return `undefined` to let execution continue normally, or return `{ operations }` / `{ result }`. Errors abort the command.

### Other Events (compact)

- `session_info_changed`, `session_compact_failed`, `ui_prompt_start` / `ui_prompt_end`
- `context` / `context_with_system`: request-local transcript transforms
- `cache_warming_decision`: return `{ action: "warm" | "stop" }`; the last handler wins
- `before_provider_request`, `before_provider_headers`, `after_provider_response`
- `agent_end`: stream ended — retries, recovery or compaction may still follow
- `message_start`, `message_update`, `message_end` (can replace the finalized message, preserving its role)
- `model_select`, `thinking_level_select`
- `project_trust`, `resources_discover`

Full table with handler results, the whole `ExtensionAPI` method surface and the
non-obvious contracts: `references/event-and-api-surface.md`.

---

## 3. Engine Compatibility Notes (0.87.x)

- **Canonical Session Context:** `SessionManager` is the single source of truth. Assigning `session.agent.state.messages` directly no longer overrides history.
- **Append-Only Context Edits:** `sessionManager.appendContextEdit(entryId, replacement | null)` replaces or omits messages in future context without rewriting transcript history.
- **Exhaustive Event Switches:** If an extension switches on `ExtensionEvent` or `SessionEntry`, handle `AgentBeforeSettleEvent` and `ContextEditEntry`.
- **Tool Payload Safety:** `ToolCall.arguments` and `ToolResultMessage.details` are strictly `JsonValue`-compatible.
- **UI Modes:** `ctx.mode` is `"tui" | "rpc" | "json" | "print"`; `ctx.hasUI` is `true` in tui **and rpc**. `ctx.ui.custom()` and `ctx.ui.onTerminalInput()` need a real terminal — in RPC `custom()` resolves to `undefined` and `onTerminalInput()` is a no-op. Guard them with `ctx.mode === "tui"`, keep `notify`/`setStatus`/`setWidget` on `ctx.hasUI`, and keep tool/event behavior independent of rendering so json/print modes stay functional.
