/**
 * Multilingual UI invariant tests.
 *
 * The rule guards localized plugins: once a file imports its string table, any
 * user-facing prose literal is a real defect. Files that never touch a table are
 * out of scope (adoption is the scaffolder's job), which is what keeps an
 * English-only repo quiet.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { checkMultilingualUi } from "../src/i18n-auditor.js";
import { ALL_INVARIANTS, auditCodeContent } from "../src/auditor.js";
import { i18nKernelSource, i18nStarterTestSource, localizedCommandsSource } from "../src/i18n-template.js";

const LOCALIZED = `import { stringsFor } from "../shared/i18n.js";

export function paint(ctx, state) {
	const s = stringsFor(state.lang);
	ctx.ui.notify(s.ready, "info");
}
`;

test("a localized file that routes text through the table is clean", () => {
	assert.deepEqual(checkMultilingualUi("src/slices/tools/index.ts", LOCALIZED), []);
});

test("prose in a UI sink fails, and the report names the sink and the line", () => {
	const content = `import { stringsFor } from "../shared/i18n.js";

export function paint(ctx, state) {
	const s = stringsFor(state.lang);
	ctx.ui.notify(s.ready, "info");
	ctx.ui.notify("No deferred quick wins.", "info");
}
`;
	const findings = checkMultilingualUi("src/slices/commands/index.ts", content);
	assert.equal(findings.length, 1);
	const finding = findings[0];
	assert.equal(finding?.severity, "fail");
	assert.equal(finding?.sink, "ui.notify");
	assert.equal(finding?.literal, "No deferred quick wins.");
	assert.equal(finding?.line, 6);
});

test("a lone token warns instead of failing the build", () => {
	const content = `import { stringsFor } from "../shared/i18n.js";
ctx.ui.select("later", []);
`;
	const findings = checkMultilingualUi("src/slices/commands/index.ts", content);
	assert.equal(findings.length, 1);
	assert.equal(findings[0]?.severity, "warn");
});

test("setStatus flags the text, not the status id", () => {
	const content = `import { stringsFor } from "../shared/i18n.js";
ctx.ui.setStatus("my-plugin", "3 cards waiting");
`;
	const findings = checkMultilingualUi("src/slices/status/index.ts", content);
	assert.equal(findings.length, 1);
	assert.equal(findings[0]?.literal, "3 cards waiting");
});

test("an English-only file is out of scope: no table, no complaint", () => {
	const content = `export function paint(ctx) {
	ctx.ui.notify("Plugin is ready.", "info");
}
`;
	assert.deepEqual(checkMultilingualUi("src/slices/commands/index.ts", content), []);
});

test("the string table itself may contain prose", () => {
	const source = i18nKernelSource("demo");
	assert.deepEqual(checkMultilingualUi("src/shared/i18n.ts", source), []);
});

test("a comment that quotes a sink is not a finding", () => {
	const content = `import { stringsFor } from "../shared/i18n.js";
// ctx.ui.notify("hardcoded text") is what this file must never do.
ctx.ui.notify(stringsFor("en").ready, "info");
`;
	assert.deepEqual(checkMultilingualUi("src/slices/commands/index.ts", content), []);
});

test("tool descriptions stay English and are exempt", () => {
	const content = `import { stringsFor } from "../shared/i18n.js";
pi.registerTool({
	name: "demo_status",
	description: "Check status of the demo plugin",
	parameters: Type.Object({}),
});
`;
	assert.deepEqual(checkMultilingualUi("src/slices/tools/index.ts", content), []);
});

test("the invariant is registered and reaches the aggregated audit", () => {
	assert.ok(ALL_INVARIANTS.has("multilingual-ui"));
	const content = `import { stringsFor } from "../shared/i18n.js";
ctx.ui.notify("This one is hardcoded.", "info");
`;
	const checks = auditCodeContent("src/slices/commands/index.ts", content, ALL_INVARIANTS);
	const hits = checks.filter((c) => c.rule === "multilingual-ui");
	assert.equal(hits.length, 1);
	assert.equal(hits[0]?.status, "fail");
	assert.match(hits[0]?.details ?? "", /multilingual-ui\.md/);
});

test("the scaffolded commands slice is itself compliant", () => {
	const source = localizedCommandsSource("demo-plugin", "Demo");
	assert.deepEqual(checkMultilingualUi("src/slices/commands/index.ts", source), []);
	assert.match(source, /stringsFor\(state\.lang\)/);
	assert.match(source, /getArgumentCompletions/);
});

test("the shipped kernel is cross-platform: no env sniffing, no home paths", () => {
	const source = i18nKernelSource("demo-plugin");
	for (const forbidden of ["process.env", "homedir", "LANG", "Intl.", "\\\\", "/Users/"]) {
		assert.ok(!source.includes(forbidden), `the i18n kernel must not contain ${forbidden}`);
	}
	assert.match(source, /export const LOCALES = \["en", "cs"\] as const;/);
	assert.match(i18nStarterTestSource("demo-plugin"), /stringsFor/);
});
