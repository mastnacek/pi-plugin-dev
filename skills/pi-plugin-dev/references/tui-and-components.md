# TUI Components, Width Safety & Subagent Isolation

Authoritative patterns for building terminal user interfaces and managing process isolation in Pi coding agent extensions.

---

## 1. Width-Safe Rendering & Crash Protection

### The Hard-Crash Gotcha
`pi-tui` does not tolerate malformed inputs or line overflows.
`TUI.doRender` will crash the host process if any line rendered by a component exceeds the supplied terminal width:
`"Rendered line N exceeds terminal width"`.

Furthermore, displaying wide characters, emoji, or ANSI sequences changes the apparent display width. Never measure string length with `.length`.

### Mandatory Rules
1. Always measure visible terminal columns using `visibleWidth()` from `@earendil-works/pi-tui`.
2. Always clip or wrap lines using `truncateToWidth()` from `@earendil-works/pi-tui`.
3. Wrap all row rendering in an adaptive width-truncation helper:

```typescript
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export function fitLineToWidth(line: string, maxWidth: number, ellipsis = "…"): string {
  if (maxWidth <= 0) return "";
  const vWidth = visibleWidth(line);
  if (vWidth <= maxWidth) return line;
  return truncateToWidth(line, maxWidth, ellipsis);
}
```

---

## 2. Interactive Modal Components (`ctx.ui.custom`)

For interactive screens, tabbed dashboards, or multi-step modal dialogs:
- Use `ctx.ui.custom<T>((tui, theme, kb, done) => new MyComponent(...), { overlay: true })`.
- **Mandatory guard:** Always verify `ctx.mode === "tui"`. In RPC mode, `hasUI` is `true`, but `ctx.ui.custom()` returns `undefined` and terminal key listeners are no-ops.
- Implement `@earendil-works/pi-tui`'s `Component` interface:
  - `render(width: number): string[]` — render lines bounded by `width`.
  - `handleInput(data: string): boolean` — process keystrokes via `matchesKey(data, key)`.
  - Call injected `done(result)` callback to dismiss the modal and resolve the promise.
  - Call injected `tui.requestRender()` when component state changes.

### Key Handling Example
```typescript
import { matchesKey } from "@earendil-works/pi-tui";

handleInput(data: string): boolean {
  if (matchesKey(data, "escape") || matchesKey(data, "q")) {
    this.done();
    return true;
  }
  if (matchesKey(data, "tab") || matchesKey(data, "right")) {
    this.activeTab = (this.activeTab + 1) % 4;
    this.requestRender();
    return true;
  }
  return false;
}
```

---

## 4. Fullscreen Mode (the default since 1.0.0)

Pi's TUI runs **fullscreen** out of the box. Set `tuiMode: "regular"` in settings, or pass
`--tui-mode regular`, to keep the terminal's normal scrollback. Related settings:
`fullscreenExitOutput`, `fullscreenScrollbar`, `fullscreenCopyOnSelect`,
`fullscreenWheelScrollLines`.

**What does not change:** the renderer still calls `render(width)` with the terminal
width, so the width-safety rules in §1 apply unchanged and no overlay or widget code
needs editing. `ctx.ui.custom({ overlay: true })` and `ctx.ui.setWidget()` behave the
same in both modes.

**What does change:** the transcript is owned by pi instead of scrolling out of the
terminal buffer.

- Anything an extension wrote that relied on the user scrolling back in their own
  terminal to read context is gone. Do not park output there — use `notify`,
  `setStatus`, a widget, or `pi.appendEntry()` with a renderer.
- A long-lived overlay is more intrusive without surrounding scrollback to move it
  out of the way. Keep overlays short-lived and dismissible.
- Mouse selection and wheel scrolling are handled by pi in fullscreen, so an
  extension must not install its own raw mouse reporting.
- On exit, pi prints `fullscreenExitOutput` (`"transcript"` by default, or
  `"resume-hint"`). A plugin that wants the transcript on exit should not duplicate
  that write.

---

## 5. Subagent Recursion Guard (`PI_SUBAGENT`)

### The Problem
When Pi spawns subagents or child sessions (e.g. via `pi-subagents`, `pi-goal-x`), child agents inherit all globally registered extensions in `~/.pi/agent/extensions/` and packages.
If an extension hooks `tool_call`, `turn_start`, or visual overlays blindly, subagents duplicate work, inject redundant system prompts, or enter infinite recursion.

### The Guard Pattern
At the entry point of the extension composition root (`index.ts`):

```typescript
export function isDelegatedSession(): boolean {
  return process.env.PI_SUBAGENT === "true" || Boolean(process.env.PI_CHILD_SESSION);
}

export default function (pi: ExtensionAPI): void {
  if (isDelegatedSession()) {
    // Exit cleanly or register only lightweight pass-through tools
    return;
  }

  // Register main parent-session listeners, visuals and tools
}
```
