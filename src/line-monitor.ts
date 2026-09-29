import fs from "node:fs";
import path from "node:path";

/**
 * Per-file line limit monitoring (AGENTS §"Skill Before Edit" companion).
 *
 * Modeled on pi-lotusscript-modular's `maxProcedureLines` enforcement, but at
 * file granularity: source files edited via `edit`/`write` are counted and the
 * tool result is rejected (`isError: true`) when the hard limit is exceeded,
 * forcing the agent to split the file logically instead of letting it grow.
 *
 * Defaults: hard cap 400 lines (a file holds multiple procedures + imports +
 * types, so the per-file cap sits above lotusscript's 300 per-procedure cap),
 * soft advisory at 75 % of the cap.
 */

export const DEFAULT_MAX_FILE_LINES = 400;
export const WARN_RATIO = 0.75;

/** Extensions monitored as source code. Docs, configs and data are exempt. */
const SOURCE_EXTENSIONS = new Set([
	".ts",
	".tsx",
	".mts",
	".cts",
	".js",
	".jsx",
	".mjs",
	".cjs",
	".rs",
	".go",
	".py",
	".sh",
	".bash",
	".ps1",
	".css",
	".scss",
	".html",
	".sql",
	".java",
	".kt",
	".cs",
	".c",
	".h",
	".cpp",
]);

/** Path segments that mark generated, vendored or dependency code. */
const EXEMPT_SEGMENTS = new Set([
	"node_modules",
	"dist",
	"build",
	"out",
	"coverage",
	"target",
	"vendor",
	".git",
	".next",
	"__pycache__",
	".venv",
	"test-results",
]);

/** Lockfiles and generated manifests, regardless of extension matching. */
const EXEMPT_FILES = new Set([
	"package-lock.json",
	"bun.lock",
	"yarn.lock",
	"pnpm-lock.yaml",
	"npm-shrinkwrap.json",
]);

export type LineLimitLevel = "ok" | "warn" | "exceeded";

export interface FileLineCheck {
	filePath: string;
	/** False when the file was skipped (not monitored source, missing, exempt). */
	checked: boolean;
	lines: number;
	maxLines: number;
	warnLines: number;
	level: LineLimitLevel;
}

/** True when the file sits under an exempt directory (deps, build output…). */
function isExemptPath(resolved: string): boolean {
	const base = path.basename(resolved).toLowerCase();
	if (EXEMPT_FILES.has(base)) return true;
	for (const segment of resolved.split(/[\\/]/)) {
		if (EXEMPT_SEGMENTS.has(segment.toLowerCase())) return true;
	}
	return false;
}

/**
 * True when the path is a monitored source file (allowlisted extension, not
 * under an exempt directory). Used by the consult gates so docs and data
 * stay ungated.
 */
export function isMonitoredSourcePath(resolvedPath: string): boolean {
	const ext = path.extname(resolvedPath).toLowerCase();
	if (!SOURCE_EXTENSIONS.has(ext)) return false;
	return !isExemptPath(resolvedPath);
}

/** Counts physical lines; a single trailing newline does not create a line. */
export function countLines(content: string): number {
	if (content.length === 0) return 0;
	const lines = content.split(/\r\n|\r|\n/);
	if (lines[lines.length - 1] === "") lines.pop();
	return lines.length;
}

/**
 * Checks the line count of one file against the per-file limit.
 * Returns `checked: false` for anything that is not monitored source code.
 */
export function checkFileLines(
	filePath: string,
	maxLines = DEFAULT_MAX_FILE_LINES,
): FileLineCheck {
	const warnLines = Math.max(1, Math.floor(maxLines * WARN_RATIO));
	const result: FileLineCheck = {
		filePath,
		checked: false,
		lines: 0,
		maxLines,
		warnLines,
		level: "ok",
	};

	const ext = path.extname(filePath).toLowerCase();
	if (!SOURCE_EXTENSIONS.has(ext)) return result;
	if (isExemptPath(path.resolve(filePath))) return result;
	if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return result;

	try {
		result.lines = countLines(fs.readFileSync(filePath, "utf8"));
	} catch {
		return result;
	}

	result.checked = true;
	if (result.lines > maxLines) result.level = "exceeded";
	else if (result.lines >= warnLines) result.level = "warn";
	return result;
}

/**
 * Renders the tool-result notice for a check. Returns `null` when nothing
 * should be appended (unchecked file or `ok` level).
 */
