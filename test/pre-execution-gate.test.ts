import test from "node:test";
import assert from "node:assert/strict";
import { checkPreExecutionInvariants } from "../src/pre-execution-gate.js";

test("pre-execution gate blocks on Type.Union string enums", () => {
	const code = `
		import { Type } from "typebox";
		const schema = Type.Object({
			mode: Type.Union([Type.Literal("a"), Type.Literal("b")]),
		});
	`;
	const res = checkPreExecutionInvariants("src/my-tool.ts", code);
	assert.equal(res.block, true);
	assert.match(res.reason ?? "", /StringEnum Rule/);
});

test("pre-execution gate blocks on core packages in dependencies of package.json", () => {
	const pkg = JSON.stringify({
		name: "bad-plugin",
		dependencies: {
			"@earendil-works/pi-ai": "^0.87.0",
		},
	});
	const res = checkPreExecutionInvariants("package.json", pkg);
	assert.equal(res.block, true);
	assert.match(res.reason ?? "", /Manifest Isolation/);
});

test("pre-execution gate blocks on autocomplete marker in item.value", () => {
	const code = `
		return [{ value: "hud on ✓", label: "on", description: "enable" }];
	`;
	const res = checkPreExecutionInvariants("src/completions.ts", code);
	assert.equal(res.block, true);
	assert.match(res.reason ?? "", /Completion Value/);
});

test("pre-execution gate allows clean code", () => {
	const code = `
		import { StringEnum } from "@earendil-works/pi-ai";
		const GoodEnum = StringEnum(["a", "b"] as const);
	`;
	const res = checkPreExecutionInvariants("src/my-tool.ts", code);
	assert.equal(res.block, false);
});
