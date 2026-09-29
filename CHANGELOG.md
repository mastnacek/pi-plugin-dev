# Changelog

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
