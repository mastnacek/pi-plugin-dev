/**
 * Line monitor tests — per-file source length checks used by the
 * edit/write tool_result rejection hook (modeled on pi-lotusscript-modular's
 * maxProcedureLines enforcement, at file granularity).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { checkFileLines, countLines, formatLineLimitCheck } from "../src/line-monitor.js";

function tmpFile(name: string, lines: number, content?: string): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "line-monitor-"));
	const filePath = path.join(dir, name);
	const body = content ?? Array.from({ length: lines }, (_, i) => `line ${i}`).join("\n") + "\n";
	fs.writeFileSync(filePath, body, "utf8");
	return filePath;
}

test("countLines counts physical lines without trailing-newline artifact", () => {
	assert.equal(countLines(""), 0);
	assert.equal(countLines("a\nb\n"), 2);
	assert.equal(countLines("a\nb"), 2);
	assert.equal(countLines("a\r\nb\r\n"), 2);
});

test("checkFileLines flags a file over the hard limit as exceeded", () => {
	const filePath = tmpFile("big.ts", 401);
	const check = checkFileLines(filePath, 400);
	assert.equal(check.checked, true);
	assert.equal(check.level, "exceeded");
	const notice = formatLineLimitCheck(check);
	assert.ok(notice?.includes("Line limit exceeded"));
	assert.ok(notice?.includes("Do NOT retry the same oversized file unchanged"));
});

test("checkFileLines warns between the soft target and the hard limit", () => {
	const filePath = tmpFile("medium.ts", 350);
	const check = checkFileLines(filePath, 400);
	assert.equal(check.level, "warn");
	const notice = formatLineLimitCheck(check);
	assert.ok(notice?.includes("advisory"));
});

test("checkFileLines stays silent below the soft target", () => {
	const filePath = tmpFile("small.ts", 100);
	const check = checkFileLines(filePath, 400);
	assert.equal(check.level, "ok");
	assert.equal(formatLineLimitCheck(check), null);
});

test("non-source files are not checked", () => {
	const filePath = tmpFile("notes.md", 900);
	const check = checkFileLines(filePath, 400);
	assert.equal(check.checked, false);
	assert.equal(formatLineLimitCheck(check), null);
});

test("files under node_modules or dist are exempt", () => {
	const nested = path.join(os.tmpdir(), "line-monitor-exempt");
	fs.mkdirSync(path.join(nested, "node_modules"), { recursive: true });
	const filePath = path.join(nested, "node_modules", "dep.ts");
	fs.writeFileSync(filePath, "a\n".repeat(900), "utf8");
	const check = checkFileLines(filePath, 400);
	assert.equal(check.checked, false);
});
