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
	isGatedEditTarget,
	matchesToolPattern,
	toolMatchesAny,
} from "../src/source-gate.js";
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
