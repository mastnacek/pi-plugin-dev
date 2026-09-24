/**
 * `/plugin-dev` command menu tests.
 *
 * Locks the three contracts from the pi-plugin-dev skill:
 *   - Trailing Space Contract (non-terminal rows end with a space);
 *   - Lazy Parameter Completion (a fully typed `hud` already expands to on|off,
 *     because Tab closes the picker and cannot re-open it);
 *   - Current-Value State Annotation (✓ in `label`, ` · ● AKTIVNÍ` in
 *     `description`, never in `value`, never ANSI).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { COMMAND_DOCS, createCompletions, toggleStateFor } from "../src/completions.js";
import { DEFAULT_CONFIG, type PluginDevConfig } from "../src/types.js";

function config(overrides: Partial<PluginDevConfig> = {}): PluginDevConfig {
	return { ...DEFAULT_CONFIG, ...overrides };
}

function complete(prefix: string, overrides: Partial<PluginDevConfig> = {}): AutocompleteItem[] {
	return createCompletions(() => config(overrides))(prefix) ?? [];
}

function row(items: AutocompleteItem[], label: string): AutocompleteItem {
	const found = items.find((item) => item.label === label || item.label.startsWith(`${label} `));
	assert.ok(found, `no row for "${label}" — got ${JSON.stringify(items.map((i) => i.label))}`);
	return found;
}

function desc(item: AutocompleteItem | undefined): string {
	return item?.description ?? "";
}

test("first level: non-terminal rows keep the trailing space, terminal rows do not", () => {
	const items = complete("");
	for (const name of ["hud", "widget", "card"]) {
		assert.equal(row(items, name).value, `${name} `, `${name} must stay non-terminal`);
	}
	for (const name of ["status", "doctor", "reset", "help"]) {
		assert.equal(row(items, name).value, name, `${name} must be terminal`);
	}
});

test("first level: toggles carry the live ZAPNUTO/VYPNUTO annotation", () => {
	const on = complete("");
	assert.equal(desc(row(on, "hud")).includes("● ZAPNUTO"), true);
	assert.equal(desc(row(on, "card")).includes("● ZAPNUTO"), true);

	const off = complete("", { hud: false, widget: false, transcriptCard: false });
	assert.equal(desc(row(off, "hud")).includes("○ VYPNUTO"), true);
	assert.equal(desc(row(off, "widget")).includes("○ VYPNUTO"), true);
	assert.equal(desc(row(off, "card")).includes("○ VYPNUTO"), true);
});

test("first level: doctor/react rows carry no state suffix", () => {
	const items = complete("");
	assert.equal(desc(row(items, "doctor")).includes("ZAPNUTO"), false);
	assert.equal(desc(row(items, "status")).includes("VYPNUTO"), false);
});

test("a fully typed non-terminal token already expands to on|off", () => {
	const items = complete("hud");
	assert.deepEqual(
		items.map((item) => item.value),
		["hud on", "hud off"],
	);
	const partial = complete("ca");
	assert.equal(row(partial, "card").value, "card ");
});

test("2nd level: the active value carries ✓ and ● AKTIVNÍ", () => {
	const items = complete("hud ", { hud: true });
	assert.equal(row(items, "on ✓").value, "hud on");
	assert.equal(desc(row(items, "on ✓")).includes("● AKTIVNÍ"), true);
	assert.equal(row(items, "off").value, "hud off");
	assert.equal(desc(row(items, "off")).includes("● AKTIVNÍ"), false);

	const disabled = complete("widget ", { widget: false });
	assert.equal(row(disabled, "off ✓").value, "widget off");
	assert.equal(desc(row(disabled, "off ✓")).includes("● AKTIVNÍ"), true);
});

test("2nd level: a partial parameter filters the rows", () => {
	const items = complete("hud o", { hud: true });
	assert.deepEqual(
		items.map((item) => item.value),
		["hud on", "hud off"],
	);
	assert.deepEqual(
		complete("hud of", { hud: true }).map((item) => item.value),
		["hud off"],
	);
});

test("a parameter after a terminal subcommand yields nothing", () => {
	assert.deepEqual(complete("status "), []);
	assert.deepEqual(complete("doctor x"), []);
});

test("markers never leak into item.value and no ANSI is embedded", () => {
	for (const prefix of ["", "hud", "hud ", "widget ", "card o"]) {
		for (const item of complete(prefix)) {
			assert.equal(/[✓●○]/.test(item.value), false, `marker in value: ${item.value}`);
			assert.equal(/\u001b/.test(item.value + item.label + desc(item)), false);
		}
	}
});

test("toggleStateFor maps only the three toggles", () => {
	const cfg = config({ hud: true, widget: false, transcriptCard: true });
	assert.equal(toggleStateFor(cfg, "hud"), true);
	assert.equal(toggleStateFor(cfg, "widget"), false);
	assert.equal(toggleStateFor(cfg, "card"), true);
	assert.equal(toggleStateFor(cfg, "status"), undefined);
	assert.equal(toggleStateFor(cfg, "doctor"), undefined);
});

test("every documented subcommand is reachable from the first level", () => {
	const items = complete("");
	assert.deepEqual(
		items.map((item) => item.label).sort(),
		Object.keys(COMMAND_DOCS).sort(),
	);
});

test("--global prefix preserves child completions", () => {
	const items = complete("--global ");
	assert.ok(items.length > 0);
	assert.ok(items.some((i) => i.value === "--global hud "));
	assert.ok(items.some((i) => i.value === "--global widget "));

	const hudItems = complete("--global hud ");
	assert.ok(hudItems.length > 0);
	assert.ok(hudItems.some((i) => i.value === "--global hud on"));
	assert.ok(hudItems.some((i) => i.value === "--global hud off"));
});
