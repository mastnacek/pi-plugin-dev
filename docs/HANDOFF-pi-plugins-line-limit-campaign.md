# HANDOFF — pi plugins: config unification (done) + line-limit campaign (COMPLETE)

Saved: 2026-09-24 · Completed: 2026-09-25 · Workspace: `D:/01_programovani/pi/plugins` (⚠ **not a git repo** — plugins are individual repos)

> **Canonical, versioned copy.** This document lived unversioned at the workspace root
> while the campaign ran; it now lives here, in the plugin that owns the line-limit rule
> and the hook enforcing it. Edit this copy.
>
> **Status: both campaigns complete — 0 files over the 400-line hard limit** (was 20 at
> the start of Campaign B), all plugin repos clean and pushed.

---

## 1. Campaign A — config unification: ✅ COMPLETE

Goal was three things, now true for every plugin that persists user config:

1. **No `config get|set` setter/getter menus** — direct `/<cmd> <setting> [value]`.
   The deprecated `config get|set` aliases remain on purpose (backward compatibility).
2. **`--global` works uniformly** — as a **prefix or a suffix**, in the **handler and in
   `getArgumentCompletions`**.
3. **Three-layer cascade** — `defaults ← ~/.pi/agent/<plugin>.json ← <cwd>/.pi/<plugin>.json`
   (project wins). `--global` writes the global layer, otherwise the project layer.

Plugins completed (all pushed):

| Plugin | Commit |
| --- | --- |
| pi-eval-harness | `cc4f3a9` |
| pi-architecture-watcher | `aeaf339` |
| pi-lotusscript-modular | `f879094` |
| pi-decision-gate | `2cbdc32` |
| pi-plugin-dev | `69a7fcf` |
| eldritch-footer | `144242a` (branch **master**) |
| pi-sidebar | `e9d5ca4` (branch **master**) |
| pi-prompt-translate-czk | `029f333` |
| pi-mcp-viz | `da9c625` |
| pi-tts | `37c7aa2` (branch **master**) |
| pi-klid | `ab5a767` |
| pi-self-compact | `a3da100` |
| pi-model-pricing | `3d5c045` |
| pi-solodev-adr | `9141dcb`, `2daf647` |
| pi-batch-openrouter | `5c7fb4f` (branch **master**) |
| pi-openrouter-accounts | `fa2a5c4` |
| pi-google-cca | `2de8a39` |
| pi-projects | `40d8915` |
| pi-spai (follows the shared pi-projects registry cascade) | `bee0fd1` |
| pi-apple-rada | `ed096c4`, `374b68c` |

Plugins with **no persistent config** — cascade does not apply:
pi-anonymizer, pi-at-words, pi-read-all, pi-tui-sound, pi-herdr-plugin-dev,
pi-zen-fallback (model cache only).

---

## 2. Campaign B — line-limit: IN PROGRESS

Repo rule (enforced by a `pi-plugin-dev` hook): **soft 300 / hard 400 lines per file.**

### 2a. Already split (all pushed, all tests green)

| File | Before → After | Commit |
| --- | --- | --- |
| `pi-openrouter-accounts/index.ts` | 738 → 7 modules | `fa2a5c4` |
| `pi-solodev-adr/index.ts` | 1072 → 113 + 6 modules | `c3db685` |
| `pi-projects/index.ts` | 1227 → 37 + 7 modules | `f40dcb5` |
| `pi-klid/index.ts` | 1110 → 122 + 7 modules | `ab5a767` |
| `pi-apple-rada/index.js` | 1629 → **71** + 10 modules | `8455d6a` |
| `pi-google-cca/extensions/index.ts` | 1845 → **128** + 9 modules | `4c5af49` |
| `pi-google-cca/extensions/google-wire.ts` | 630 → 395 + 166 + 123 | `3502739` |
| `pi-projects/src/viewer.ts` | 679 → 176 + 29 + 261 + 284 | `1c0a309` |
| `pi-projects/src/scanner.ts` | 445 → 206 + 261 | `0b6634c` |
| `pi-solodev-adr/src/ledger.ts` | 545 → 297 + 142 + 155 | `ee882ec` |
| `pi-solodev-adr/src/viewer.ts` | 460 → 374 + 118 | `338b856` |
| `pi-spai/src/viewer.ts` | 488 → 362 + 90 + 80 | `ca808d7` |
| `pi-google-cca` command/statusline extraction | index 1980 → 1844 | `2de8a39` |

**pi-projects is now fully clean (zero files over 400).**

