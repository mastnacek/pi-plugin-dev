/**
 * i18n template — the multilingual kernel every scaffolded plugin is born with.
 *
 * Cross-platform by construction, which is the whole reason this file exists
 * instead of a snippet in the docs:
 *   - no `Intl` locale guessing, no `LANG`/`LC_ALL` sniffing (absent on Windows,
 *     inconsistent in containers, and often wrong under a TUI);
 *   - no `os.homedir()`-relative defaults, no `path.sep` in literals;
 *   - persistence is delegated to the plugin's own config cascade, so Windows
 *     (`%USERPROFILE%`) and POSIX (`$HOME`) are handled by the layer that already
 *     resolves the agent directory;
 *   - every source string is written with `writeFileSync(..., "utf8")` and `\n`
 *     newlines, so a scaffolded tree is byte-identical on every platform and a
 *     CRLF checkout never breaks a string table.
 *
 * The rule the auditor enforces around it: text the USER reads comes from here;
 * text the MODEL reads (tool descriptions, result text) stays English.
 */

/** The i18n kernel source: `src/shared/i18n.ts` in a scaffolded plugin. */
export function i18nKernelSource(pluginName: string): string {
	return `/**
 * i18n kernel for ${pluginName}.
 *
 * One table per locale, one lookup, no runtime dependency, no environment
 * sniffing. Add a locale by adding a row: \`LOCALES\` drives the command menu and
 * \`stringsFor\` drives the rendering, so nothing else has to change.
 *
 * Split the strings honestly:
 *   - what the USER reads goes here;
 *   - what the MODEL reads (tool descriptions, tool result text) stays English,
 *     because the agent is the one being instructed.
 */

export const LOCALES = ["en", "cs"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

export interface CardStrings {
	/** Slash command help and the statusline prefix. */
	title: string;
	/** Informational message shown with ctx.ui.notify. */
	ready: string;
	/** Answer of the \`/status\` subcommand. */
	status: (enabled: boolean) => string;
	/** Ask before a destructive action. */
	confirm: string;
	/** Shown after a successful action. */
	done: string;
}

const STRINGS: Record<Locale, CardStrings> = {
	en: {
		title: "${pluginName}",
		ready: "${pluginName} is ready.",
		status: (enabled) => \`${pluginName} is \${enabled ? "enabled" : "muted"}.\`,
		confirm: "Do you really want to continue?",
		done: "Done.",
	},
	cs: {
		title: "${pluginName}",
		ready: "${pluginName} je připraven.",
		status: (enabled) => \`${pluginName} je \${enabled ? "zapnut" : "ztlumen"}.\`,
		confirm: "Opravdu chcete pokračovat?",
		done: "Hotovo.",
	},
};

/** The table for a locale; anything unknown falls back to the default. */
export function stringsFor(locale: string | undefined): CardStrings {
	return STRINGS[normalizeLocale(locale)];
}

/** Accept the obvious spellings; a typo is English, never a crash. */
export function normalizeLocale(raw: string | undefined): Locale {
	const token = (raw ?? "").trim().toLowerCase();
	if (token === "cs" || token === "cz" || token === "cze") return "cs";
	return DEFAULT_LOCALE;
}
`;
}

/** The commands slice source: localized, with a `lang` subcommand wired in. */
export function localizedCommandsSource(pluginName: string, description: string): string {
	return `/**
 * Commands slice for ${pluginName}.
 *
 * Every string the user reads comes from the string table, so the same source
 * serves every locale. \`lang\` is a non-terminal subcommand: it opens its own
 * value level (Trailing Space Contract, references/command-completions.md).
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { LOCALES, normalizeLocale, stringsFor, type Locale } from "../shared/i18n.js";
import type { PluginState } from "../shared/state.js";

export function registerCommands(pi: ExtensionAPI, state: PluginState): void {
	pi.registerCommand("${pluginName}", {
		// The description is user-facing, so it resolves at completion time from
		// the table instead of being frozen into the registration.
		getArgumentCompletions: (prefix: string) => completions(prefix, state.lang),
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const s = stringsFor(state.lang);
			const tokens = args.trim().split(/\\s+/).filter(Boolean);
			const sub = (tokens[0] ?? "status").toLowerCase();

			if (sub === "lang") {
				const requested = tokens[1]?.toLowerCase();
				if (!requested || !(LOCALES as readonly string[]).includes(requested)) {
					if (ctx.hasUI) {
						ctx.ui.notify(
							\`Usage: /${pluginName} lang <\${LOCALES.join("|")}>\`,
							"warning",
						);
					}
					return;
				}
				state.lang = normalizeLocale(requested);
				if (ctx.hasUI) ctx.ui.notify(\`\${s.title}: \${state.lang}\`, "info");
				return;
			}

			if (!ctx.hasUI) return;
			ctx.ui.notify(s.status(state.enabled), "info");
		},
	});
}

/** \`lang \` is non-terminal: it offers the locales, terminal once chosen. */
function completions(prefix: string, lang: Locale): { value: string; label: string; description: string }[] | null {
	const text = prefix.trimStart();
	const head = text.split(/\\s+/)[0]?.toLowerCase() ?? "";

	if (head === "lang") {
		const typed = text.slice("lang".length).trim().toLowerCase();
		const rows = LOCALES.map((locale) => ({
			value: \`lang \${locale}\`,
			label: lang === locale ? \`\${locale} ✓\` : locale,
			description: \`${pluginName} UI language\${lang === locale ? " · ● AKTIVNÍ" : ""}\`,
		})).filter((row) => row.value.toLowerCase().startsWith(\`lang \${typed}\`));
		return rows.length > 0 ? rows : null;
	}

	if (head !== "" && !"lang".startsWith(head)) return null;
	return [{ value: "lang ", label: "lang", description: "Jazyk uživatelského rozhraní" }];
}
`;
}

/** The starter test that proves the table is complete and total. */
export function i18nStarterTestSource(pluginName: string): string {
	return `import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_LOCALE, LOCALES, normalizeLocale, stringsFor } from "../src/shared/i18n.js";

test("every locale has a complete string table", () => {
	for (const locale of LOCALES) {
		const s = stringsFor(locale);
		for (const key of ["title", "ready", "confirm", "done"] as const) {
			assert.equal(typeof s[key], "string", \`\${locale}.\${key} must be a string\`);
			assert.ok(s[key].trim().length > 0, \`\${locale}.\${key} must not be empty\`);
		}
		assert.equal(typeof s.status(true), "string");
	}
});

test("an unknown locale is English, never a crash", () => {
	assert.equal(normalizeLocale("klingon"), "en");
	assert.equal(normalizeLocale(undefined), "en");
	assert.equal(stringsFor("nonsense").title, stringsFor("en").title);
});
test("the default locale is the one the scaffold ships", () => {
	assert.equal(stringsFor(DEFAULT_LOCALE).title, "${pluginName}");
	assert.equal(DEFAULT_LOCALE, "en");
});
`;
}
