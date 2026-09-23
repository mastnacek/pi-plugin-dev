# pi-plugin-dev

> Progressive context revelation skill for creating, editing, testing, and debugging **Pi coding agent plugins, extensions, and skills**.

Verified against `@earendil-works/pi-coding-agent` **v0.87.1**.

## Features

- **Progressive Context Disclosure:** Lightweight entry point (`SKILL.md`) that loads detailed specifications only on demand, saving thousands of API tokens per session.
- **The Trailing Space Contract:** Exact specification for slash command autocompletion chaining (`item.value` space vs non-space rules).
- **Schema & TypeBox Rules:** Mandatory `StringEnum` patterns from `@earendil-works/pi-ai` (avoiding Google Gemini 400 Bad Request errors) and error reporting via `throw`.
- **0.87.x Engine Boundaries:** Canonical `SessionManager` context, append-only edits, and actionable `turn_end` / `agent_before_settle` hooks.
- **State Persistence Guide:** Branch-aware session state (`details` + `getBranch()`), hidden TUI entries, and global config.
- **Live Local Engine Docs:** Direct path references to local installed documentation (`$PI_DOCS`).

## Installation

Install directly into Pi via Git:

```bash
pi install git:github.com/mastnacek/pi-plugin-dev
```

Or try without installing:

```bash
pi --skill git:github.com/mastnacek/pi-plugin-dev
```

## Usage

When active, the agent automatically activates this skill on plugin/skill authoring tasks, or invoke directly:

```bash
/skill:pi-plugin-dev
```

## References & Structure

```text
pi-plugin-dev/
├── SKILL.md                          # Entry point, checklist & triggers (~60 lines)
└── references/
    ├── command-completions.md        # Trailing Space Contract & lazy completion engine
    ├── tools-and-schema.md           # TypeBox, StringEnum rule, tool execution contract
    ├── lifecycle-and-events.md       # Event lifecycle, 0.87.x boundary rules, unsubscribe cleanup
    ├── state-persistence.md          # Branch-aware session state vs global config
    └── api-docs-index.md             # Direct paths to local installed engine docs
```

## License

MIT © [mastnacek](https://github.com/mastnacek)
