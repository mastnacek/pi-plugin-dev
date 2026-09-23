# State Persistence & Configuration

## 1. Branch-Aware Session State (Survives Compaction & `/tree`)

If your plugin tracks state that depends on the current conversation history (e.g. items added, active mode in this branch):
- **Never rely only on module-level variables.** When user branches via `/tree` or compacts, module variables get out of sync.
- **Rule:** Store state in the **tool result `details`** and reconstruct it from `ctx.sessionManager.getBranch()` on `session_start`.

```typescript
let activeItems: string[] = [];

// Reconstruct state on session start / tree branch navigation
pi.on("session_start", (_event, ctx) => {
  activeItems = [];
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === "message" && entry.message.role === "toolResult") {
      if (entry.message.toolName === "my_tool" && entry.message.details?.items) {
        activeItems = (entry.message.details.items as string[]);
      }
    }
  }
});

pi.registerTool({
  name: "my_tool",
  // ...
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    activeItems.push(params.newItem);
    return {
      content: [{ type: "text", text: `Item added: ${params.newItem}` }],
      details: { items: [...activeItems] }, // Persisted into the session branch!
    };
  },
});
```

---

## 2. TUI-Only Session State (Hidden from LLM)

To store state that must survive `/reload` and tree navigation, but **must never enter model context** (saving tokens):
- Use `pi.appendEntry(customType, data)`:
  ```typescript
  // Save custom metadata entry into session transcript
  pi.appendEntry("my-plugin-state", { enabled: true, theme: "dark" });
  ```
- Restore it on `session_start` using `ctx.sessionManager.getEntries()`:
  ```typescript
  pi.on("session_start", (_event, ctx) => {
    for (const entry of ctx.sessionManager.getEntries()) {
      if (entry.type === "custom" && entry.customType === "my-plugin-state") {
        const data = entry.data as { enabled?: boolean; theme?: string };
        if (typeof data?.enabled === "boolean") isEnabled = data.enabled;
      }
    }
  });
  ```

---

## 3. Global User Configuration (`~/.pi/agent/`)

Global settings shared across all sessions belong in `~/.pi/agent/<plugin-name>.json`:

```typescript
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const CONFIG_PATH = join(homedir(), ".pi", "agent", "my-plugin.json");

interface PluginConfig {
  enabled: boolean;
  defaultModel?: string;
}

const DEFAULT_CONFIG: PluginConfig = {
  enabled: true,
};

function loadConfig(): PluginConfig {
  try {
    if (existsSync(CONFIG_PATH)) {
      return { ...DEFAULT_CONFIG, ...JSON.parse(readFileSync(CONFIG_PATH, "utf8")) };
    }
  } catch (err) {
    console.error("Failed to load global config:", err);
  }
  return { ...DEFAULT_CONFIG };
}

function saveConfig(cfg: PluginConfig): void {
  try {
    mkdirSync(dirname(CONFIG_PATH), { recursive: true });
    writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf8");
  } catch (err) {
    console.error("Failed to save global config:", err);
  }
}
```

---

## 4. Project-Local Configuration (`.pi/`)

Settings or databases specific to the current working repository should live inside `.pi/<plugin-name>/` in the repository root (e.g. `.pi/architecture-watcher.json` or `.pi/decisions/`).
- Always check if the directory exists and create it recursively before writing files.
