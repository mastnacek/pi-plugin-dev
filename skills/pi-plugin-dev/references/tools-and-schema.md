# Custom Tools & Schema Definitions

## 1. Tool Registration (`pi.registerTool`)

Tools allow the model to interact with external APIs, system commands, or extension state.

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";

export function registerTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "my_action",
    label: "My Action",
    description: "Executes custom task with parameters",
    promptSnippet: "Use my_action for specific domain operations",
    promptGuidelines: [
      "Call my_action when user specifies task X", // Must explicitly name the tool
    ],
    parameters: Type.Object({
      mode: StringEnum(["fast", "accurate"] as const, { description: "Execution mode" }),
      count: Type.Optional(Type.Integer({ minimum: 1, description: "Item count" })),
      query: Type.String({ description: "Target query" }),
    }),
    execute: async (toolCallId, params, signal, onUpdate, ctx) => {
      if (signal.aborted) {
        throw new Error("Action was aborted by user");
      }

      const result = await doWork(params.query, params.mode);

      return {
        content: [{ type: "text", text: `Success: ${result}` }],
        details: { result, timestamp: Date.now() },
      };
    },
  });
}
```

---

## 2. Mandatory Schema Rules

### The `StringEnum` Rule (Critical for Google Gemini / Vertex)
- **Problem:** `Type.Union([Type.Literal("a"), Type.Literal("b")])` produces JSON schema shapes that **break Google Gemini API requests** with 400 Bad Request.
- **Rule:** Always import `StringEnum` from `@earendil-works/pi-ai`:
  ```typescript
  import { StringEnum } from "@earendil-works/pi-ai";

  // CORRECT:
  mode: StringEnum(["fast", "accurate"] as const)

  // INCORRECT:
  mode: Type.Union([Type.Literal("fast"), Type.Literal("accurate")])
  ```

### Parameters Schema Requirement
- Since Pi 0.86.0, tools **without** a `parameters` schema are rejected at registration.
- If a tool takes no arguments, provide an empty object schema:
  `parameters: Type.Object({})`

### Schema Constraints & Types
- Types must be strictly JSON-compatible (`JsonValue`).
- Arrays in tool results are readonly.
- Use `Type.Optional(...)` for optional parameters.

---

## 3. Tool Execution & Error Contract

### Signalling Errors (`throw` vs `return`)
- **To report an error:** **THROW AN EXCEPTION.**
  ```typescript
  // CORRECT: Signals error to Pi engine (sets isError: true)
  throw new Error("Connection failed: timeout");
  ```
- Returning `{ content: [{ type: "text", text: "Error" }] }` does **NOT** set `isError: true`, regardless of properties in `details` or `content`.

### Terminating the Agent Loop (`terminate: true`)
- Returning `{ content, details, terminate: true }` signals the agent to finish after this tool batch completes.
- **Rule:** The loop terminates **only if every tool in that execution batch** finalizes with `terminate: true`.

### Reporting Nested Token Usage (`usage`)
- If your tool calls another model internally (e.g. via `ctx.modelRegistry`), report usage so Pi session accounting and footers remain accurate:
  ```typescript
  return {
    content: [...],
    details: {...},
    usage: { inputTokens: 150, outputTokens: 50, costUsd: 0.0002 },
  };
  ```

### Streaming Partial Progress (`onUpdate`)
- Call `onUpdate?.({ content: [{ type: "text", text: "Working..." }] })` during long-running tasks to stream visual feedback to the user interface.
