/**
 * Auditor tests.
 *
 * The point of these is the two failure modes of the previous version:
 *   - a file that only *mentions* "unsubscribe" in a comment passed the
 *     lifecycle check;
 *   - a file with `pi.on()` and no stored unsubscriber passed too.
 * Both are asserted against here, together with the newer rules.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
	ALL_INVARIANTS,
	auditCodeContent,
	countSubscriptions,
	findLocalInstallSources,
	stripComments,
	stripLiterals,
} from "../src/auditor.js";
import { resolveImportPath, sliceOf } from "../src/slice-auditor.js";
import { checkConfigCascade } from "../src/config-cascade-auditor.js";
import type { ComplianceCheck } from "../src/types.js";

function audit(path: string, content: string): ComplianceCheck[] {
	return auditCodeContent(path, content, ALL_INVARIANTS);
}

function checksFor(path: string, content: string, rule: ComplianceCheck["rule"]): ComplianceCheck[] {
	return audit(path, content).filter((check) => check.rule === rule);
}

function only(path: string, content: string, label: string): ComplianceCheck {
	const found = audit(path, content).filter((check) => check.label === label);
	assert.equal(found.length, 1, `expected exactly one "${label}" check, got ${found.length}`);
	return found[0] as ComplianceCheck;
}

// ------------------------------------------------------------ stripComments

test("stripComments removes comments but keeps strings and templates intact", () => {
	const source = [
		"// a line comment mentioning unsubscribe and NON_TERMINAL",
		"/* block */",
		'const url = "https://example.com/a//b";',
		"const tpl = `value: `${cmd} on`;",
		"const real = pi.on(\"turn_start\", () => {});",
	].join("\n");

	const stripped = stripComments(source);
	assert.equal(stripped.includes("line comment"), false);
	assert.equal(stripped.includes("block"), false);
	assert.equal(stripped.includes("https://example.com/a//b"), true);
	assert.equal(stripped.includes("${cmd} on"), true);
	assert.equal(stripped.includes("pi.on"), true);
});

test("stripComments survives an escaped quote inside a string", () => {
	const stripped = stripComments('const s = "a \\" // not a comment"; const after = pi.on();');
	assert.equal(stripped.includes("not a comment"), true);
	assert.equal(stripped.includes("pi.on"), true);
});

// -------------------------------------------------------------- lifecycle

test("lifecycle: plain pi.on() calls with no storage fail", () => {
	const code = [
		'pi.on("turn_start", () => {});',
		'pi.on("turn_end", () => {});',
		'pi.on("session_shutdown", () => {});',
		"// we unsubscribe and drain every listener here",
	].join("\n");

	const check = only("index.ts", code, "Lifecycle Cleanup Rule");
	assert.equal(check.status, "fail");
	// Three registrations, minus the session_shutdown drainer itself.
	assert.match(check.details, /2 pi\.on\(\) subscription/);
});

test("lifecycle: tracked listeners drained on session_shutdown pass", () => {
	const code = [
		"const unsubscribers: Array<() => void> = [];",
		"const track = (result: unknown): void => {",
		"\tif (typeof result === \"function\") unsubscribers.push(result as () => void);",
		"};",
		'track(pi.on("turn_start", () => {}));',
		'track(pi.on("session_shutdown", () => {',
		"\twhile (unsubscribers.length > 0) unsubscribers.pop()?.();",
		"}));",
	].join("\n");

	const check = only("index.ts", code, "Lifecycle Cleanup Rule");
	assert.equal(check.status, "pass");
});

test("lifecycle: stored but never drained warns", () => {
	const code = [
		'const off = pi.on("turn_start", () => {});',
		"export function dispose() { off(); }",
	].join("\n");

	const check = only("index.ts", code, "Lifecycle Cleanup Rule");
	assert.equal(check.status, "warn");
	assert.match(check.details, /never drained/);
});

