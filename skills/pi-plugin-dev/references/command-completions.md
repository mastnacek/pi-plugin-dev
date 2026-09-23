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
| --- | --- | --- | --- | --- |
| **Non-terminal** (has subsequent options) | Append trailing space | `value: `${key} `` | Inserts token + space, sets `trailingSpace = true`, immediately offering next level | `value: "preset "` |
| **Terminal** (final leaf choice) | Do NOT append space | `value: `${key}`` | Inserts token, confirms selection as final command | `value: "preset fast"`, `value: "status"` |
| **Intermediate N-th level** (has 3rd level) | Append trailing space | `value: `${parent} ${key} `` | Inserts prefix + space, triggering 3rd level | `value: "vader depth "` |

---

## Lazy Parameter Completion (Mandatory)

**A trailing space alone does NOT reveal the next level.** Verified against engine `0.87.1` (`CombinedAutocompleteProvider`):

- `getSuggestions` only takes the argument-completion branch when `force === false`.
- `handleTabCompletion()` calls `forceFileAutocomplete(true)` whenever the argument line already contains a space → argument completions are skipped entirely.
- Tab-confirming an item calls `cancelAutocomplete()`, and the editor's `onChange` does **not** re-trigger autocomplete.

Consequence: after the user Tab-confirms a non-terminal item (`value: "statusline "`), the picker closes and Tab can never re-open it. The child list would appear only once the user types another character — the parameters are effectively unreachable.

**Rule:** a non-terminal subcommand whose parameters are enumerable MUST return its parameter list as soon as the subcommand token is fully typed (no trailing space required), in addition to handling the trailing-space form. Treat a complete non-terminal token as level 2.

```typescript
// Non-terminal subcommands whose parameters are enumerable.
const NON_TERMINAL = new Set(["statusline"]);
const firstToken = tokens[0]?.toLowerCase();
const atParameterLevel =
  tokens.length > 1 ||
  (trailingSpace && tokens.length === 1) ||
  (tokens.length === 1 && firstToken !== undefined && NON_TERMINAL.has(firstToken));
if (atParameterLevel) {
  // return the child list: on|off, enum values, preset names, ...
}
```

Keep the trailing-space parent item for **partial** prefixes (`st`, `stat`) so Tab still inserts token + space. Subcommands with free-form or unknown arguments keep the trailing-space parent only (there is nothing enumerable to return early).

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

## Current-Value State Annotation (Mandatory for Settings Menus)

Any completion menu that offers `on | off`, an enum, or a preset **must show which choice is currently in effect**. Without it the user has to run `/cmd status` first, and an `on`/`off` picker gives no feedback about the setting's present state.

### Hard rules

1. **Never touch `value`.** `value` is inserted verbatim into the editor, so it must stay a clean command token (`hud on`). A marker in `value` corrupts the command.
2. **Put the marker in `label`** (primary column) — e.g. `on ✓`. `label` is display-only (`SelectList.getDisplayValue() === item.label || item.value`).
3. **Add a text marker to `description`** — e.g. ` · ● AKTIVNÍ`. There is no color/style field on `AutocompleteItem`; `description` is rendered through `theme.description`, so **do not embed ANSI escapes** (an inner `\x1b[0m` cancels the theme color and breaks the row).
4. **Annotate the parent level too** when the subcommand names a setting, so the first-level menu already carries ` · ● ZAPNUTO` / ` · ○ VYPNUTO`.
5. **Read the live value at completion time**, never a snapshot captured at registration.

### Reference implementation

```typescript
// `config` is the live, mutable config in the extension closure.
const toggleStateFor = (cmd: string): boolean | undefined => {
  if (cmd === "hud") return config.hud;
  if (cmd === "widget") return config.widget;
  return undefined;
};

// 2nd level: /mycmd hud on|off
const current = toggleStateFor(cmd);
const items = [
  {
    value: `${cmd} on`,                    // clean — inserted verbatim
    label: current ? "on ✓" : "on",       // display-only marker
    description: `Zapnout ${cmd.toUpperCase()}${current ? " · ● AKTIVNÍ" : ""}`,
  },
  {
    value: `${cmd} off`,
    label: current ? "off" : "off ✓",
    description: `Vypnout ${cmd.toUpperCase()}${current ? "" : " · ● AKTIVNÍ"}`,
  },
];
```

Value menus use `(nyní: <value>)` in the description instead of a ✓ (see `pi-architecture-watcher/src/slices/settings/complete.ts`), which works for enums and free-form numbers where a single active row is not enough.

Known implementations to copy from:

| Plugin | File | Marker |
| --- | --- | --- |
| `pi-plugin-dev` | `index.ts` (`/plugin-dev hud\|widget\|card`) | `on ✓` / `off ✓` + ` · ● AKTIVNÍ` / ` · ○ VYPNUTO` |
| `pi-sidebar` | `src/commands.ts` (`/sidebar mcp\|lsp\|extensions`, `preset`, `border`, `branding`, `tab`, `pane`) | same |
| `pi-architecture-watcher` | `src/slices/settings/complete.ts` | `(nyní: <value>)` on keys and values |
| `pi-prompt-translate-czk` | `index.ts` | ` · ● AKTIVNÍ` |
| `pi-mcp-viz` | `src/command.ts` | `currently on` / `currently off` |

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
      // Non-terminal subcommands whose parameters are enumerable.
      const NON_TERMINAL = new Set(["preset", "model"]);
      const firstToken = tokens[0]?.toLowerCase();

      // N-th Token Completion (2nd, 3rd level parameters).
      // A fully-typed non-terminal token ALREADY yields its parameters: the
      // engine will not re-open the picker after a trailing-space Tab.
      if (
        tokens.length > 1 ||
        (trailingSpace && tokens.length === 1) ||
        (tokens.length === 1 && firstToken !== undefined && NON_TERMINAL.has(firstToken))
      ) {
        const cmd = firstToken;

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
