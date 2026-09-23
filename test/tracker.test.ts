/**
 * Tracker tests — skill detection, guidance tracking and the auditor hand-off.
 *
 * The auditor regression covered here: several checks can carry the same `rule`
 * for one file (a marker `fail` next to a trailing-space `pass`). De-duplicating
 * on the rule alone let the last check erase the failure, so both must survive.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { SkillTracker } from "../src/tracker.js";

const SKILL_PATH = "C:\\proj\\.pi\\skills\\pi-plugin-dev\\SKILL.md";
const REFERENCE_PATH = "C:\\proj\\.pi\\skills\\pi-plugin-dev\\references\\command-completions.md";

test("reading SKILL.md activates the skill and records an action", () => {
	const tracker = new SkillTracker();
	tracker.onToolStart("read", { path: SKILL_PATH });

	const state = tracker.getState();
	assert.equal(state.activeSkill, "pi-plugin-dev");
	assert.equal(state.skillPath, SKILL_PATH.replace(/\\/g, "/"));
	assert.equal(state.actions.length, 1);
	assert.match(state.actions[0]?.summary ?? "", /skill entry point/i);
});

test("reading a references document registers guidance, not source inspection", () => {
	const tracker = new SkillTracker();
	tracker.onToolStart("read", { path: REFERENCE_PATH });

	const state = tracker.getState();
	assert.equal(state.references.size, 1);
	const reference = state.references.get("command-completions.md");
	assert.ok(reference, "reference registered under its basename");
	assert.match(reference.summary, /Trailing Space Contract/);
	// Guidance reads are not counted as inspected source files.
	assert.equal(state.inspectedFiles.size, 0);
});

test("a plain source read is counted as an inspected file", () => {
	const tracker = new SkillTracker();
	tracker.onToolStart("read", { path: "D:\\dev\\plugin\\src\\command.ts" });
	const state = tracker.getState();
	assert.equal(state.inspectedFiles.size, 1);
	assert.equal(state.references.size, 0);
});

test("an edit carrying a marker inside item.value records a failing gate", () => {
	const tracker = new SkillTracker();
	tracker.onToolStart("edit", {
		path: "src/command.ts",
		edits: [{ newText: "const item = { value: `hud on ✓`, label: \"on\" };\ngetArgumentCompletions: () => [];" }],
	});

	const findings = tracker.getState().compliance;
	const marker = findings.find((check) => check.label === "Completion Marker Guard");
	assert.ok(marker, `expected a marker gate, got ${JSON.stringify(findings.map((c) => c.label))}`);
	assert.equal(marker.status, "fail");
	assert.equal(marker.targetFile, "src/command.ts");
});

test("checks of the same rule coexist instead of overwriting each other", () => {
	const tracker = new SkillTracker();
	tracker.onToolStart("edit", {
		path: "src/command.ts",
		edits: [{ newText: "const item = { value: `hud on ✓`, label: \"on\" };\ngetArgumentCompletions: () => [];" }],
	});

	const labels = tracker.getState().compliance.map((check) => check.label);
	assert.equal(labels.includes("Completion Marker Guard"), true);
	assert.equal(labels.includes("Trailing Space Contract"), true);
});

test("auditing an unrelated file does not invent findings", () => {
	const tracker = new SkillTracker();
	tracker.onToolStart("edit", { path: "src/config.ts", edits: [{ newText: "export const answer = 42;\n" }] });
	assert.deepEqual(tracker.getState().compliance, []);
});

test("reset clears skill, references, actions and gates", () => {
	const tracker = new SkillTracker();
	tracker.startTurn();
	tracker.onToolStart("read", { path: SKILL_PATH });
	tracker.onToolStart("read", { path: REFERENCE_PATH });
	tracker.onToolStart("edit", { path: "src/x.ts", edits: [{ newText: "pi.on(\"turn_start\", () => {});" }] });
	assert.equal(tracker.getState().compliance.length > 0, true);

	tracker.reset();
	const state = tracker.getState();
	assert.equal(state.activeSkill, undefined);
	assert.equal(state.references.size, 0);
	assert.equal(state.actions.length, 0);
	assert.equal(state.compliance.length, 0);
	assert.equal(state.turnCount, 0);
	assert.equal(state.inTurn, false);
});

test("turns are bracketed and published to subscribers", () => {
	const tracker = new SkillTracker();
	let notifications = 0;
	const unsubscribe = tracker.subscribe(() => {
		notifications += 1;
	});

	tracker.startTurn();
	assert.equal(tracker.getState().inTurn, true);
	tracker.endTurn();
	assert.equal(tracker.getState().inTurn, false);
	assert.equal(tracker.getState().turnCount, 1);
	assert.equal(notifications, 2);

	unsubscribe();
	tracker.startTurn();
	assert.equal(notifications, 2, "unsubscribed listener is not called");
});

test("a throwing subscriber cannot break the tracker", () => {
	const tracker = new SkillTracker();
	tracker.subscribe(() => {
		throw new Error("listener boom");
	});
	assert.doesNotThrow(() => tracker.startTurn());
});

test("onToolEnd stamps a duration on the last action", () => {
	const tracker = new SkillTracker();
	tracker.onToolStart("bash", { command: "npm test" });
	tracker.onToolEnd("bash");
	const action = tracker.getState().actions.at(-1);
	assert.ok(action);
	assert.equal(typeof action.durationMs, "number");
});
