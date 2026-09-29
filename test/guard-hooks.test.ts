/**
 * Guard hook tests — the pre-execution line-limit gate and the consult gates.
 *
 * These handlers are the only enforcement in the plugin, and until this file
 * existed nothing tested them end to end: `source-gate` and `line-monitor` were
 * unit-tested, the wiring between them was not. The line limit in particular
 * shipped as a `tool_result` annotation, which reports an error for a mutation
 * that has already happened.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { registerGuardHooks } from "../src/hooks/guard-hooks.js";
import type { SkillTracker } from "../src/tracker.js";
import { DEFAULT_CONFIG, type PluginDevConfig } from "../src/types.js";

type Handler = (event: any, ctx?: any) => any;

interface Harness {
	fire(event: string, payload: any): Promise<any>;
	cfg: PluginDevConfig;
}

function harness(
	options: { activeSkill?: string; maxFileLines?: number; enforceSkill?: boolean } = {},
): Harness {
	const handlers = new Map<string, Handler[]>();
	const pi = {
		on(event: string, handler: Handler) {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
			return () => {};
		},
	};
	const cfg: PluginDevConfig = {
		...DEFAULT_CONFIG,
		enforceSkillBeforeEdit: options.enforceSkill ?? false,
		strictAudit: false,
		...(options.maxFileLines ? { maxFileLines: options.maxFileLines } : {}),
	};
	const tracker = {
		getState: () => ({ activeSkill: options.activeSkill ?? "pi-plugin-dev" }),
	} as unknown as SkillTracker;
	registerGuardHooks(pi as any, () => cfg, tracker, () => {});
	return {
		cfg,
		async fire(event, payload) {
			let out: any;
			for (const handler of handlers.get(event) ?? []) {
				const result = await handler(payload);
				if (result !== undefined) out = result;
			}
			return out;
		},
	};
}

function body(lines: number): string {
	return Array.from({ length: lines }, (_, i) => `export const v${i} = ${i};`).join("\n") + "\n";
}

function tmpFile(name: string, lines: number): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "guard-hooks-"));
	const filePath = path.join(dir, name);
	fs.writeFileSync(filePath, body(lines), "utf8");
	return filePath;
}

test("a write that would cross the limit is blocked before it runs", async () => {
	const h = harness();
	const target = path.join(os.tmpdir(), "guard-hooks-new.ts");
	const res = await h.fire("tool_call", {
		type: "tool_call",
		toolCallId: "1",
		toolName: "write",
		input: { path: target, content: body(450) },
	});
	assert.ok(res, "expected the pre-flight gate to block");
	assert.equal(res.block, true);
	assert.match(res.reason, /Line limit exceeded: 450 lines/);
	assert.match(res.reason, /REFUSED BEFORE IT RAN/);
});

test("a write under the limit is not blocked", async () => {
	const h = harness();
	const res = await h.fire("tool_call", {
		type: "tool_call",
		toolCallId: "1",
		toolName: "write",
		input: { path: path.join(os.tmpdir(), "small.ts"), content: body(10) },
	});
	assert.equal(res, undefined);
});

test("an edit that grows a file past the limit is blocked", async () => {
	const h = harness();
	const target = tmpFile("grow.ts", 395);
	const res = await h.fire("tool_call", {
		type: "tool_call",
		toolCallId: "1",
		toolName: "edit",
		input: { path: target, edits: [{ oldText: "v0", newText: body(20) }] },
	});
	assert.ok(res, "expected the projected line count to block the edit");
	assert.equal(res.block, true);
	assert.match(res.reason, /Line limit exceeded/);
});

test("an edit that shrinks an oversized file is allowed", async () => {
	const h = harness();
	const target = tmpFile("shrink.ts", 500);
	const res = await h.fire("tool_call", {
		type: "tool_call",
		toolCallId: "1",
		toolName: "edit",
		input: { path: target, edits: [{ oldText: body(500), newText: body(100) }] },
	});
	assert.equal(res, undefined, "a split must not be blocked by the limit that demands it");
});

test("the projection respects a configured maxFileLines", async () => {
	const h = harness({ maxFileLines: 20 });
	const res = await h.fire("tool_call", {
		type: "tool_call",
		toolCallId: "1",
		toolName: "write",
		input: { path: path.join(os.tmpdir(), "tiny.ts"), content: body(25) },
	});
	assert.ok(res, "expected the configured limit to apply");
	assert.match(res.reason, /limit 20/);
});

test("a non-source target is left alone", async () => {
	const h = harness();
	const res = await h.fire("tool_call", {
		type: "tool_call",
		toolCallId: "1",
		toolName: "write",
		input: { path: path.join(os.tmpdir(), "notes.md"), content: "x\n".repeat(900) },
	});
	assert.equal(res, undefined);
});

test("an anchor-only editor is not guessed at", async () => {
	const h = harness();
	const res = await h.fire("tool_call", {
		type: "tool_call",
		toolCallId: "1",
		toolName: "insert",
		input: { anchor: "a1", lines: body(900) },
	});
	assert.equal(res, undefined, "an unprojectable result must not fabricate a block");
});

test("the skill gate still blocks when no skill is active", async () => {
	const h = harness({ activeSkill: "", enforceSkill: true });
	const res = await h.fire("tool_call", {
		type: "tool_call",
		toolCallId: "1",
		toolName: "write",
		input: { path: path.join(os.tmpdir(), "x.ts"), content: body(2) },
	});
	assert.ok(res);
	assert.match(res.reason, /SKILL BEFORE EDIT/);
});

test("the post-hoc notice still fires for a file that is already oversized", async () => {
	const h = harness();
	const target = tmpFile("legacy.ts", 500);
	const res = await h.fire("tool_result", {
		type: "tool_result",
		toolCallId: "1",
		toolName: "write",
		input: { path: target, content: "" },
		content: [{ type: "text", text: "wrote file" }],
		isError: false,
	});
	assert.ok(res, "an oversized file on disk must still be reported");
	assert.match(res.content[res.content.length - 1].text, /Line limit exceeded: 500 lines/);
});

test("before_agent_start injects the line-limit guideline", async () => {
	const h = harness();
	const event: any = { systemPromptOptions: { promptGuidelines: [] as string[] } };
	await h.fire("before_agent_start", event);
	assert.equal(event.systemPromptOptions.promptGuidelines.length, 2);
	assert.match(event.systemPromptOptions.promptGuidelines[0], /SOURCE FILE LENGTH LIMIT/);
});
