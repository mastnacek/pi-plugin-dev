/**
 * `/plugin-dev doctor` — preflight for the plugin-authoring setup itself.
 *
 * Answers the four questions that keep going wrong by hand:
 *   1. Which engine version and docs directory am I actually coding against?
 *   2. Are any packages installed from a local path (AGENTS §8)?
 *   3. Does the shipped SKILL.md still have valid frontmatter?
 *   4. Does this package pass its own auditor?
 *
 * `buildDoctorReport()` is pure (facts in, report out) and
 * `collectDoctorReport()` is the thin filesystem wrapper, so the report shape
 * and wording are unit-tested without touching the real home directory.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { ALL_INVARIANTS, auditCodeContent, findLocalInstallSources } from "./auditor.js";

export type DoctorStatus = "pass" | "warn" | "fail" | "info";

export interface DoctorItem {
	label: string;
	status: DoctorStatus;
	details: string;
}

export interface DoctorReport {
	pluginRoot: string;
	generatedAt: number;
	items: DoctorItem[];
}

export interface DoctorInput {
	pluginRoot: string;
	engineVersion?: string;
	engineDocsDir?: string;
	changelogHead?: string[];
	settingsPackages?: unknown;
	skillManifest?: string;
	auditFiles?: Array<{ path: string; content: string }>;
}

const STATUS_ICON: Record<DoctorStatus, string> = {
	pass: "✓",
	warn: "!",
	fail: "✗",
	info: "•",
};

function item(label: string, status: DoctorStatus, details: string): DoctorItem {
	return { label, status, details };
}

/** YAML frontmatter with a non-empty `name:` and `description:`. */
export function checkSkillFrontmatter(markdown: string): { ok: boolean; details: string } {
	const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
	if (!match) return { ok: false, details: "SKILL.md has no YAML frontmatter block" };
	const body = match[1] ?? "";
	const hasName = /^name:\s*\S+/m.test(body);
	const hasDescription = /^description:\s*\S+/m.test(body);
	if (hasName && hasDescription) return { ok: true, details: "name + description present" };
	const missing = [!hasName && "name", !hasDescription && "description"].filter(Boolean).join(", ");
	return { ok: false, details: `frontmatter missing: ${missing}` };
}

/** Turn collected facts into the ordered report. Pure. */
export function buildDoctorReport(input: DoctorInput): DoctorReport {
	const items: DoctorItem[] = [];

	if (input.engineVersion) {
		items.push(item("Engine", "info", `@earendil-works/pi-coding-agent ${input.engineVersion}`));
	} else {
		items.push(item("Engine", "warn", "cannot resolve the installed pi-coding-agent package"));
	}

	if (input.engineDocsDir && existsSync(input.engineDocsDir)) {
		items.push(item("Engine docs", "pass", input.engineDocsDir));
	} else if (input.engineDocsDir) {
		items.push(item("Engine docs", "warn", `docs directory not found: ${input.engineDocsDir}`));
	} else {
		items.push(item("Engine docs", "warn", "unresolved — check the engine install"));
	}

	const head = (input.changelogHead ?? []).map((line) => line.trim()).filter(Boolean).slice(0, 3);
	if (head.length > 0) {
		items.push(item("Changelog head", "info", head.join(" | ")));
	}

	if (input.settingsPackages === undefined) {
		items.push(item("Install sources", "warn", "settings.json not readable"));
	} else {
		const locals = findLocalInstallSources(input.settingsPackages);
		const count = Array.isArray(input.settingsPackages) ? input.settingsPackages.length : 0;
		if (locals.length > 0) {
			items.push(
				item(
					"Install sources",
					"fail",
					`${locals.length}/${count} local-path install(s): ${locals.join(", ")} — switch to git:github.com/… (AGENTS §8)`,
				),
			);
		} else {
			items.push(item("Install sources", "pass", `${count} package(s), all npm/git/URL`));
		}
	}

	if (input.skillManifest === undefined) {
		items.push(item("Skill manifest", "warn", "shipped SKILL.md not found"));
	} else {
		const front = checkSkillFrontmatter(input.skillManifest);
		items.push(item("Skill manifest", front.ok ? "pass" : "fail", front.details));
	}

	const files = input.auditFiles ?? [];
	if (files.length === 0) {
		items.push(item("Self-audit", "info", "no source files to audit"));
	} else {
		const checks = files.flatMap((file) => auditCodeContent(file.path, file.content, ALL_INVARIANTS));
		const fails = checks.filter((c) => c.status === "fail");
		const warns = checks.filter((c) => c.status === "warn");
		if (fails.length > 0) {
			items.push(
				item(
					"Self-audit",
					"fail",
					`${fails.length} fail, ${warns.length} warn over ${files.length} file(s): ${fails
						.map((c) => c.label)
						.join(", ")}`,
				),
			);
		} else if (warns.length > 0) {
			items.push(
				item(
					"Self-audit",
					"warn",
					`${warns.length} warn over ${files.length} file(s): ${warns.map((c) => c.label).join(", ")}`,
				),
			);
		} else {
			items.push(item("Self-audit", "pass", `${files.length} file(s), no findings`));
		}
	}

	return { pluginRoot: input.pluginRoot, generatedAt: Date.now(), items };
}

export function formatDoctorReport(report: DoctorReport): string {
	const lines = ["🩺 [pi-plugin-dev — doctor]", `- root: ${report.pluginRoot}`, ""];
	for (const entry of report.items) {
		lines.push(`  ${STATUS_ICON[entry.status]} ${entry.label}: ${entry.details}`);
	}
	return lines.join("\n");
}

