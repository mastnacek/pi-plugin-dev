/**
 * `checkErrorThrow` — the tool error contract.
 *
 * Engine 0.99.0 gave `AgentToolResult` an optional `isError` field, so
 * `return { isError: true }` is a valid way to report a failure that keeps
 * `details` readable by the UI. These tests pin both halves of that: the valid
 * shape must not warn, and the genuinely wrong `error:` field still must.
 *
 * Split out of `auditor.test.ts`, which was already over the 400-line limit.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { checkErrorThrow } from "../src/tool-auditor.js";

const tool = (body: string): string => `const t = { registerTool() {}, execute() { ${body} } };`;

test("isError:true passes, with or without a nested details object", () => {
	// The documented 0.99.0 idiom. The old `[^}]*` regex stopped at the inner
	// `}` of `details` and never saw `isError` at all, so this shape was silent.
	const withDetails = checkErrorThrow(
		"t.ts",
		tool('return { content: [{ type: "text", text: "nope" }], details: { query: q, scanned: 412 }, isError: true };'),
	);
	assert.equal(withDetails[0]?.status, "pass");
	assert.match(withDetails[0]?.details ?? "", /0\.99\.0/);

	// Bare `isError` with no nested object used to raise a false WARN.
	assert.equal(checkErrorThrow("t.ts", tool("return { content: [], isError: true };"))[0]?.status, "pass");

	// A brace inside a string literal must not end the scan early.
	assert.equal(
		checkErrorThrow("t.ts", tool('return { content: [{ type: "text", text: "}" }], isError: true };'))[0]?.status,
		"pass",
	);
});

test("`error:` field still warns, throw still passes", () => {
	// `error:` is not on AgentToolResult, so the model reads the call as a success.
	const bad = checkErrorThrow("t.ts", tool('return { content: [], error: "boom" };'));
	assert.equal(bad[0]?.status, "warn");
	assert.match(bad[0]?.details ?? "", /not a tool result field/);

	assert.equal(checkErrorThrow("t.ts", tool('throw new Error("boom");'))[0]?.status, "pass");

	// `throw` keeps precedence when both appear, matching the previous behaviour.
	const both = checkErrorThrow(
		"t.ts",
		tool('if (!q) return { content: [], error: "x" }; throw new Error("y");'),
	);
	assert.equal(both[0]?.status, "pass");

	// Not a tool file: no check emitted at all.
	assert.deepEqual(checkErrorThrow("t.ts", "export const x = 1;"), []);
});
