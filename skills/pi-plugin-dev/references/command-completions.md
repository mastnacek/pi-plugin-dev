# Command Completions & The Trailing Space Contract

## Why This Contract Exists

In `@earendil-works/pi-tui` (`CombinedAutocompleteProvider.applyCompletion`):
- When completing a slash command name (`/mycmd`), the engine automatically appends a space:
  `${beforePrefix}/${item.value} `
- When completing command arguments, the engine inserts `item.value` **verbatim without adding spaces**:
  `beforePrefix + item.value + adjustedAfterCursor`
- Furthermore, on Tab key confirmation, the editor immediately closes the autocomplete picker (`cancelAutocomplete()`).

Therefore, the plugin's `getArgumentCompletions` must explicitly dictate whether Tab confirms a final choice or opens the door for subsequent parameters.

---

## The Trailing Space Contract

| Token Type | Rule | Value Shape | Tab Behavior | Example |
|---|---|---|---|---|
| **Non-terminal** (has subsequent options) | Append trailing space | `value: `${key} `` | Inserts token + space, sets `trailingSpace = true`, immediately offering next level | `value: "preset "` |
| **Terminal** (final leaf choice) | Do NOT append space | `value: `${key}`` | Inserts token, confirms selection as final command | `value: "preset fast"`, `value: "status"` |
| **Intermediate N-th level** (has 3rd level) | Append trailing space | `value: `${parent} ${key} `` | Inserts prefix + space, triggering 3rd level | `value: "vader depth "` |

---

## Full Prefix Replacement Rule

In Pi's editor:
- `prefix` passed to `getArgumentCompletions(prefix)` is the **entire argument string** after `/command `.
- `item.value` replaces the **entire argument prefix**, NOT just the word under cursor.
- `item.label` is the display token shown in the picker dropdown.

**Correct:**
```typescript
// 2nd level: /mycmd preset <name>
{
  value: `preset ${p}`,  // Replaces the whole argument string after "/mycmd "
  label: p,               // What user sees in the dropdown list
  description: `Select preset ${p}`
}
```

**Incorrect:**
```typescript
// NEVER return the leaf token alone in value:
{ value: p, label: p } // Breaks editor! Replaces "/mycmd preset" with "/mycmd fast"
```

---

## Standard Multi-Level Implementation Pattern

```typescript
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";

const COMMAND_DOCS: Record<string, string> = {
  on: "enable feature",
  off: "disable feature",
  status: "display status",
  preset: "switch preset (fast | balanced | quality)",
  model: "select model override",
  help: "show command help",
};

export function registerMyCommand(pi: ExtensionAPI) {
  pi.registerCommand("mycmd", {
    description: "My plugin command suite",
    getArgumentCompletions: async (prefix: string): Promise<AutocompleteItem[] | null> => {
      const tokens = prefix.split(/\s+/).filter(Boolean);
      const trailingSpace = /\s$/.test(prefix);
      const normalizedPrefix = tokens.join(" ").toLowerCase();

      // N-th Token Completion (2nd, 3rd level parameters)
      if (tokens.length > 1 || (trailingSpace && tokens.length === 1)) {
        const cmd = tokens[0]?.toLowerCase();

        // Subcommand: preset (terminal choices)
        if (cmd === "preset") {
          const presets = [
            { value: "preset fast", label: "fast", description: "Fast preset" },
            { value: "preset balanced", label: "balanced", description: "Balanced preset" },
            { value: "preset quality", label: "quality", description: "Quality preset" },
          ];
          const filtered = presets.filter((i) => i.value.toLowerCase().startsWith(normalizedPrefix));
          return filtered.length > 0 ? filtered : null;
        }

        // Subcommand: model (dynamic lazy list, terminal choices)
        if (cmd === "model") {
          const available = ["current", "default", "openai/gpt-4o-mini"];
          const items = available.map((m) => ({
            value: `model ${m}`,
            label: m,
            description: `Use model ${m}`,
          }));
          const filtered = items.filter((i) => i.value.toLowerCase().startsWith(normalizedPrefix));
          return filtered.length > 0 ? filtered : null;
        }

        return null;
      }

      // 1st Token Completion (Subcommands from Dictionary)
      const typed = (tokens[0] ?? "").toLowerCase();
      // Identify non-terminal subcommands that accept further arguments
      const NON_TERMINAL = new Set(["preset", "model"]);

      const items: AutocompleteItem[] = [];
      for (const [key, description] of Object.entries(COMMAND_DOCS)) {
        if (key.toLowerCase().startsWith(typed)) {
          const hasNext = NON_TERMINAL.has(key);
          items.push({
            value: hasNext ? `${key} ` : key, // Space contract applied here
            label: key,
            description,
          });
        }
      }

      return items.length > 0 ? items : null;
    },

    handler: async (args: string, ctx: ExtensionCommandContext) => {
      // Command handler logic
    },
  });
}
```