test("countSubscriptions sees assignments and helper calls, not callbacks", () => {
	assert.deepEqual(countSubscriptions('pi.on("a", () => {}); pi.on("b", () => {});'), { total: 2, stored: 0 });
	assert.deepEqual(countSubscriptions('const a = pi.on("a", () => {});'), { total: 1, stored: 1 });
	assert.deepEqual(countSubscriptions('list.push(pi.on("a", () => {}));'), { total: 1, stored: 1 });
	assert.deepEqual(countSubscriptions('track(pi.on("a", () => {}));'), { total: 1, stored: 1 });
});

test("countSubscriptions excludes the session_shutdown drainer", () => {
	const code = 'pi.on("session_shutdown", () => { while (u.length > 0) u.pop()?.(); });';
	assert.deepEqual(countSubscriptions(code), { total: 0, stored: 0 });

	const mixed = [
		'track(pi.on("turn_start", () => {}));',
		'pi.on("session_shutdown", () => { while (u.length > 0) u.pop()?.(); });',
	].join("\n");
	assert.deepEqual(countSubscriptions(mixed), { total: 1, stored: 1 });
});

test("countSubscriptions ignores pi.on( mentioned in strings and regex literals", () => {
	const code = [
		'const doc = "call pi.on( to subscribe";',
		"const re = /pi\\.on\\s*\\(/g;",
		"// pi.on( in a comment",
	].join("\n");
	assert.deepEqual(countSubscriptions(code), { total: 0, stored: 0 });
});

test("stripLiterals drops string bodies but keeps code", () => {
	const stripped = stripLiterals('const a = "pi.on( hidden"; const b = pi.on("x", () => {});');
	assert.equal(stripped.includes("hidden"), false);
	assert.equal(stripped.includes("pi.on"), true);
});

// ----------------------------------------------------- command completions

const GOOD_COMPLETIONS = [
	"const NON_TERMINAL = new Set([\"hud\"]);",
	"const LAZY_EXPAND = NON_TERMINAL;",
	"getArgumentCompletions: (prefix) => {",
	"\tconst tokens = prefix.split(/\\s+/).filter(Boolean);",
	"\tif (tokens.length === 1 && LAZY_EXPAND.has(head)) return [];",
	"\treturn [{ value: `hud `, label: \"hud\", description: \"toggle\" },",
	"\t\t{ value: \"hud on\", label: current ? \"on ✓\" : \"on\", description: \"Zapnout\" }];",
	"},",
].join("\n");

test("completions: a clean implementation passes and raises no lazy warning", () => {
	const labels = audit("src/command.ts", GOOD_COMPLETIONS).map((check) => check.label);
	assert.deepEqual(labels.includes("Trailing Space Contract"), true);
	assert.equal(labels.includes("Lazy Parameter Completion"), false);
	assert.equal(labels.includes("Completion Marker Guard"), false);
});

test("completions: a marker inside item.value fails", () => {
	const code = 'const x = { value: `hud on ✓`, label: "on", description: "Zapnout" };\ngetArgumentCompletions: () => [];';
	const check = only("src/command.ts", code, "Completion Marker Guard");
	assert.equal(check.status, "fail");
});

test("completions: non-terminal parameters without lazy expansion warn", () => {
	const code = [
		"const NON_TERMINAL = new Set([\"hud\"]);",
		"getArgumentCompletions: (prefix) => {",
		"\treturn [{ value: `hud `, label: \"hud\", description: \"toggle\" }];",
		"},",
	].join("\n");

	const check = only("src/command.ts", code, "Lazy Parameter Completion");
	assert.equal(check.status, "warn");
});

test("completions: on|off rows without a tick warn about the missing state marker", () => {
	const code = [
		"const NON_TERMINAL = new Set([\"hud\"]);",
		"const LAZY_EXPAND = NON_TERMINAL;",
		"getArgumentCompletions: () => [{ value: `hud on` }, { value: `hud off` }];",
	].join("\n");

	const check = only("src/command.ts", code, "Current-Value Annotation");
	assert.equal(check.status, "warn");
});

test("completions: files without getArgumentCompletions are not audited for completions", () => {
	const labels = audit("src/random.ts", "export const x = 1;").map((check) => check.label);
	assert.equal(labels.includes("Trailing Space Contract"), false);
});

