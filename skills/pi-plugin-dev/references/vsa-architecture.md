# Vertical Slice Architecture (VSA) for Pi Plugins

Reference architecture for every Pi plugin with more than ~300 lines of logic.
Derived from `pi-lotusscript-modular`, `pi-architecture-watcher` and the TUI
dashboard convention (`ratatui` skill, Deep Modules / Ousterhout).

## 1. Principles

1. **Feature cohesion over technical layering.** Code is grouped by feature
   (slice), not by kind (`models/`, `utils/`, `handlers/`). A slice owns its
   tools, command handlers, rendering, and persistence end-to-end.
2. **Inviolable slice isolation.** Slices never import each other. All shared
   contracts, the session kernel, and cross-slice types live in `src/shared/`.
   Only the composition root (`index.ts`) may import from several slices.
3. **Deep modules.** A slice exposes a tiny surface (one `index.ts` barrel
   exporting 1–3 functions); the implementation hides inside sibling files.
   Interface << implementation.

## 2. Standard TypeScript layout

```
pi-my-plugin/
├── index.ts                  # Composition root ONLY: kernel + slice wiring + shutdown drain
├── tsconfig.json             # NodeNext, noEmit check
├── package.json              # pi.extensions + files (["index.ts", "src", …])
└── src/
    ├── shared/               # Kernel — no slice imports
    │   ├── state.ts          #   session-scoped state + track() unsubscriber store
    │   └── config.ts         #   ~/.pi/agent/<plugin>.json load/save
    ├── slices/               # Feature slices (isolated)
    │   ├── pipeline/         #   Pi event translation (tool_call, tool_result, settled)
    │   │   └── index.ts      #   barrel: registerPipeline(pi, state)
    │   ├── commands/         #   slash command handlers, one file per command group
    │   │   └── index.ts
    │   ├── tools/            #   model-facing tools, one file per tool
    │   │   ├── index.ts      #   barrel: registerModelTools(pi, state)
    │   │   └── my-tool.ts
    │   ├── settings/         #   setting catalogue + lazy completions
    │   │   ├── catalogue.ts  #   SETTING_SPECS — single source of truth
    │   │   ├── complete.ts   #   lazy menus with ✓ / (nyní: …) markers
    │   │   └── index.ts
    │   └── <feature>/        #   domain feature slices (gate, summary, scaffold, …)
    │       ├── index.ts      #   barrel
    │       └── engine.ts     #   mechanics
    └── hooks/                #   guard hooks (line limits, docs gates) — optional
        └── guard-hooks.ts
```

**Wire order in the composition root:** create state → register pipeline →
register tools → register commands → register `session_shutdown` drain.

## 3. Slice membership decision tree

When adding a function, decide where it belongs **in this order**:

```
Q1: Does it read/write ONLY state owned by one existing slice?
    → YES: put it in that slice (new sibling file if the slice file nears
      the 300-line soft target).
    → NO ↓

Q2: Is it pure (no session state, no ctx)?
    → YES: it may live in any slice that uses it — pick the slice whose
      feature it belongs to conceptually. Two+ slices need it? ↓

Q3: Do two or more slices need it, or does the composition root itself need it?
    → YES: `src/shared/` (kernel). shared/ must never import from slices/.
    → NO ↓

Q4: Is it a new user-facing capability (new command, new tool, new gate)?
    → YES: new slice under src/slices/<feature>/ with index.ts barrel,
      registered from the composition root. Start with ONE file; split into
      siblings only when a file passes ~300 lines or has independent concepts.
```

**Anti-patterns (reject in review):**
- Slice A imports from slice B → move the shared piece to `shared/`.
- `index.ts` contains logic beyond wiring → extract to a slice.
- `utils.ts` / `helpers.ts` grab-bag at root → dissolve into owning slices
  or `shared/`.
- Splitting files by line count instead of by concept.

## 4. Sizing rules (from the TUI dashboard convention)

| Slice size | Files | Example |
|---|---|---|
| Small | 1–3 | one barrel + one implementation file |
| Medium | 4–6 | + models / render / db split |
| Large | 7–13 | + scanner, metrics, per-mode modules |
| Mega | subdirectories inside the slice (`app/`, `ui/`, `keys/`) | |

- Split **by concept**, never by raw length. Depth > length.
- Hard limit 400 lines per file (engine gate enforces); soft target 300.
- File naming inside a slice: `index.ts` (barrel), `<feature>.ts`
  (mechanics), `models.ts` (types), `complete.ts` (lazy completions),
  `catalogue.ts` (setting specs).

## 5. New-slice checklist

1. One-sentence purpose; name the slice in snake_case.
2. Create `src/slices/<name>/index.ts` barrel exporting register function(s).
3. Kernel first: does it need state? → extend `src/shared/state.ts`, do NOT
   create parallel module-level mutable state.
4. Register from the composition root in wire order (pipeline → tools →
   commands).
5. `npx tsc` clean; slices import only `../../shared/*` or sibling `../*`.
6. Update `package.json` `files` if new top-level dirs were added.

## 6. Known compliant implementations to copy from

| Plugin | Note |
| --- | --- |
| `pi-lotusscript-modular` | canonical Pi-plugin VSA (`AGENTS.md` documents the layout) |
| `pi-eval-harness` | evalgate / summary / pipeline / commands / settings slices |
| `pi-self-compact` | guards / pipeline / tools / commands / compaction slices |
| `pi-plugin-dev` | auditor modules + `src/hooks/` guard hooks |