### 2b. TODO — 8 files still over 400 (corrected full-repo scope)

> Earlier notes under-reported this (my audits had been scoped to plugins I had already
> touched). This is the complete list as of `3502739`.

**Tier 1 — low risk (pure functions / data, tsc + tests give a strong gate):**
- ~~`pi-klid/spai.ts` 494~~ **DONE** (`f37c012` tests, `9da2576` split) — now a 38-line barrel
  plus `src/spai/{types,parse,store}.ts` (38/206/280); chain is one-way, `types <- parse <- store`.
  Kept under `src/`, so the `files` array needed no change. The barrel lists its 15 symbols
  explicitly instead of `export *`, so the four internals the submodules share with each other
  are not leaked (verified: 15 old exports, 15 barrel exports, none lost, none added).
  37 characterization tests written FIRST, run green against the unmodified module.
  Three pre-existing quirks they pinned, all deliberately left as-is:
  * a header with no `SPAI-NNN:` id puts the header **text** into the `id` field — the fallback
    regex captures the title in the slot the code reads as an id;
  * `updateRecordStatus` copies the frontmatter verbatim, so its `status:` goes **stale** and
    disagrees with the index (and the `# ID: title` header line is dropped). Because
    `parseSpaiMarkdown` prefers YAML over the body prefix, a rescan without `.index.json`
    would report the stale status;
  * an unterminated frontmatter block is not treated as frontmatter at all.
- ~~`pi-model-pricing/popularity.ts` 465~~ **DONE** (`726b4ad` tests, `4693ef0` split) — 317 lines
  plus `src/popularity/{types,aggregate}.ts` (77/114). Deliberately conservative: the module-level
  `let` state is read *and written* by the cache, the fetch layer, the lookups and two formatters
  (`popularityAttribution`/`windowLabel` default their argument to `getPopularityCacheStatus()`), so
  moving any of those would need either a shared state object or an import cycle — only stateless
  code moved. Public surface verified identical: 15 in, 15 out, internals not leaked.
- ~~`pi-model-pricing/selector-patch.ts` 415~~ **DONE** (`b9d4db2`) — 262 lines plus
  `src/selector-render.ts` (177). The two theme `let`s, the `createRequire` bootstrap, `colorize`
  and every formatter move together (nothing outside that set touches those lets), so it stays
  one-way with no shared state; `setActiveThemeGetter` is re-exported, keeping the surface at its
  original 2 symbols. (Comment-aware chunking was required here: two `let`s sit on adjacent lines
  and a doc comment belongs to the declaration *below* it.)
- **pi-model-pricing had no usable gate at all before this work, for three separate reasons:**
  1. its `test` script was plain `node --test`, which cannot resolve `.js` specifiers to `.ts`
     sources — so *no test could import the plugin*, hence its only test being `assert.ok(true)`.
     Switched to `npx tsx --test` (the convention pi-klid already uses). **Pre-existing defect.**
  2. `tsconfig.json` cannot run here at all: `baseUrl` was removed in TS7 (error TS5102) and its
     `paths` point at `/home/jara/.local/...`. **Left untouched** (machine-specific — ask first).
  3. **Workaround that produced a real gate without touching the repo:** build an external tsconfig
     in `%TEMP%` whose `files` list the plugin's absolute paths and whose `paths` map the three
     `@earendil-works/pi-*` packages to the *actual* engine install on this machine
     (`D:/02_knihovny_path/node-v22.17.1-winx64/node_modules/@earendil-works/pi-coding-agent/dist`
     plus its nested `node_modules`). `npx tsc -p <temp>/tsconfig.json` then typechecks cleanly, and
     adding `--noUnusedLocals` finds orphaned imports. **Reuse this for any plugin with a broken
     tsconfig.**
  The 29 characterization tests (`726b4ad`) cover formatting, cache loading/validation, the join
  rules (exact / canonical / variant / dated-revision normalisation), the TTL and the fetch layer
  with `fetch` stubbed — all deterministic offline via the `PI_CODING_AGENT_DIR` load-time seam.
  Noted while reading, NOT fixed: the theme bootstrap `createRequire`s a hardcoded Linux path
  (`/home/jara/.local/lib/.../theme/theme.js`); it sits inside try/catch, so elsewhere the fallback
  theme is simply absent and text renders uncoloured.

**Completed in the Tier 1 pass (all pushed):**

