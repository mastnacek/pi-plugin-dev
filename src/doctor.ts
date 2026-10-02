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

import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ALL_INVARIANTS, auditCodeContent, findLocalInstallSources } from "./auditor.js";
import {
	locateEnginePackage,
	locateRunningEnginePackage,
	readJson,
	readPackageVersion,
	readText,
} from "./engine-locate.js";
import { checkEngineSource, checkEngineVersion } from "./engine-version.js";

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
	/**
	 * Version of the engine copy the workspace resolves through its own
	 * `node_modules`, when it differs from the engine that is running pi.
	 * Left undefined when there is only one copy, so the report stays quiet.
	 */
	resolvedEngineVersion?: string;
	/** Newest version published on npm, when the registry was reachable. */
	latestEngineVersion?: string;
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

/** Compare two dotted versions. Returns <0, 0 or >0. Non-numeric parts sort as 0. */
export { compareVersions, fetchLatestEngineVersion } from "./engine-version.js";
export { locateEnginePackage, locateRunningEnginePackage } from "./engine-locate.js";

/** Turn collected facts into the ordered report. Pure. */
export function buildDoctorReport(input: DoctorInput): DoctorReport {
	const items: DoctorItem[] = [];

	if (input.engineVersion) {
		items.push(item("Engine", "info", `@earendil-works/pi-coding-agent ${input.engineVersion}`));
	} else {
		items.push(item("Engine", "warn", "cannot resolve the installed pi-coding-agent package"));
	}

	// The pin-to-latest rule (SKILL.md §0) is only enforceable if the gap between
	// what is installed and what npm publishes is visible at all.
	const version = checkEngineVersion({
		installed: input.engineVersion,
		latest: input.latestEngineVersion,
	});
	items.push(item("Engine latest", version.status, version.details));

	// A second engine copy in the workspace is the failure mode §0 warns about:
	// `tsc` validates against it while a different version executes.
	const source = checkEngineSource({
		running: input.engineVersion,
		resolved: input.resolvedEngineVersion,
	});
	items.push(item("Engine source", source.status, source.details));

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
export function collectDoctorReport(
	pluginRoot: string,
	options: { latestEngineVersion?: string } = {},
): DoctorReport {
	let engineVersion: string | undefined;
	let resolvedEngineVersion: string | undefined;
	let engineDocsDir: string | undefined;
	let changelogHead: string[] | undefined;

	try {
		// Prefer the engine that is actually running: it is the one whose API
		// every `pi.on()` call and every `ctx.*` field must satisfy.
		const runningRoot = locateRunningEnginePackage();
		const resolvedRoot = locateEnginePackage(pluginRoot);
		const packageRoot = runningRoot ?? resolvedRoot;
		if (packageRoot) {
			engineVersion = readPackageVersion(packageRoot);
			const docs = join(packageRoot, "docs");
			engineDocsDir = docs;
			const changelog = readText(join(packageRoot, "CHANGELOG.md"));
			changelogHead = changelog?.split(/\r?\n/).slice(0, 8);
		}
		// Only surface the workspace copy when it really is a second one, so a
		// single-copy setup does not get a noisy comparison row.
		if (runningRoot && resolvedRoot && runningRoot !== resolvedRoot) {
			resolvedEngineVersion = readPackageVersion(resolvedRoot);
		}
	} catch {
		// Leave undefined; buildDoctorReport reports the warning.
	}

	const settings = readJson(join(homedir(), ".pi", "agent", "settings.json"));

	return buildDoctorReport({
		pluginRoot,
		engineVersion,
		resolvedEngineVersion,
		latestEngineVersion: options.latestEngineVersion,
		engineDocsDir,
		changelogHead,
		settingsPackages: settings?.packages,
		skillManifest: readText(join(pluginRoot, "skills", "pi-plugin-dev", "SKILL.md")),
		auditFiles: collectSourceFiles(pluginRoot),
	});
}
