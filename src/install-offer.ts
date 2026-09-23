/**
 * Install-offer detection: after the agent commits and pushes a Pi plugin to
 * GitHub, offer to install it as a package (`pi install git:github.com/o/r`).
 *
 * Why this needs care:
 *   - the `bash` tool receives only `{ command, timeout }` — no `cwd` — so the
 *     plugin directory must be recovered from the command (`git -C <dir>`,
 *     `cd <dir>`) and falls back to the session cwd;
 *   - a push alone is not enough evidence: pushing somebody else's commits must
 *     not trigger an install offer, so a commit for the same checkout is
 *     required within the session (tracked by the caller);
 *   - only Pi packages are offered (package.json with the `pi-package` keyword
 *     or a `pi` manifest) and only when the repository is not already in the
 *     personal or project settings.
 *
 * Everything here is a pure function of (command, filesystem, settings) so it
 * is unit-testable without Pi running (see `test/install-offer.test.ts`).
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export interface GitHubRepo {
	owner: string;
	repo: string;
}

export interface PluginCandidate {
	/** Absolute path to the plugin checkout. */
	dir: string;
	/** `name` from package.json, for the dialog. */
	name: string;
	/** `git:github.com/<owner>/<repo>` — the installable source. */
	source: string;
	/** `<owner>/<repo>` lower-cased, for installed checks. */
	repoKey: string;
}

export type InstallScope = "global" | "project";

// --------------------------------------------------------------- command parsing

/** `git commit` anywhere in the command line. */
export function isGitCommitCommand(command: string): boolean {
	return /\bgit\b[^\n;&|]*\bcommit\b/.test(command);
}

/** `git push` anywhere in the command line. */
export function isGitPushCommand(command: string): boolean {
	return /\bgit\b[^\n;&|]*\bpush\b/.test(command);
}

function unquote(match: RegExpExecArray): string | undefined {
	return match[1] ?? match[2] ?? match[3];
}

function lastMatch(command: string, pattern: RegExp): { index: number; value: string } | undefined {
	let last: { index: number; value: string } | undefined;
	for (let m = pattern.exec(command); m !== null; m = pattern.exec(command)) {
		const value = unquote(m);
		if (value) last = { index: m.index, value };
	}
	return last;
}

const GIT_C_PATTERN = /(?:^|[\s&|;(])git\s+-C\s+(?:"([^"]+)"|'([^']+)'|([^\s&|;]+))/g;
const CD_PATTERN = /(?:^|[\s&|;(])cd\s+(?:\/d\s+)?(?:"([^"]+)"|'([^']+)'|([^\s&|;]+))/gi;

/**
 * The last explicit directory in a shell line: `git -C <dir>` or `cd <dir>`
 * (including cmd's `cd /d <dir>`). Returns undefined when the command relies on
 * the working directory.
 */
export function extractCommandDir(command: string): string | undefined {
	const gitC = lastMatch(command, GIT_C_PATTERN);
	const cd = lastMatch(command, CD_PATTERN);
	if (!gitC) return cd?.value;
	if (!cd) return gitC.value;
	return gitC.index > cd.index ? gitC.value : cd.value;
}

/** Absolute checkout directory the command operates on. */
export function resolveCandidateDir(command: string, sessionCwd: string): string {
	const gitC = lastMatch(command, GIT_C_PATTERN);
	const cd = lastMatch(command, CD_PATTERN);
	const cdBase = cd ? (isAbsolute(cd.value) ? cd.value : resolve(sessionCwd, cd.value)) : sessionCwd;
	// `git -C <relative>` resolves against the `cd` that precedes it, not the cwd.
	if (gitC && (!cd || gitC.index > cd.index)) {
		return isAbsolute(gitC.value) ? gitC.value : resolve(cdBase, gitC.value);
	}
	return cdBase;
}

// --------------------------------------------------------------- git / github

/** Parse a GitHub remote URL into owner/repo. Handles https, git+https, ssh and scp forms. */
export function parseGitHubRepo(url: string): GitHubRepo | undefined {
	const trimmed = url.trim().replace(/\.git$/i, "");
	const patterns = [
		/^git\+https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)$/i,
		/^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)$/i,
		/^git@github\.com:([^/\s]+)\/([^/\s]+)$/i,
		/^ssh:\/\/git@github\.com\/([^/\s]+)\/([^/\s]+)$/i,
	];
	for (const pattern of patterns) {
		const match = pattern.exec(trimmed);
		if (match?.[1] && match[2]) return { owner: match[1], repo: match[2] };
	}
	return undefined;
}

/** Installable source string for a GitHub repo. */
export function toInstallSource(repo: GitHubRepo): string {
	return `git:github.com/${repo.owner}/${repo.repo}`;
}

export function repoKeyOf(repo: GitHubRepo): string {
	return `${repo.owner}/${repo.repo}`.toLowerCase();
}