| Plugin | Files | Commits |
| --- | --- | --- |
| pi-read-all | index 425→257, scanner 604→362, tokens 615→49 barrel | `8b4e0f3` |
| pi-decision-gate | models.ts 538→11 barrel | `cf95a43` |
| pi-architecture-watcher | rules.ts 488→121, ArchDetectModal 420→388 | `69a7704`, `fc1264d` |
| pi-prompt-translate-czk | status.ts 476→246 | `fc3b80c` |
| pi-plugin-dev | index.ts 403→343 | `0b8816f` |

**Fully clean now (no file over 400):** pi-read-all, pi-architecture-watcher, pi-plugin-dev,
pi-decision-gate, pi-model-pricing, pi-sidebar, pi-klid, pi-anonymizer, pi-spai,
pi-prompt-translate-czk, pi-google-cca, pi-zen-fallback.
Repo-wide over-400 count went **20 → 0**: the campaign is complete.

### Functional fixes made after the campaign pass (all pushed)

These are behaviour fixes, not line-count work — each was found while characterising, and
each is now covered by a test that asserts the FIXED behaviour:

| Plugin | Fix | Commit |
| --- | --- | --- |
| pi-model-pricing | theme fallback `createRequire`d a hardcoded `/home/jara/...` path, so badges rendered uncoloured off the author's box. The engine's root does **not** export the live `theme` singleton, so the fallback was removed in favour of the documented `ctx.ui.theme` getter (tui.md). | `307266f` |
| pi-model-pricing | `tsconfig.json` pinned `baseUrl` (removed in TS7 — the config would not parse, so `tsc` could not run) and `paths` at `/home/jara`. Neither is needed: tsc walks up to `plugins/node_modules`, as pi-klid does. Now portable, and the plugin finally has a typecheck gate. | `307266f` |
| pi-decision-gate | headless approvals were never audited (see above). | `aaa93ad` |
| pi-klid | `parseSpaiMarkdown` put the header TEXT into `id` when a header had no `SPAI-NNN:` prefix; a missing id now comes from the file name, so id-less files cannot collapse onto SPAI-001. | `0f62de5` |
| pi-klid | `updateRecordStatus` copied the frontmatter verbatim, so its `status:` went stale and contradicted the index (and the `# ID: title` header was dropped). Both fixed. | `0f62de5` |
| pi-klid | five unused imports removed (`tsc --noUnusedLocals`). | `4df726d` |
| pi-spai | the project picker rendered doubled markers (`★ ★ ALL PROJECTS`, `📁 📁 alpha (2)`) because the option labels already carried them and the renderer prepended them again. | `7830550` |

**Still open by decision, not by omission:** the `pi-anonymizer` tsconfig change (added
`allowImportingTsExtensions` + `src/**/*.ts`) was required for the split; `pi-spai`'s
picker renders doubled prefixes (`★ ★`, `📁 📁`) and its last column header clips at 100
columns — both cosmetic and pinned as-is by tests.

> **Trap that bit three times in a row (pi-klid, popularity, selector-patch):** a declaration
> moved to another module **keeps its original visibility**. Every helper that the parent or a
> sibling now imports must be explicitly `export`ed, otherwise `tsc` reports TS2459
> ("declares X locally, but it is not exported"). The external-tsconfig gate catches this
> instantly — never assume a moved chunk is importable just because it compiled in place.
>
> **Classification lesson:** tiering by line count alone was wrong. Tier must reflect
> **test coverage × blast radius**, not size. `pi-decision-gate/gate.ts` looked like Tier 1
> at 534 lines but is a security-relevant approval gate with no coverage — it moved to Tier 3.

**Tier 2 — medium (needs care with shared state / closures):** — COMPLETE
- ~~`pi-anonymizer/index.ts` 709~~ **DONE** (`e534189`) — 353 lines plus `src/{crypto,protection,dictionary,vault,status}.ts`
  (52/85/111/124/38). Its factory holds factory-local closures (`track`/`uiNotify`/`saveState`/`restoreState`)
  that the handlers close over, so extracting handlers would be a real refactor, not a verbatim move —
  only independent top-level declarations moved, which is exactly what the existing 23 tests cover.
  Imports were derived per module from the names each one references; the re-export list is generated
  from the original export markers, so the surface is preserved by construction (verified 15 named +
  default, and all 12 names the test file imports).
  Two pre-existing defects fixed on the way:
  * `package.json` `files` omitted `src/` — the published package could not resolve its own imports
    (**third occurrence** of this bug class: pi-solodev-adr, pi-projects, now here);
  * `tsconfig.json` `include` was `["index.ts"]` and the runtime strips types natively
    (`node --experimental-strip-types`), which requires explicit `.ts` specifiers — so
    `allowImportingTsExtensions` was needed for tsc to agree with the runtime, and `src/**/*.ts`
    is now included so tsc actually checks the new modules.
