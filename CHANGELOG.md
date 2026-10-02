# Changelog

## 1.7.0 — pi 1.0.0 alignment: the doctor now compares two engines, not one

The workspace pinned `^0.99.2`, which excludes `1.0.0`, so `tsc` validated every
plugin against 0.99.2 types while pi 1.0.0 was the process actually executing.
`/plugin-dev doctor` reported the workspace copy and called it "the engine" — so
the one command meant to catch this drift could not see it.

### Changed

- `engine-locate.ts`: new module — `locateEnginePackage()` moved here out of
  `doctor.ts` (which was at the line limit) together with the JSON/package
  readers. Adds `locateRunningEnginePackage()`, which anchors the search on the
  CLI entry pi was launched from (`process.argv[1]`) and only then falls back to
  `PI_PACKAGE_DIR`. Outside a pi process it returns `undefined` and the caller
  keeps the old walk-up.
- `engine-version.ts`: adds `checkEngineSource()` — a pure comparison of the
  running engine against the workspace-resolved copy. Equal → `pass`; divergent
  → `warn` naming both versions and the stale-API consequence; a single copy →
  `info`, so a normal install gets no new noise.
- `doctor.ts`: the report prefers the running engine for the `Engine`, `Engine
  docs` and `Changelog head` rows, and emits a new `Engine source` row. The
  comparison only appears when the two roots really differ.
- `doctor.test.ts`: +6 tests — pass/divergent/single-copy for `checkEngineSource`,
  the `Engine source` row in both directions, and a resolution test for
  `locateRunningEnginePackage()`.

### Documentation

- `event-and-api-surface.md`: retitled to 1.0.0 and re-verified against
  `types.d.ts`. Documents `ctx.modelRegistry.generateImages()` and the
  `getAvailableOfType` / `getModelsOfType` / `getModelOfType` / `getAllModels`
  family, and adds the `ctx.executeTool()` nested-call contract.
- `tui-and-components.md`: new section on fullscreen, the default since 1.0.0 —
  what is unchanged for component authors (`render(width)` still gets the terminal
  width, so every width-safety rule holds) and what is not (the transcript is
  pi-owned, overlays cannot be scrolled away, no extension-owned mouse reporting).
- `tools-and-schema.md`: `generateImages()` cost counts toward the session like
  `classify()`, so the nested-usage rule now names both.
- `command-completions.md`: re-verified against 1.0.0's `pi-tui`; the lazy
  completion contract still holds, and a slash command after leading whitespace
  now opens the same menu.
- `api-docs-index.md`: adds the missing `codemode.md`, image models,
  `terminal-setup.md`, `windows.md` and `termux.md`.
- `lifecycle-and-events.md`, `SKILL.md`, `README.md`: stale `0.87.x` / `0.99.1`
  / `0.99.x` labels updated, with the note that 1.0.0 changed no event contract.

## 1.6.0 — the line limit is enforced before the write, not after it

- `line-monitor.ts`: `projectResultingLines(resolvedPath, toolName, input, maxLines)`
  projects the line count a call WILL leave behind — `write` from `content`,
  `edit` by applying `edits[]` to the file on disk. An anchor-only editor
  returns `known: false` instead of a guess.
- `line-monitor.ts`: `formatLineLimitBlock()` renders the pre-flight rejection,
  with its own wording ("REFUSED BEFORE IT RAN") so the agent does not go
  looking for a mutation that never executed.
- `guard-hooks.ts`: the `tool_call` handler now blocks an over-limit
  `write`/`edit` after the invariant check.
- `test/guard-hooks.test.ts`: new — 10 tests over the handlers end to end.
  There was no test for this wiring at all before.

### Why

The line limit lived on `tool_result`, which the engine fires *after* the tool
has already written the file. The handler returned `isError: true` with the
split instructions, so an edit that pushed a file to 500 lines reported itself as
a failure while the 500-line file stayed on disk. Verified live: a one-line edit
to a 500-line file returned `🚨 [Line limit exceeded: 500 lines, limit 400]`, and
`wc -l` still reported 500 with the edit applied. Every retry produced the same
error and the file never shrank — the rule looked enforced while enforcing
nothing.

The consult gates were fine. `tool_call` runs before execution, so
`block: true` there really does stop the call.

## 1.5.0 — the gates cover the editor that is actually installed

- `source-gate.ts`: `mutationTargeting()` classifies a tool call as a gated
  mutation and reports whether it names its target by `path` or by anchor only.
- `config`: `gatedMutationTools` (default `["edit", "write", "replace", "insert"]`),
  `gatedPathlessTools` (default `["insert"]`), `enforcePathlessEditGate`
  (default `true`). A fourth editor is a config change, not a patch.
- `guard-hooks.ts`: both the `tool_call` gate and the `tool_result` line-limit
  check go through the classifier, and the pre-execution invariant check now
  reads the editor payload shapes (`replacement_lines`, `lines`) next to
  `content` and `edits`.
- Dashboard lists the gated tools and which of them are anchor-only.

### Why

The gates only recognised `edit` and `write`. `pi-hashline-edit-pro` registers
`replace` and `insert`, and after it was installed every edit went through them —
so the consult-before-edit gate, the pre-execution invariant check and the
line-limit rejection were all live and all doing nothing.

`replace` carries a path, so it is gated in full. `insert` is anchor-only by
contract: the editor resolves anchors in its own in-memory registry, which this
plugin cannot read. Rather than guess a file, the anchor-only path enforces the
session-level gates (skill, MCP) and says in the block message that the
file-level checks could not run. A test asserts the message never claims the
target was inspected.