// ------------------------------------------------------------- ui mode

test("ui mode: custom() guarded only by hasUI warns", () => {
	const code = "if (ctx.hasUI) { void ctx.ui.custom(() => card, { overlay: true }); }";
	const check = only("src/visuals/hud.ts", code, "UI Mode Guard");
	assert.equal(check.status, "warn");
	assert.match(check.details, /RPC/);
});

test("ui mode: custom() guarded with ctx.mode === 'tui' passes", () => {
	const code = 'if (ctx.mode === "tui") { void ctx.ui.custom(() => card); }';
	assert.equal(only("src/visuals/hud.ts", code, "UI Mode Guard").status, "pass");
});

test("ui mode: setStatus/setWidget alone raise nothing", () => {
	const code = "if (!ctx.hasUI) return; ctx.ui.setStatus(\"k\", \"v\"); ctx.ui.setWidget(\"k\", [\"x\"]);";
	assert.deepEqual(checksFor("index.ts", code, "ui-mode-guard"), []);
});

// --------------------------------------------------------- state persistence

test("state: appendEntry without a sessionManager read warns", () => {
	const code = 'pi.appendEntry("my-state", { enabled: true });';
	const check = only("index.ts", code, "State Persistence Rule");
	assert.equal(check.status, "warn");
});

test("state: appendEntry plus sessionManager read passes", () => {
	const code = [
		'pi.appendEntry("my-state", { enabled: true });',
		"for (const entry of ctx.sessionManager.getEntries()) {}",
	].join("\n");
	assert.equal(only("index.ts", code, "State Persistence Rule").status, "pass");
});

// ------------------------------------------------------------ docs paths

test("docs: a machine-absolute engine path warns", () => {
	const code = "- Docs: `D:\\02_knihovny_path\\node-v22.17.1-win-x64\\node_modules\\@earendil-works\\pi-coding-agent\\docs`";
	const check = only("skills/pi-plugin-dev/references/api-docs-index.md", code, "Docs Portability");
	assert.equal(check.status, "warn");
});

test("docs: a relative node_modules reference is portable", () => {
	const code = "Read `node_modules/@earendil-works/pi-coding-agent/docs/extensions.md` from the install root.";
	assert.deepEqual(checksFor("docs/guide.md", code, "docs-portability"), []);
});

test("docs: a portable reference raises nothing", () => {
	const code = "Resolve the docs directory with `require.resolve('@earendil-works/pi-coding-agent')`.";
	assert.deepEqual(checksFor("docs/guide.md", code, "docs-portability"), []);
});

// -------------------------------------------------------------- manifest

test("manifest: missing type:module fails", () => {
	const pkg = JSON.stringify({ name: "pi-x", version: "1.0.0", scripts: { test: "node --test" } });
	const check = only("package.json", pkg, "ESM Manifest Guard");
	assert.equal(check.status, "fail");
});

test("manifest: core packages in dependencies fail, in peerDependencies pass", () => {
	const leaked = JSON.stringify({
		name: "pi-x",
		type: "module",
		dependencies: { "@earendil-works/pi-tui": "^0.87.0" },
		scripts: { test: "t" },
	});
	const leakCheck = only("package.json", leaked, "PeerDependencies Guard");
	assert.equal(leakCheck.status, "fail");

	const clean = JSON.stringify({
		name: "pi-x",
		type: "module",
		peerDependencies: { "@earendil-works/pi-tui": "*" },
		scripts: { test: "t" },
	});
	assert.equal(only("package.json", clean, "PeerDependencies Guard").status, "warn");

	const full = JSON.stringify({
		name: "pi-x",
		type: "module",
		peerDependencies: {
			"@earendil-works/pi-ai": "*",
			"@earendil-works/pi-agent-core": "*",
			"@earendil-works/pi-coding-agent": "*",
			"@earendil-works/pi-tui": "*",
			typebox: "*",
		},
		scripts: { test: "t" },
	});
	assert.equal(only("package.json", full, "PeerDependencies Guard").status, "pass");
});

