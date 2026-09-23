# pi-plugin-dev

> Progressive context revelation skill for creating, editing, testing, and debugging **Pi coding agent plugins, extensions, and skills**.

Verified against `@earendil-works/pi-coding-agent` **v0.87.1**.

## Features

- **Skill Action & Guidance Visualizer:** Real-time visual tracking of active skills, loaded references, inspected files, and actions taken (inspired by \`pi-mcp-viz\`).
- **Real-Time Instruction Auditor:** Live verification gates checking code edits against active skill invariants (Trailing Space Contract, StringEnum, Error throw contract, peerDependencies).
- **Floating HUD Overlay:** High-contrast, non-blocking modal in the top-right corner (\`ctx.ui.custom\` overlay) showing live focus and compliance badges.
- **Docked Editor Widget:** Compact above-editor status card showing active guidance and verified gates.
- **Durable Transcript Cards:** Audit receipt appended to chat log on agent settlement.
- **Progressive Context Disclosure:** Lightweight entry point (\`SKILL.md\`) that loads detailed specifications only on demand, saving thousands of API tokens per session.
- **The Trailing Space Contract:** Exact specification for slash command autocompletion chaining (\`item.value\` space vs non-space rules).
- **Schema & TypeBox Rules:** Mandatory \`StringEnum\` patterns from \`@earendil-works/pi-ai\` (avoiding Google Gemini 400 Bad Request errors) and error reporting via \`throw\`.
- **0.87.x Engine Boundaries:** Canonical \`SessionManager\` context, append-only edits, and actionable \`turn_end\` / \`agent_before_settle\` hooks.
- **State Persistence Guide:** Branch-aware session state (\`details\` + \`getBranch()\`), hidden TUI entries, and global config.
- **Live Local Engine Docs:** Direct path references to local installed documentation (\`$PI_DOCS\`).

## Commands

Manage visualizer and compliance settings with `/plugin-dev`:

| Command | Description |
|---|---|
| `/plugin-dev status` | Display live compliance scorecard and loaded skill audit |
| `/plugin-dev hud on\|off` | Toggle floating HUD overlay in top-right corner |
| `/plugin-dev widget on\|off` | Toggle docked status widget above editor |
| `/plugin-dev card on\|off` | Toggle durable audit summary cards in chat log |
| `/plugin-dev reset` | Clear current run history and loaded guidance trackers |
| `/plugin-dev help` | Show command help banner |

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