- ~~`pi-klid/kanban.ts` 665~~ **DONE** (`67e9b5e` tests, `ecf7e88` split) — 275 lines plus
  `src/kanban-model.ts` (78) and `src/kanban-render.ts` (321). The file was one 490-line class,
  so the class itself had to be divided — extracting just the helpers would have left 546.
  `KanbanBoard extends KanbanBoardRenderer`; bodies copied **verbatim** (both are class bodies
  at the same indent, so no `this.x` rewriting), only visibility changed to `protected`.
  Three things the code forced, worth remembering for any class split:
  * `height` stays with the subclass — only `render()` reads it, the renderers take it as a
    parameter. The script asserts the base never touches `this.tui/this.cwd/this.close/this.height`.
  * methods that **stay** in the subclass can still call moved helpers, so those must be exported
    (`wrapText`, `WIDE_MIN` — used by `handleDetail()`/`render()`); the split script caught this
    via `tsc`.
  * a derived constructor needs `super()`.
  16 characterization tests written FIRST (the component had **no** coverage) and green against
  the unmodified module; all 57 tests in the plugin pass after the split.
- ~~`pi-sidebar/test/sidebar.test.ts` 548~~ **DONE** (`72f3ade`) — 225 + 343, split at a
  section separator. Verified lossless: 17 + 16 = the original 33 tests, test names identical.
  Imports trimmed per half; `identity` is needed by both halves so it is defined in each.
  **Gotcha:** `tsc` does not clean `dist/`, so a deleted/renamed test file keeps running from
  its old compiled copy — wipe `dist/` before verifying or the count is inflated (it reported
  67 instead of 34).
- ~~`pi-prompt-translate-czk/translate.test.ts` 475~~ **DONE** (`f17d15c`) — 302 + 201. The one
  `describe` is rebuilt in each file; verified lossless (11 + 12 = the original 23, names
  identical). vitest 25/25 unchanged. **Gotcha:** with a trailing newline, `lines.length - 1`
  points *at* the describe's closing `});`, so locate that closer explicitly.