// ------------------------------------------------------------- collection

/** Walk up from a directory until the package.json with `name` is found. */
function findPackageRootUp(startDir: string, packageName: string): string | undefined {
	let dir = startDir;
	for (let i = 0; i < 12; i += 1) {
		const parsed = readJson(join(dir, "package.json"));
		if (parsed?.name === packageName) return dir;
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return undefined;
}

/** Treat a path that exists and is a directory as the start, else its parent. */
function toStartDir(pathOrDir: string): string {
	try {
		if (statSync(pathOrDir).isDirectory()) return pathOrDir;
	} catch {
		// Not a real path: fall through to dirname.
	}
	return dirname(pathOrDir);
}

/**
 * Node-style resolution: check `<dir>/node_modules/<pkg>` on every ancestor.
 *
 * Required because the engine's `exports` map has no `.` entry, so
 * `require.resolve("@earendil-works/pi-coding-agent")` throws
 * ERR_PACKAGE_PATH_NOT_EXPORTED even though the package is installed.
 */
function findInNodeModules(startDir: string, packageName: string): string | undefined {
	let dir = startDir;
	for (;;) {
		const candidate = join(dir, "node_modules", packageName);
		const parsed = readJson(join(candidate, "package.json"));
		if (parsed?.name === packageName) return candidate;
		const parent = dirname(dir);
		if (parent === dir) return undefined;
		dir = parent;
	}
}

/**
 * Locate the installed engine package, preferring a copy that ships `docs/`.
 *
 * Candidates in order: the module resolver, the plugin root, the process cwd
 * and the running CLI entry (which lives inside the engine's own install tree
 * when Pi launched us).
 */
export function locateEnginePackage(pluginRoot: string): string | undefined {
	const name = "@earendil-works/pi-coding-agent";

	// Pi can point us at its own package directory (useful under store paths).
	const pinned = process.env.PI_PACKAGE_DIR;
	if (pinned) {
		const root = findPackageRootUp(toStartDir(pinned), name) ?? findInNodeModules(pinned, name);
		if (root) return root;
	}

	try {
		const require = createRequire(import.meta.url);
		for (const spec of [name, `${name}/package.json`]) {
			try {
				const root = findPackageRootUp(toStartDir(require.resolve(spec)), name);
				if (root) return root;
			} catch {
				// exports may block this specifier; try the next one.
			}
		}
	} catch {
		// createRequire unavailable (non-Node host); fall through to the walk.
	}

	const seeds = [pluginRoot, process.cwd(), ...(process.argv[1] ? [process.argv[1]] : [])];
	let fallback: string | undefined;
	for (const seed of seeds) {
		const root = findInNodeModules(toStartDir(seed), name);
		if (root === undefined) continue;
		if (existsSync(join(root, "docs"))) return root;
		fallback ??= root;
	}
	return fallback;
}

/** Parsed JSON object, or undefined when the file is missing or malformed. */
type JsonObject = Record<string, unknown>;

function readJson(path: string): JsonObject | undefined {
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as JsonObject;
		}
		return undefined;
	} catch {
		return undefined;
	}
}

function readText(path: string): string | undefined {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return undefined;
	}
}

/** Collect `index.ts` plus every `.ts` under `src/`. */
function collectSourceFiles(root: string): Array<{ path: string; content: string }> {
	const files: Array<{ path: string; content: string }> = [];
	const push = (absolute: string): void => {
		const content = readText(absolute);
		if (content !== undefined) files.push({ path: absolute, content });
	};
	push(join(root, "index.ts"));
	// The manifest is audited too: type/module, peerDependencies, pi manifest,
	// publish files, test script and install sources all live there.
	push(join(root, "package.json"));
	const walk = (dir: string): void => {
		let entries: Array<{ name: string; isDirectory: () => boolean }>;
		try {
			entries = readdirSync(dir, { withFileTypes: true }) as Array<{
				name: string;
				isDirectory: () => boolean;
			}>;
		} catch {
			return;
		}
		for (const entry of entries) {
			const absolute = join(dir, entry.name);
			if (entry.isDirectory()) {
				if (entry.name === "node_modules" || entry.name === "dist") continue;
				walk(absolute);
			} else if (entry.name.endsWith(".ts")) {
				push(absolute);
			}
		}
	};
	walk(join(root, "src"));
	return files;
}

/** Read the facts from disk and build the report. */
export function collectDoctorReport(pluginRoot: string): DoctorReport {
	let engineVersion: string | undefined;
	let engineDocsDir: string | undefined;
	let changelogHead: string[] | undefined;

	try {
		const packageRoot = locateEnginePackage(pluginRoot);
		if (packageRoot) {
			const pkg = readJson(join(packageRoot, "package.json"));
			engineVersion = typeof pkg?.version === "string" ? pkg.version : undefined;
			const docs = join(packageRoot, "docs");
			engineDocsDir = docs;
			const changelog = readText(join(packageRoot, "CHANGELOG.md"));
			changelogHead = changelog?.split(/\r?\n/).slice(0, 8);
		}
	} catch {
		// Leave undefined; buildDoctorReport reports the warning.
	}

	const settings = readJson(join(homedir(), ".pi", "agent", "settings.json"));

	return buildDoctorReport({
		pluginRoot,
		engineVersion,
		engineDocsDir,
		changelogHead,
		settingsPackages: settings?.packages,
		skillManifest: readText(join(pluginRoot, "skills", "pi-plugin-dev", "SKILL.md")),
		auditFiles: collectSourceFiles(pluginRoot),
	});
}