/** Read `[remote "origin"] url` from a checkout, supporting a `.git` file (worktrees). */
export function readOriginUrl(dir: string): string | undefined {
	const dotGit = join(dir, ".git");
	if (!existsSync(dotGit)) return undefined;

	let configPath: string | undefined;
	try {
		if (statSync(dotGit).isDirectory()) {
			configPath = join(dotGit, "config");
		} else {
			const pointer = readFileSync(dotGit, "utf8");
			const match = /^gitdir:\s*(.+)$/m.exec(pointer);
			if (match?.[1]) configPath = join(resolve(dir, match[1].trim()), "config");
		}
	} catch {
		return undefined;
	}
	if (configPath === undefined) return undefined;

	let config: string;
	try {
		config = readFileSync(configPath, "utf8");
	} catch {
		return undefined;
	}

	const section = /\[remote\s+"origin"\]([\s\S]*?)(?:\n\[|$)/.exec(config);
	if (!section?.[1]) return undefined;
	const url = /^\s*url\s*=\s*(.+)$/m.exec(section[1]);
	return url?.[1]?.trim();
}

// --------------------------------------------------------------- package.json

interface PackageManifest {
	name?: unknown;
	keywords?: unknown;
	pi?: unknown;
}

/** `pi-package` keyword or a `pi` manifest with extension/skill paths. */
export function isPiPackageManifest(manifest: PackageManifest): boolean {
	const keywords = Array.isArray(manifest.keywords) ? manifest.keywords : [];
	if (keywords.some((keyword) => keyword === "pi-package")) return true;
	return manifest.pi !== undefined && manifest.pi !== null && typeof manifest.pi === "object";
}

function readManifest(dir: string): PackageManifest | undefined {
	try {
		const parsed: unknown = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
		if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as PackageManifest;
		}
		return undefined;
	} catch {
		return undefined;
	}
}

/**
 * A plugin checkout is a directory that looks pushed and installable: a Pi
 * package manifest plus a GitHub `origin` remote.
 */
export function findPluginCandidate(command: string, sessionCwd: string): PluginCandidate | undefined {
	const dir = resolveCandidateDir(command, sessionCwd);
	if (!existsSync(dir)) return undefined;

	const manifest = readManifest(dir);
	if (manifest === undefined || !isPiPackageManifest(manifest)) return undefined;

	const origin = readOriginUrl(dir);
	if (origin === undefined) return undefined;
	const repo = parseGitHubRepo(origin);
	if (repo === undefined) return undefined;

	return {
		dir,
		name: typeof manifest.name === "string" && manifest.name.length > 0 ? manifest.name : repo.repo,
		source: toInstallSource(repo),
		repoKey: repoKeyOf(repo),
	};
}

// --------------------------------------------------------------- settings

/** Settings files that can declare packages, personal first. */
export function settingsPaths(sessionCwd?: string): string[] {
	const paths = [join(homedir(), ".pi", "agent", "settings.json")];
	if (sessionCwd) paths.push(join(sessionCwd, ".pi", "settings.json"));
	return paths;
}

function readJsonObject(path: string): Record<string, unknown> | undefined {
	try {
		const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
		return undefined;
	} catch {
		return undefined;
	}
}

/** Merged `packages` arrays from the given settings files. */
export function readSettingsPackages(paths: readonly string[]): unknown[] {
	const packages: unknown[] = [];
	for (const path of paths) {
		const parsed = readJsonObject(path);
		if (parsed && Array.isArray(parsed.packages)) packages.push(...parsed.packages);
	}
	return packages;
}

/** Repository key of every GitHub package already declared in settings. */
export function installedRepoKeys(packages: unknown): Set<string> {
	const keys = new Set<string>();
	if (!Array.isArray(packages)) return keys;
	for (const entry of packages) {
		const source =
			typeof entry === "string"
				? entry
				: entry !== null && typeof entry === "object" && typeof (entry as { source?: unknown }).source === "string"
					? (entry as { source: string }).source
					: undefined;
		if (source === undefined) continue;
		const repo = parseGitHubRepo(source.replace(/^git:/i, "https://"));
		if (repo !== undefined) keys.add(repoKeyOf(repo));
	}
	return keys;
}

// --------------------------------------------------------------- install

export function buildInstallArgs(source: string, scope: InstallScope): string[] {
	return scope === "project" ? ["install", source, "--local"] : ["install", source];
}

export interface InstallResult {
	ok: boolean;
	output: string;
}

/**
 * Run `pi install` in a child process. Async on purpose: a git clone must not
 * freeze the Pi TUI the way `spawnSync` would.
 */
export function runInstallAsync(source: string, scope: InstallScope, cwd: string): Promise<InstallResult> {
	return new Promise((resolveResult) => {
		let out = "";
		let settled = false;
		const finish = (result: InstallResult): void => {
			if (settled) return;
			settled = true;
			resolveResult(result);
		};

		let child;
		try {
			child = spawn("pi", buildInstallArgs(source, scope), {
				cwd,
				shell: process.platform === "win32",
				windowsHide: true,
			});
		} catch (error) {
			finish({ ok: false, output: error instanceof Error ? error.message : String(error) });
			return;
		}

		const collect = (chunk: Buffer | string): void => {
			out += chunk.toString();
		};
		child.stdout?.on("data", collect);
		child.stderr?.on("data", collect);
		child.on("error", (error) => finish({ ok: false, output: error.message }));
		child.on("close", (code) => finish({ ok: code === 0, output: out.trim().slice(-800) }));
	});
}