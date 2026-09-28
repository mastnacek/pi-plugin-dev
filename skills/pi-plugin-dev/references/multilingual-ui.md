# Multilingual UI — user-facing text goes through a string table

**Rule.** Text the **user** reads comes from a string table. Text the **model** reads stays English.

That split is the whole contract. A Czech operator and an English-reading agent are both served by one binary:
the buttons, prompts, statusline and dialogs are localized; the tool descriptions the agent follows are not.

The scaffold ships the table (`src/shared/i18n.ts`) and the `lang` command, so a new plugin is `cs` + `en` from
its first commit. The auditor (`src/i18n-auditor.ts`, invariant `multilingual-ui`) fails any file that imports its
table and then hardcodes prose in a UI sink.

## The kernel every scaffolded plugin gets

```ts
export const LOCALES = ["en", "cs"] as const;
export type Locale = (typeof LOCALES)[number];

export interface CardStrings { title: string; ready: string; /* … */ }

const STRINGS: Record<Locale, CardStrings> = { en: { /* … */ }, cs: { /* … */ } };

export function stringsFor(locale: string | undefined): CardStrings {
	return STRINGS[normalizeLocale(locale)];
}

/** A typo is English, never a crash. */
export function normalizeLocale(raw: string | undefined): Locale {
	const token = (raw ?? "").trim().toLowerCase();
	if (token === "cs" || token === "cz" || token === "cze") return "cs";
	return "en";
}
```

Add a locale by adding a row: `LOCALES` drives the completion menu, `stringsFor` drives the rendering, nothing else
changes. Keep `strings` **flat and complete per locale** — a missing key must not silently fall back to English at
runtime, because that is how a half-translated UI ships.

## Persisting the choice

`lang` is a normal config key in the cascade (see the config-cascade rule), so it obeys the same contract as every
other setting: `--global` writes `~/.pi/agent/<plugin>.json`, its absence writes `<cwd>/.pi/<plugin>.json`, and only
the changed key is written to the nearer layer.

```ts
saveConfig({ lang: locale }, isGlobal, ctx.cwd, state.globalFile);
state.config = { ...state.config, lang: locale };
```

An unknown locale typed at the command line is a **usage error**, not a silent reset: refuse it, write nothing.

## What the auditor checks, and what it deliberately ignores

In scope — a file that imports its table and then hardcodes prose in:

| Sink | Why |
| --- | --- |
| `ctx.ui.notify(…)` | the user reads it |
| `ctx.ui.select(…)` / `ctx.ui.confirm(…)` | the user reads it |
| `ctx.ui.setStatus(id, "…")` | the second argument only; the id is the plugin's own |
| `description:` inside `registerCommand` | it is completion-menu copy |

Out of scope, on purpose:

- **Tool `description` and tool result text** — the agent is the reader, so English is correct. The rule detects the
  enclosing `registerTool(` and exempts it.
- **Template literals** — a value composed at runtime cannot be judged statically, and a scaffolder's own template
  contains `description:` as *text about code*.
- **Files that never import a table** — adoption is the scaffolder's job; flagging every English-only repo in a
  monorepo produces noise nobody acts on. The moment a file imports its table, every bypass is a real defect.
- **The table itself** — `src/shared/i18n.ts` is where prose belongs.

Severity: prose (a literal with a space) is a `fail`, a lone token is a `warn`. Ids, levels and units are values, not
copy, and failing a build over `"later"` is how auditors get turned off.

## Cross-platform rules (Windows, Linux, macOS)

The whole feature has to survive three platforms without a fork, which rules out the usual shortcuts:

- **No environment sniffing.** `LANG`, `LC_ALL` and `LC_MESSAGES` are absent on Windows, inconsistent in containers
  and frequently wrong under a TUI. A persisted `lang` setting is the only source of truth.
- **No `Intl` default-locale guessing.** `Intl.DateTimeFormat().resolvedOptions().locale` returns the *host* locale and
  would make the same session render differently on two machines.
- **No path or home assumptions in the table.** Persistence goes through the config cascade, which already resolves
  the agent directory correctly on `%USERPROFILE%` and `$HOME`.
- **LF sources, UTF-8 writes.** `writeFileSync(…, "utf8")` and `\n` newlines keep a scaffolded tree byte-identical
  everywhere; a CRLF checkout must never be able to corrupt a string literal.
- **No shell.** The auditor is a pure `(path, content) → findings` function — no `exec`, no `grep`, nothing that
  behaves differently on `cmd.exe`.

## Checklist for a new or audited plugin

1. `src/shared/i18n.ts` exists with every key in every locale.
2. `lang` is a config key in the cascade, `/<command> lang <code>` sets it, completions mark the value in effect.
3. Every `notify` / `select` / `confirm` / `setStatus` text and the `registerCommand` description resolve through
   `stringsFor(state.config.lang)`.
4. Tool descriptions and result text stay English — do not "helpfully" translate them.
5. A test walks `LOCALES` and asserts no key is empty (the scaffold ships exactly that test).
6. `npm test` includes a render assertion in the non-default locale, so a regression is visible, not theoretical.
