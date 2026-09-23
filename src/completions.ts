/**
 * `/plugin-dev` command menu.
 *
 * Pure functions of the live config, so the whole menu can be unit-tested
 * without a terminal (see `test/completions.test.ts`). Two contracts from the
 * pi-plugin-dev skill drive the shape:
 *
 *   - **Trailing Space Contract** — non-terminal rows end with a space so Tab
 *     confirms and immediately offers the next level; terminal rows do not.
 *   - **Current-Value State Annotation** — the value actually in effect carries
 *     `✓` in `label` and ` · ● AKTIVNÍ` / ` · ● ZAPNUTO` in `description`.
 *     Markers never touch `value`, which is inserted verbatim into the editor.
 *
 * Lazy Parameter Completion: a fully typed non-terminal token (`hud`) already
 * returns its children, because Tab closes the picker and Tab cannot re-open it.
 */

import type { AutocompleteItem } from "@earendil-works/pi-tui";
import type { PluginDevConfig } from "./types.js";

export const COMMAND_DOCS: Record<string, string> = {
	status: "Zobrazit aktuální stav monitoringu a scorecard pravidel",
	doctor: "Zkontrolovat engine, instalace, skill manifest a self-audit",
	hud: "Přepnout plovoucí HUD overlay (on | off)",
	widget: "Přepnout dokovaný widget nad editorem (on | off)",
	card: "Přepnout ukládání souhrnných karet do chatu (on | off)",
	reset: "Vynulovat počítadla a načtené reference aktuálního běhu",
	help: "Zobrazit podrobnou nápovědu k příkazu /plugin-dev",
};

/** Subcommands that take parameters; their first-level row keeps the space. */
export const NON_TERMINAL = new Set(["hud", "widget", "card"]);

/** Live on/off value of a toggle subcommand, or undefined for non-toggles. */
export function toggleStateFor(config: PluginDevConfig, cmd: string): boolean | undefined {
	if (cmd === "hud") return config.hud;
	if (cmd === "widget") return config.widget;
	if (cmd === "card") return config.transcriptCard;
	return undefined;
}

/** Build the `getArgumentCompletions` function for `/plugin-dev`. */
export function createCompletions(getConfig: () => PluginDevConfig) {
	return (prefix: string): AutocompleteItem[] | null => {
		const tokens = prefix.split(/\s+/).filter(Boolean);
		const trailingSpace = /\s$/.test(prefix);
		const normalizedPrefix = tokens.join(" ").toLowerCase();
		const head = (tokens[0] ?? "").toLowerCase();
		const config = getConfig();

		// 2nd-level parameters. A fully typed non-terminal token already expands:
		// Tab closes the picker, so waiting for the trailing space would strand the
		// user with no way back to the parameter list.
		const atParameterLevel =
			tokens.length > 1 ||
			(trailingSpace && tokens.length === 1) ||
			(tokens.length === 1 && NON_TERMINAL.has(head));
		if (atParameterLevel) {
			const current = toggleStateFor(config, head);
			if (current === undefined) return null;

			const items = [
				{
					value: `${head} on`,
					// `label` is display-only; `value` stays clean so it can be inserted
					// verbatim into the editor (Trailing Space Contract).
					label: current ? "on ✓" : "on",
					description: `Zapnout ${head.toUpperCase()}${current ? " · ● AKTIVNÍ" : ""}`,
				},
				{
					value: `${head} off`,
					label: current ? "off" : "off ✓",
					description: `Vypnout ${head.toUpperCase()}${current ? "" : " · ● AKTIVNÍ"}`,
				},
			];
			const filtered = items.filter((item) => item.value.toLowerCase().startsWith(normalizedPrefix));
			return filtered.length > 0 ? filtered : null;
		}

		// 1st-level subcommands with the Trailing Space Contract.
		const typed = head;
		const items: AutocompleteItem[] = [];
		for (const [key, description] of Object.entries(COMMAND_DOCS)) {
			if (!key.toLowerCase().startsWith(typed)) continue;
			const flag = toggleStateFor(config, key);
			const state = flag === undefined ? "" : flag ? " · ● ZAPNUTO" : " · ○ VYPNUTO";
			items.push({
				value: NON_TERMINAL.has(key) ? `${key} ` : key,
				label: key,
				description: `${description}${state}`,
			});
		}
		return items.length > 0 ? items : null;
	};
}
