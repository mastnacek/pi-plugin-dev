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
import { checkFileLines, countLines, formatLineLimitCheck, formatLineLimitBlock, projectResultingLines } from "../src/line-monitor.js";

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

test("projectResultingLines projects a write exactly", () => {
	const target = path.join(os.tmpdir(), "projected.ts");
	const p = projectResultingLines(target, "write", { content: "a\nb\nc\n" }, 400);
	assert.equal(p.known, true);
	assert.equal(p.lines, 3);
	assert.equal(p.level, "ok");
	assert.equal(formatLineLimitBlock(p, target), null);
});

test("projectResultingLines applies edit[] to the file on disk", () => {
	const filePath = tmpFile("edit-me.ts", 390);
	const p = projectResultingLines(
		filePath,
		"edit",
		{ edits: [{ oldText: "line 0", newText: "line 0\nline x" }] },
		400,
	);
	assert.equal(p.known, true);
	assert.equal(p.lines, 391);
	assert.equal(p.level, "warn");
});

test("projectResultingLines reports exceeded for a projected oversize", () => {
	const target = path.join(os.tmpdir(), "projected-big.ts");
	const p = projectResultingLines(target, "write", { content: "x\n".repeat(450) }, 400);
	assert.equal(p.level, "exceeded");
	const reason = formatLineLimitBlock(p, target);
	assert.ok(reason?.includes("Line limit exceeded: 450 lines, limit 400"));
	assert.ok(reason?.includes("REFUSED BEFORE IT RAN"));
});

test("projectResultingLines refuses to guess for an anchor-only tool", () => {
	const target = path.join(os.tmpdir(), "anchor.ts");
	const p = projectResultingLines(target, "insert", { anchor: "a1", lines: "x\n".repeat(900) }, 400);
	assert.equal(p.known, false);
	assert.equal(formatLineLimitBlock(p, target), null);
});

test("projectResultingLines is unknown for an edit of a missing file", () => {
	const target = path.join(os.tmpdir(), "does-not-exist.ts");
	const p = projectResultingLines(target, "edit", { edits: [{ oldText: "a", newText: "b" }] }, 400);
	assert.equal(p.known, false);
});

test("projectResultingLines skips non-source and exempt targets", () => {
	const md = projectResultingLines(path.join(os.tmpdir(), "a.md"), "write", { content: "x\n".repeat(900) }, 400);
	assert.equal(md.known, false);
	const dep = projectResultingLines(
		path.join(os.tmpdir(), "node_modules", "dep.ts"),
		"write",
		{ content: "x\n".repeat(900) },
		400,
	);
	assert.equal(dep.known, false);
});
