/**
 * Engine version resolution and the pin-to-latest check behind SKILL.md §0.
 *
 * Split out of `doctor.ts` so that file keeps its own size budget, and kept free
 * of `doctor.ts` imports so the dependency runs one way: doctor → engine-version.
 */

/** Status vocabulary shared with the doctor report, kept local to avoid a cycle. */
export type VersionStatus = "pass" | "warn" | "info";

export interface VersionCheck {
	status: VersionStatus;
	details: string;
}

export const ENGINE_PACKAGE = "@earendil-works/pi-coding-agent";

/** Compare two dotted versions by semver precedence. Returns <0, 0 or >0. */
export function compareVersions(a: string, b: string): number {
	const pa = parseVersion(a);
	const pb = parseVersion(b);

	// Build metadata is explicitly not part of precedence.
	const len = Math.max(pa.release.length, pb.release.length);
	for (let i = 0; i < len; i += 1) {
		const na = pa.release[i] ?? 0;
		const nb = pb.release[i] ?? 0;
		if (na !== nb) return na < nb ? -1 : 1;
	}

	// A release outranks any prerelease of the same version.
	if (pa.pre.length === 0 && pb.pre.length === 0) return 0;
	if (pa.pre.length === 0) return 1;
	if (pb.pre.length === 0) return -1;

	const preLen = Math.max(pa.pre.length, pb.pre.length);
	for (let i = 0; i < preLen; i += 1) {
		const xa = pa.pre[i];
		const xb = pb.pre[i];
		if (xa === undefined) return -1;
		if (xb === undefined) return 1;
		if (xa === xb) continue;
		const na = typeof xa === "number";
		const nb = typeof xb === "number";
		// Numeric identifiers always have lower precedence than alphanumeric ones.
		if (na && !nb) return -1;
		if (!na && nb) return 1;
		return (xa as number) < (xb as number) ? -1 : 1;
	}
	return 0;
}

interface ParsedVersion {
	release: number[];
	pre: Array<number | string>;
}

function parseVersion(input: string): ParsedVersion {
	const withoutBuild = input.trim().replace(/^v/i, "").split("+")[0] ?? "";
	const [main = "", ...preParts] = withoutBuild.split("-");
	const release = main.split(".").map((part) => {
		const n = Number.parseInt(part, 10);
		return Number.isNaN(n) ? 0 : n;
	});
	const pre: Array<number | string> = [];
	for (const part of preParts.join("-").split(".")) {
		if (part.length === 0) continue;
		const n = Number.parseInt(part, 10);
		pre.push(Number.isNaN(n) ? part : n);
	}
	return { release, pre };
}

/**
 * Ask npm for the newest published engine version.
 *
 * Best effort by design: doctor must never hang or fail because the registry is
 * unreachable or offline, so the timeout is short and every error path collapses
 * to `undefined`, which the report renders as "unknown".
 */
export async function fetchLatestEngineVersion(
	fetchImpl: typeof fetch = fetch,
	timeoutMs = 3000,
): Promise<string | undefined> {
	const url = `https://registry.npmjs.org/${ENGINE_PACKAGE}/latest`;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await fetchImpl(url, { signal: controller.signal });
		if (!res.ok) return undefined;
		const body = (await res.json()) as { version?: unknown };
		return typeof body?.version === "string" ? body.version : undefined;
	} catch {
		return undefined;
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Compare the installed engine against npm.
 *
 * Pure: the caller supplies both facts, so the rule is unit-testable without a
 * registry and without a filesystem.
 */
export function checkEngineVersion(input: {
	installed?: string;
	latest?: string;
}): VersionCheck {
	if (!input.installed) {
		return { status: "warn", details: "cannot compare without the installed version" };
	}
	if (!input.latest) {
		return { status: "info", details: "unknown — npm registry unreachable (offline?)" };
	}
	if (compareVersions(input.installed, input.latest) < 0) {
		return {
			status: "warn",
			details:
				`${input.latest} on npm, ${input.installed} installed — ` +
				"pin to latest before building (SKILL.md §0)",
		};
	}
	return { status: "pass", details: `${input.latest} — up to date` };
}