export function formatLineLimitCheck(check: FileLineCheck): string | null {
	if (!check.checked || check.level === "ok") return null;
	if (check.level === "warn") {
		return [
			"",
			"---",
			`ℹ️ [Line length advisory] '${path.basename(check.filePath)}' has ${check.lines} lines.`,
			`Soft target: ${check.warnLines} lines, hard limit: ${check.maxLines}.`,
			"Plan a logical split soon — the file will be rejected once it crosses the hard limit.",
			"—",
		].join("\n");
	}

	return [
		"",
		"---",
		`🚨 [Line limit exceeded: ${check.lines} lines, limit ${check.maxLines}] '${path.basename(check.filePath)}'`,
		"This source file is too long. It must be split before further work.",
		"Mandatory steps for AI:",
		...splitInstructions(check.warnLines, check.maxLines),
		"- Re-run the edit after the split so the file passes the limit check.",
		"—",
	].join("\n");
}

/** The split recipe, shared by the post-hoc notice and the pre-flight rejection. */
function splitInstructions(warnLines: number, maxLines: number): string[] {
	return [
		"- Do NOT retry the same oversized file unchanged; it will be rejected again.",
		"- Identify cohesive sections (classes, function groups, constants, types) and",
		"  extract them into new modules in the same folder, importing what remains.",
		"- Keep every resulting file at or below the soft target of",
		`  ${warnLines} lines (hard limit ${maxLines}).`,
	];
}

/**
 * Pre-flight rejection reason for a call that would push the file over the
 * limit. Distinct wording from the post-hoc notice: nothing was written, so
 * the agent must not go looking for a mutation that never happened.
 */
export function formatLineLimitBlock(
	projection: LineProjection,
	filePath: string,
): string | null {
	if (!projection.known || projection.level !== "exceeded") return null;
	const warnLines = Math.max(1, Math.floor(projection.maxLines * WARN_RATIO));
	return [
		`🚨 [Line limit exceeded: ${projection.lines} lines, limit ${projection.maxLines}] '${path.basename(filePath)}'`,
		"This write was REFUSED BEFORE IT RAN — nothing was written to disk.",
		"Mandatory steps for AI:",
		...splitInstructions(warnLines, projection.maxLines),
		`- Re-run the call once '${path.basename(filePath)}' is at or below ${warnLines} lines.`,
	].join("\n");
}

/** The projected post-mutation line count of a monitored source file. */
export interface LineProjection {
	/** False when the result cannot be projected (anchor-only editor, unreadable file). */
	known: boolean;
	lines: number;
	maxLines: number;
	level: LineLimitLevel;
}

/**
 * Projects the line count the file WILL have once the call succeeds, so the
 * limit can be enforced before the mutation instead of after it.
 *
 * `write` carries the entire new content, so the projection is exact. `edit`
 * carries `edits[]`, all matched against the ORIGINAL file, so they are applied
 * to the file on disk in order. An anchor-only editor (`insert`) names no file
 * and keeps its registry in memory, so its result cannot be projected — reported
 * as `known: false` rather than guessed, and left to the `tool_result` check.
 */
export function projectResultingLines(
	resolvedPath: string,
	toolName: string,
	input: Record<string, unknown>,
	maxLines = DEFAULT_MAX_FILE_LINES,
): LineProjection {
	const warnLines = Math.max(1, Math.floor(maxLines * WARN_RATIO));
	const projection: LineProjection = { known: false, lines: 0, maxLines, level: "ok" };
	if (!isMonitoredSourcePath(resolvedPath)) return projection;

	const base = baseToolName(toolName);
	let projected: string | null = null;

	if (base === "write" && typeof input.content === "string") {
		projected = input.content;
	} else if (base === "edit" && Array.isArray(input.edits)) {
		const current = readText(resolvedPath);
		if (current === null) return projection;
		projected = current;
		for (const edit of input.edits as Array<{ oldText?: unknown; newText?: unknown }>) {
			if (typeof edit?.oldText !== "string" || typeof edit?.newText !== "string") continue;
			// Disjoint edits are guaranteed by the tool contract, so a plain
			// literal replace reproduces the result the edit tool will produce.
			projected = projected.split(edit.oldText).join(edit.newText);
		}
	}

	if (projected === null) return projection;

	projection.known = true;
	projection.lines = countLines(projected);
	if (projection.lines > maxLines) projection.level = "exceeded";
	else if (projection.lines >= warnLines) projection.level = "warn";
	return projection;
}

function readText(filePath: string): string | null {
	try {
		if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return null;
		return fs.readFileSync(filePath, "utf8");
	} catch {
		return null;
	}
}

function baseToolName(raw: string): string {
	return raw.includes("__") ? raw.split("__").pop()! : raw;
}
