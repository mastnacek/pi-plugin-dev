# Changelog

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