test("manifest: a pi manifest without files warns, and a missing test script warns", () => {
	const pkg = JSON.stringify({ name: "pi-x", type: "module", pi: { extensions: ["./index.ts"] } });
	const labels = audit("package.json", pkg).map((check) => check.label);
	assert.equal(labels.includes("Publish Files Guard"), true);
	assert.equal(labels.includes("Test Script Guard"), true);
});

test("manifest: a local-path install source fails, npm/git pass", () => {
	const settings = JSON.stringify({
		packages: ["npm:pi-web-access", "git:github.com/mastnacek/pi-mcp-viz", { source: "D:/dev/pi-headroom" }],
	});
	const check = only("settings.json", settings, "Install Source Guard");
	assert.equal(check.status, "fail");
	assert.match(check.details, /pi-headroom/);

	const clean = JSON.stringify({ packages: ["git:github.com/mastnacek/pi-mcp-viz", { source: "https://github.com/x/y" }] });
	assert.equal(only("settings.json", clean, "Install Source Guard").status, "pass");
});

test("findLocalInstallSources ignores npm/git/url and flags paths only", () => {
	assert.deepEqual(
		findLocalInstallSources([
			"npm:a@1",
			"git:github.com/x/y",
			"https://github.com/x/y",
			"ssh:git@example.com/x",
			"D:/dev/x",
			"./relative",
			"/abs/path",
			{ source: "C:\\dev\\x" },
			{ source: "npm:b" },
		]),
		["D:/dev/x", "./relative", "/abs/path", "C:\\dev\\x"],
	);
	assert.deepEqual(findLocalInstallSources("not an array"), []);
});

// ----------------------------------------------------------------- misc

test("malformed package.json is ignored instead of throwing", () => {
	assert.deepEqual(audit("package.json", "{ not json"), []);
});

test("ALL_INVARIANTS lists every rule the auditor can emit", () => {
	for (const rule of [
		"trailing-space",
		"string-enum",
		"error-throw",
		"peer-deps",
		"lifecycle-cleanup",
		"manifest-hygiene",
		"ui-mode-guard",
		"state-persistence",
		"docs-portability",
	]) {
		assert.equal(ALL_INVARIANTS.has(rule), true, `missing ${rule}`);
	}
});

// ------------------------------------------------------- slice isolation

test("slice isolation: cross-slice import fails, shared and same-slice pass", () => {
	// Violation: pipeline imports from the tools slice.
	const violating = audit(
		"src/slices/pipeline/index.ts",
		'import { registerModelTools } from "../tools/index.js";\nexport {};',
	);
	const sliceFails = violating.filter((c) => c.rule === "slice-isolation");
	assert.equal(sliceFails.length, 1, "cross-slice import must fail");
	assert.match(sliceFails[0]?.details ?? "", /tools/);

	// Legal: pipeline imports shared kernel + own-slice sibling.
	const clean = audit(
		"src/slices/pipeline/index.ts",
		'import { createState } from "../../shared/state.js";\nimport { helper } from "./helper.js";\nexport {};',
	);
	assert.equal(clean.filter((c) => c.rule === "slice-isolation").length, 0);

	// Non-slice files are never flagged.
	const root = audit("index.ts", 'import { a } from "./src/slices/tools/index.js";\nexport {};');
	assert.equal(root.filter((c) => c.rule === "slice-isolation").length, 0);
});

test("slice isolation: helpers resolve paths and slices correctly", () => {
	assert.equal(sliceOf("src/slices/pipeline/index"), "pipeline");
	assert.equal(sliceOf("src/slices/tools/compact-tool"), "tools");
	assert.equal(sliceOf("src/shared/state"), undefined);
	assert.equal(sliceOf("index"), undefined);

	assert.equal(
		resolveImportPath("src/slices/pipeline/index", "../tools/index.js"),
		"src/slices/tools/index",
	);
	assert.equal(
		resolveImportPath("src/slices/pipeline/tool-call", "./shared.js"),
		"src/slices/pipeline/shared",
	);
});

test("slice isolation: ALL_INVARIANTS includes slice-isolation", () => {
	assert.equal(ALL_INVARIANTS.has("slice-isolation"), true);
});