**Tier 3 — high risk (thin test coverage, one giant class or monolith):**
- ~~`pi-decision-gate/gate.ts` 534~~ **DONE** (`ec48826` tests, `f107226` refactor) — now 315
  lines: gate-log.ts 75, gate-prompt.ts 150, gate-actions.ts 133.
  - **Method that made it safe:** write *characterization tests first* against the
    unmodified code, commit them, then refactor with those tests as the gate. 23 tests pin
    pass-through paths, per-mode decisions, the inclusive threshold boundary, the headless
    branch, every dialog choice and the audit log. They are deterministic with **no
    stubbing**: `state.config.useJev = false` keeps `assessActionWithJev` on its offline
    fallback, and the audit log lands in a temp cwd via `ctx.cwd`. When the extraction was
    first broken, 15 of them failed immediately and localised the fault.
  - **Headless-audit gap: FIXED** (`aaa93ad`). The `!ctx.hasUI` branch used to increment
    `approvedCount` and return **without calling `logDecision`**, so calls approved with no
    UI never reached `.pi/decision-gate/decisions.jsonl` — the one automatic-approval path
    with no human in the loop, and therefore the one that most needed a record. It now
    writes an `auto_approved` record, and the misleading comment ("approve or block per
    configuration" — the code only ever approved) is corrected. Blocking headlessly in
    `always` mode stays as-is on purpose: it would leave a headless run unable to use any
    tool at all, so that remains a policy decision rather than a bug.
- ~~`pi-zen-fallback/extensions/zen-fallback/index.ts` 1049~~ **DONE** (`33e2be9` tests,
  `adda5bd` split) — now `index.ts` 147 plus `zen-data.ts` 158, `zen-cache.ts` 159,
  `zen-status.ts` 146, `zen-command.ts` 251, `zen-commands.ts` 195. Its only test asserted a
  locally-declared array and never imported the plugin, so 8 characterization tests came
  first. **Three non-verbatim concerns:** module-level `let`s cannot be reassigned across
  modules, and the commands reassign `FALLBACK_ORDER` (x2) and `widgetVisible` (x4), so both
  became properties of shared const objects (the klid/projects pattern); a factory-local
  const (`ZEN_DOCS`) had to travel with the `/zen` command that used it; and interfaces
  crossing a boundary need explicit `type` markers because `node --test` strips types
  syntactically. One scoped-tsc error remains and is **pre-existing** — byte-identical in
  the pre-split file, never typechecked because the plugin has no tsconfig.
- ~~`pi-google-cca/extensions/oauth.ts` 918~~ **DONE** (`1bf3ecc`) — now `oauth.ts` 274 plus
  `oauth-types.ts` 100, `oauth-http.ts` 119, `oauth-variants.ts` 305, `oauth-callback.ts`
  169. Pure verbatim moves. **Trap worth remembering:** this plugin's tests run under
  `node --test`, so type-only names need `type` markers on every cross-module import and
  re-export — `tsc` accepts a plain named import of an interface and only the runtime fails
  ("does not provide an export named ...").
- ~~`pi-prompt-translate-czk/translate.ts` 942~~ **DONE** (`7bc8ae3`) — now `translate.ts` 288
  plus `translate-language.ts` 308, `translate-protect.ts` 207, `translate-context.ts` 133,
  `translate-text.ts` 52. **Pure verbatim moves** — top-level declarations, so no `this.`
  rewriting at all. The existing 25 tests were already the gate for the moved surface
  (protection, context and language detection are all covered), so no new tests were needed.
  The barrel re-exports exactly the 14 previously-public symbols (verified identical) and the
  script asserts every symbol the six importers use is re-exported — they import with both
  `./translate.js` and extensionless `./translate`, and both keep working. `files: ["*.ts"]`
  already covers root-level modules, so no packaging change was needed.
- ~~`pi-spai/src/kanban.ts` 901~~ **DONE** (`3731dc7` tests, `843e929` split) — now
  `kanban.ts` 389 plus `src/kanban-{model,view,render,render-narrow}.ts` (58/114/236/209).
  **Inheritance does NOT work for this one:** the renderers alone are ~400 lines and the
  class is one cohesive cluster, so any base/subclass cut leaves a file over the limit — a
  first attempt produced a 530-line render module. Instead the renderers and the read-only
  queries became plain functions over an explicit `KanbanView` snapshot that the component
  builds per render: no inheritance chain, and every file well under 400. The rewrite was
  small (30 `this.` references across the three renderers) and the script asserts that none
  survives in a moved body. 16 characterization tests were written first — the component
  had exactly one real render test for its 794-line class.

### 2c. Recommendation

Either **(a)** run this as its own scoped project, starting with Tier 1 (safe, mechanical),
and treat Tier 3 as separate reviewed work — or **(b)** apply the limit to new/changed code
only and leave legacy files. Tier 3 changes have a worse risk/benefit ratio than anything
done so far because the streaming/rendering paths are barely covered by tests.

---

## 3. Real bugs found and fixed — DO NOT REGRESS

1. **pi-solodev-adr & pi-projects: `files` in `package.json` omitted `src/`** — the published
   package could not resolve its own imports. Audited all 26 plugins afterwards; only these two.
2. **pi-solodev-adr read/wrote the wrong config filename** (`pi-solo-radar.json`) — legacy file
   is still read for compatibility.
3. **pi-apple-rada: the *shipped* `pi-apple-rada.config.json` was writable as a user config.**
   It sits next to `package.json` and matched the "workspace config" pattern, so
   `/apple preset glm` with the package dir as cwd **overwrote the shipped defaults**.
   Now never a layer and never a write target; regression tests in
   `test/config-cascade.test.js` and `test/structure.test.js`.
4. **pi-apple-rada: config I/O used `process.cwd()`** instead of the session `ctx.cwd`.
5. **pi-apple-rada: `apiKeyEnvName` was dropped** from the rewritten `lib/config.js`
   (caught by the existing CLI/Pi-entry tests).
6. **pi-spai: the shared `pi-projects.json` registry.** pi-projects now writes a project layer
   by default, so pi-spai was given the same cascade (`setProjectsConfigCwd`) — otherwise
   `/proj` and `/spai` would disagree about configured roots.
7. **pi-self-compact:** removed dead `__saveConfig` (assigned, never called, unsafe cast).

---

## 4. Method that works (and the traps that bit me)

Recipe per file:
1. Recon the file's top-level declarations (cheap: `ctx_execute_file` with a grep-like scan —
   keeps the raw bytes out of context).
2. Slice **verbatim** ranges with the **TypeScript compiler API** — do *not* count brackets,
   string literals like `"{"` break naive counting.
