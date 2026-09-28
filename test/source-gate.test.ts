/**
 * Consult-before-edit gate tests — pattern matching and block-reason builders.
 * Gate state (satisfiedTools / activeSkill) lives in index.ts; these tests
 * cover the pure decision logic.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
	buildMcpGateReason,
	buildSkillGateReason,
	buildUnknownTargetGateReason,
	isGatedEditTarget,
	matchesToolPattern,
	mutationTargeting,
	toolMatchesAny,
	type MutationTargeting,
} from "../src/source-gate.js";
import { DEFAULT_CONFIG } from "../src/types.js";
import { checkFileLines } from "../src/line-monitor.js";

test("matchesToolPattern: substring and prefix semantics, case-insensitive", () => {
	assert.equal(matchesToolPattern("mcp__knowledge_base_kb_search", "kb_search"), true);
	assert.equal(matchesToolPattern("mcp__knowledge_base_kb_search", "mcp__knowledge_base*"), true);
	assert.equal(matchesToolPattern("kb_search", "KB_SEARCH"), true);
	assert.equal(matchesToolPattern("read", "kb_search"), false);
	assert.equal(matchesToolPattern("anything", ""), false);
});

test("toolMatchesAny checks raw and base tool name", () => {
	assert.equal(toolMatchesAny("mcp__knowledge_base_kb_search", ["mcp__knowledge_base*"]), true);
	assert.equal(toolMatchesAny("some__kb_search", ["kb_search"]), true);
	assert.equal(toolMatchesAny("read", ["kb_search", "mcp__other*"]), false);
});

test("isGatedEditTarget: source files gated, docs and deps not", () => {
	assert.equal(isGatedEditTarget("C:\\proj\\src\\app.ts"), true);
	assert.equal(isGatedEditTarget("C:\\proj\\README.md"), false);
	assert.equal(isGatedEditTarget("C:\\proj\\node_modules\\dep\\index.js"), false);
});

test("gate reasons are actionable and self-describing", () => {
	const skill = buildSkillGateReason("C:\\proj\\src\\app.ts");
	assert.match(skill, /SKILL BEFORE EDIT/);
	assert.match(skill, /SKILL\.md/);
	assert.match(skill, /enforceSkillBeforeEdit/);

	const mcp = buildMcpGateReason(["kb_search", "mcp__other*"]);
	assert.match(mcp, /CONSULT BEFORE EDIT/);
	assert.match(mcp, /kb_search, mcp__other\*/);
});

test("line monitor still reports unchecked md files so docs stay ungated", () => {
	assert.equal(checkFileLines("C:\\proj\\docs\\notes.md", 400).checked, false);
});

const GATE_CFG = {
	mutationTools: DEFAULT_CONFIG.gatedMutationTools,
	pathlessTools: DEFAULT_CONFIG.gatedPathlessTools,
};

test("the gate covers the hashline editor, not just edit/write", () => {
	// The regression: `pi-hashline-edit-pro` replaced the edit path with `replace`
	// and `insert`, and a gate keyed on edit/write silently stopped gating.
	const cases: Array<[string, Record<string, unknown>, MutationTargeting]> = [
		["edit", { path: "C:\\proj\\src\\app.ts" }, "path"],
		["write", { path: "C:\\proj\\src\\app.ts" }, "path"],
		// `replace` carries a path for identity, even though the anchor decides the line.
		["replace", { path: "C:\\proj\\src\\app.ts", remove_from: "ldSI" }, "path"],
		// `insert` is anchor-only by contract: path resolution is the editor's job.
		["insert", { anchor: "ldSI", direction: "after", lines: ["const x = 1;"] }, "anchor"],
		// An MCP-namespaced copy is still caught, raw or base name.
		["mcp__editor__insert", { anchor: "ldSI" }, "anchor"],
		// Not mutations: the gate must not widen onto readers.
		["read", { path: "C:\\proj\\src\\app.ts" }, null],
		["anchor_grep", { pattern: "foo" }, null],
		["undo_last_change", { path: "C:\\proj\\src\\app.ts" }, null],
	];
	for (const [name, input, expected] of cases) {
		assert.equal(mutationTargeting(name, input, GATE_CFG), expected, `for tool ${name}`);
	}
});

test("an explicit path wins over the anchor-only classification", () => {
	// Same tool, path supplied: the file-level gates become available again.
	assert.equal(
		mutationTargeting("insert", { path: "C:\\proj\\src\\app.ts", anchor: "ldSI" }, GATE_CFG),
		"path",
	);
	// A blank path is not a path.
	assert.equal(mutationTargeting("insert", { path: "   ", anchor: "ldSI" }, GATE_CFG), "anchor");
	assert.equal(mutationTargeting("insert", { path: 42, anchor: "ldSI" }, GATE_CFG), "anchor");
});

test("a fourth editor tool is a config change, not a patch", () => {
	const custom = { mutationTools: [...GATE_CFG.mutationTools, "apply_patch"], pathlessTools: GATE_CFG.pathlessTools };
	assert.equal(mutationTargeting("apply_patch", { path: "C:\\proj\\src\\a.ts" }, custom), "path");
	assert.equal(mutationTargeting("apply_patch", { path: "C:\\proj\\src\\a.ts" }, GATE_CFG), null);
	// Dropping a tool turns its gate off again.
	const withoutInsert = { mutationTools: ["edit", "write", "replace"], pathlessTools: [] };
	assert.equal(mutationTargeting("insert", { anchor: "ldSI" }, withoutInsert), null);
});

test("the anchor-only reason is honest about what could not be checked", () => {
	const reason = buildUnknownTargetGateReason("insert", "SKILL BEFORE EDIT");
	assert.match(reason, /SKILL BEFORE EDIT/);
	assert.match(reason, /'insert'/);
	assert.match(reason, /anchor/);
	// It must not claim the file was inspected — it was not.
	assert.doesNotMatch(reason, /is source code/);
	assert.match(reason, /enforcePathlessEditGate/);
	assert.match(reason, /SKILL\.md/);
});

test("the shipped defaults cover the installed editor", () => {
	assert.deepEqual(DEFAULT_CONFIG.gatedMutationTools, ["edit", "write", "replace", "insert"]);
	assert.deepEqual(DEFAULT_CONFIG.gatedPathlessTools, ["insert"]);
	assert.equal(DEFAULT_CONFIG.enforcePathlessEditGate, true);
	// Every anchor-only tool must also be a mutation tool, or the subset is dead config.
	for (const t of DEFAULT_CONFIG.gatedPathlessTools) {
		assert.ok(
			DEFAULT_CONFIG.gatedMutationTools.includes(t),
			`${t} is pathless but not gated`,
		);
	}
});
