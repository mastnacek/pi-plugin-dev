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

	const shortPath = path.basename(check.filePath);
	if (check.level === "warn") {
		return [
			"",
			"---",
			`ℹ️ [Line length advisory] '${shortPath}' has ${check.lines} lines.`,
			`Soft target: ${check.warnLines} lines, hard limit: ${check.maxLines}.`,
			"Plan a logical split soon — the file will be rejected once it crosses the hard limit.",
			"—",
		].join("\n");
	}

	return [
		"",
		"---",
		`🚨 [Line limit exceeded: ${check.lines} lines, limit ${check.maxLines}] '${shortPath}'`,
		"This source file is too long. It must be split before further work.",
		"Mandatory steps for AI:",
		"- Do NOT retry the same oversized file unchanged; it will be rejected again.",
		"- Identify cohesive sections (classes, function groups, constants, types) and",
		"  extract them into new modules in the same folder, importing what remains.",
		"- Keep every resulting file at or below the soft target of",
		`  ${check.warnLines} lines (hard limit ${check.maxLines}).`,
		"- Re-run the edit after the split so the file passes the limit check.",
		"—",
	].join("\n");
}