3. Recompute imports from what the moved code actually references.
4. Move shared module-level `let`s into one state object (ESM imports are read-only, so a
   `let` cannot be reassigned from another module).
5. Gate: `npx tsc --noEmit` **and** `npm test`, then commit **and** push (AGENTS §8).

Traps encountered — check every extraction for these:
- **Extension style**: some plugins use `.ts` specifiers (`allowImportingTsExtensions`), others
  NodeNext `.js`. Emitting the wrong one = runtime `ERR_MODULE_NOT_FOUND`. Detect from `tsconfig.json`.
- **Type-only declarations** (`interface`/`type`) must be imported as `type X` — a value import
  of a type fails at runtime under Node's type-stripping.
- **Re-exports must survive**: both bare (`export * from "./x.js"`) and **named**
  (`export { a as b }`) — dropping either breaks every consumer.
- **Package imports** must be carried into the new module too.
- **Mutually recursive functions must stay together** (e.g. `transformMessages` ⇄ `convertMessages`
  in pi-google-cca).
- **Cycles**: keep the graph one-way, e.g.
  `theme ← tree ← tables ← viewer`, or `planning ← cca-consumer ← stream ← index`.
- **False-positive cycle warnings** happen when a *comment* mentions a symbol.
- Keep the public surface stable by re-exporting from the original module.

Commit convention used: `refactor(structure): <what> (OLD -> NEW lines)` and
`feat(config): ...`. **Branches vary**: `pi-tts`, `pi-batch-openrouter`, `eldritch-footer`,
`pi-sidebar` use `master`; the rest use `main`. Always `git -C <plugin> status` first.

**Verification sweep** (run at the end of a work session):
```bash
cd D:/01_programovani/pi/plugins
for p in */; do n=${p%/}; [ -f "$n/package.json" ] || continue
  printf "%-26s dirty=%s ahead=%s\n" "$n" "$(git -C $n status --short | wc -l)" \
    "$(git -C $n status -sb | head -1 | grep -c ahead)"; done
# files still over 400 (excludes vendored trees)
for p in */; do n=${p%/}; find $n \( -name '*.ts' -o -name '*.js' \) \
  | grep -v node_modules | grep -v '/dist/' | grep -v '/zdroje/' \
  | xargs wc -l 2>/dev/null | awk -v P=$n '$1>400 && $2!="total" {print P": "$1" "$2}'; done
```

---

## 5. Plan mode in pi — reference

**pi 0.87.1 has no built-in plan mode and no `/plan` command** (built-ins are:
`/reload /changelog /clone /copy /fork /hotkeys /llama /logout /new /quit /resume
/scoped-models /session /settings /share /tree /trust`).

**But the engine ships a complete plan-mode extension example** — exactly the
"plan mode whose output is a task list" behaviour:

```text
<engine>/examples/extensions/plan-mode/index.ts   (390 lines)
<engine>/examples/extensions/plan-mode/utils.ts   (168 lines)
<engine>/examples/extensions/plan-mode/README.md
```

- `/plan` toggles plan mode · `/todos` shows current plan progress · `Ctrl+Alt+P` shortcut ·
  `--plan` CLI flag
- In plan mode: read-only (edit/write disabled, bash restricted to an allowlist:
  `cat/head/grep/find/rg/ls/git status|log|diff/npm list/…`; `rm/mv/git add|commit|push/sudo/…` blocked)
- The agent emits a numbered list under a **`Plan:`** header; steps are parsed with
  `/\*{0,2}Plan:\*{0,2}\s*\n/i`
- During execution steps are marked with **`[DONE:n]`** tags (parsed with `/\[DONE:(\d+)\]/gi`)
  and a progress widget tracks completion; state survives session resume.

Alternatives already available in this setup:
- **SPAI backlog** (pi-spai): `docs/spai/`, `/spai` + Kanban board, tools
  `record_spai_item` / `search_spai_items` / `update_spai_status`, skill `spai-tasks`.
  This is the task list used for the remaining work below.
- **Goal mode** (`@narumitw/pi-goal`): `/goal` with a contract + `goal_id` and verified completion.
- **pi-subagents** (`/council`, subagents) for bounded parallel review.

---

## 6. Suggested next command for a fresh session

> "Read `docs/HANDOFF-pi-plugins-line-limit-campaign.md`, then continue Campaign B from
> Tier 1. Load the `pi-plugin-dev` skill first. Gate each file with `npx tsc --noEmit` +
> `npm test`, and commit+push per plugin."
