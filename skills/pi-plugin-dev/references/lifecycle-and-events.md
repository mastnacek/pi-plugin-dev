# Lifecycle Events & Engine Compatibility

## 1. Lifecycle Events Overview

Pi extensions interact with the harness through typed lifecycle events via `pi.on(event, handler)`.

### Event Subscription Cleanliness
Every call to `pi.on()` returns an **unsubscribe function** (since Pi 0.86.0):
```typescript
const unsubs: Array<() => void> = [];

export default function (pi: ExtensionAPI): void {
  unsubs.push(
    pi.on("turn_start", async (event, ctx) => { /* ... */ }),
    pi.on("agent_settled", async (event, ctx) => { /* ... */ })
  );

  pi.on("session_shutdown", () => {
    while (unsubs.length > 0) {
      unsubs.pop()?.();
    }
  });
}
```
Always clean up subscriptions and external intervals on `session_shutdown` to avoid memory leaks.

---

## 2. Event Reference

### Session Lifecycle
- `session_start` `{ reason: "startup" | "new" | "resume" | "fork", previousSessionFile? }`: Initialized, restored, or branched. Best place to restore plugin state from session history and set up statusline badges (`ctx.ui.setStatus`).
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

---

## 3. Engine Compatibility Notes (0.87.x)

- **Canonical Session Context:** `SessionManager` is the single source of truth. Assigning `session.agent.state.messages` directly no longer overrides history.
- **Append-Only Context Edits:** `sessionManager.appendContextEdit(entryId, replacement | null)` replaces or omits messages in future context without rewriting transcript history.
- **Exhaustive Event Switches:** If an extension switches on `ExtensionEvent` or `SessionEntry`, handle `AgentBeforeSettleEvent` and `ContextEditEntry`.
- **Tool Payload Safety:** `ToolCall.arguments` and `ToolResultMessage.details` are strictly `JsonValue`-compatible.
