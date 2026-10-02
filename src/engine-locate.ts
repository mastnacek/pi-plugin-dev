/**
 * Engine package location on disk.
 *
 * Split out of `doctor.ts` so that file keeps its own size budget, and kept
 * free of `doctor.ts` imports so the dependency runs one way:
 * doctor → engine-locate → engine-version.
 *
 * Two locations matter and they are not the same fact:
 *   - the engine copy the workspace resolves through its own `node_modules`,
 *     which is what `tsc` type-checks against;
 *   - the engine copy that is actually executing, which is what every
 *     `pi.on()` call and `ctx.*` field must satisfy at runtime.
 * `doctor.ts` compares the two instead of trusting either one.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const ENGINE_PACKAGE = "@earendil-works/pi-coding-agent";

/** Parsed JSON object, or undefined when the file is missing or malformed. */
export type JsonObject = Record<string, unknown>;

export function readJson(path: string): JsonObject | undefined {
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

export function readText(path: string): string | undefined {
	try {
		return readFileSync(path, "utf8");
	} catch {
		return undefined;
	}
}

/** `version` field of a package's `package.json`, when it is a string. */
export function readPackageVersion(packageRoot: string): string | undefined {
	const pkg = readJson(join(packageRoot, "package.json"));
	return typeof pkg?.version === "string" ? pkg.version : undefined;
}

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
 * Locate the engine copy the workspace resolves, preferring one that ships `docs/`.
 *
 * Candidates in order: the module resolver, the plugin root, the process cwd
 * and the running CLI entry (which lives inside the engine's own install tree
 * when Pi launched us).
 */
export function locateEnginePackage(pluginRoot: string): string | undefined {
	// Pi can point us at its own package directory (useful under store paths).
	const pinned = process.env.PI_PACKAGE_DIR;
	if (pinned) {
		const root = findPackageRootUp(toStartDir(pinned), ENGINE_PACKAGE) ?? findInNodeModules(pinned, ENGINE_PACKAGE);
		if (root) return root;
	}

	try {
		const require = createRequire(import.meta.url);
		for (const spec of [ENGINE_PACKAGE, `${ENGINE_PACKAGE}/package.json`]) {
			try {
				const root = findPackageRootUp(toStartDir(require.resolve(spec)), ENGINE_PACKAGE);
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
		const root = findInNodeModules(toStartDir(seed), ENGINE_PACKAGE);
		if (root === undefined) continue;
		if (existsSync(join(root, "docs"))) return root;
		fallback ??= root;
	}
	return fallback;
}

/**
 * Locate the engine package of the *running* pi process.
 *
 * `locateEnginePackage()` alone is not the truth on a monorepo: the plugin
 * folder's own `node_modules` can hold a second, older copy, and the walk-up
 * then reports that stale copy as "the engine" while a different version is
 * actually executing. The running copy is reachable from the CLI entry pi was
 * launched with (`<root>/dist/bundle/cli.js`), so anchor the search there.
 *
 * Returns `undefined` outside a pi process (tests, direct CLI use); callers
 * then fall back to `locateEnginePackage()`.
 */
export function locateRunningEnginePackage(): string | undefined {
	// argv[1] is the CLI entry, so a walk-up from it lands in the engine tree
	// that is running right now rather than in the workspace's own copy.
	if (process.argv[1]) {
		const root = findPackageRootUp(toStartDir(process.argv[1]), ENGINE_PACKAGE);
		if (root) return root;
	}
	// Last resort for a store layout where argv[1] is not inside the engine.
	const pinned = process.env.PI_PACKAGE_DIR;
	if (pinned) {
		return findPackageRootUp(toStartDir(pinned), ENGINE_PACKAGE) ?? findInNodeModules(pinned, ENGINE_PACKAGE);
	}
	return undefined;
}