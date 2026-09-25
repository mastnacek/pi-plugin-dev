import test from "node:test";
import assert from "node:assert/strict";
import { isDelegatedSession } from "../src/subagent-guard.js";

test("isDelegatedSession detects PI_SUBAGENT and PI_CHILD_SESSION", () => {
	const origSub = process.env.PI_SUBAGENT;
	const origChild = process.env.PI_CHILD_SESSION;
	try {
		delete process.env.PI_SUBAGENT;
		delete process.env.PI_CHILD_SESSION;
		assert.equal(isDelegatedSession(), false);

		process.env.PI_SUBAGENT = "true";
		assert.equal(isDelegatedSession(), true);

		delete process.env.PI_SUBAGENT;
		process.env.PI_CHILD_SESSION = "1";
		assert.equal(isDelegatedSession(), true);
	} finally {
		if (origSub !== undefined) process.env.PI_SUBAGENT = origSub;
		else delete process.env.PI_SUBAGENT;
		if (origChild !== undefined) process.env.PI_CHILD_SESSION = origChild;
		else delete process.env.PI_CHILD_SESSION;
	}
});
