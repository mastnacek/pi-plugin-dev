import type { ComplianceCheck, ComplianceStatus } from "./types.js";

const CORE_PACKAGES = [
	"@earendil-works/pi-ai",
	"@earendil-works/pi-agent-core",
	"@earendil-works/pi-coding-agent",
	"@earendil-works/pi-tui",
	"typebox",
];

interface CheckOptions {
	rule: ComplianceCheck["rule"];
	label: string;
	status: ComplianceStatus;
	details: string;
	targetFile?: string;
}

let checkCounter = 0;

export function createCheck(opts: CheckOptions): ComplianceCheck {
	checkCounter += 1;
	return {
		id: `chk-${Date.now()}-${checkCounter}`,
		rule: opts.rule,
		label: opts.label,
		status: opts.status,
		details: opts.details,
		targetFile: opts.targetFile,
		timestamp: Date.now(),
	};
}

/**
 * Install sources that are not npm/git/URL. `git:github.com/x`, `npm:y@1` and
 * `https://…` are portable; `D:/dev/x`, `./x` and `/srv/x` are not, and
 * AGENTS §8 forbids installing a plugin from a local development checkout.
 */
export function findLocalInstallSources(packages: unknown): string[] {
	if (!Array.isArray(packages)) return [];
	const locals: string[] = [];
	for (const entry of packages) {
		const source =
			typeof entry === "string"
				? entry
				: entry && typeof entry === "object" && typeof (entry as { source?: unknown }).source === "string"
					? ((entry as { source: string }).source)
					: undefined;
		if (source === undefined) continue;
		if (/^(npm:|git:|https?:|ssh:|file:)/i.test(source)) continue;
		if (/^([a-zA-Z]:[\\/]|\.{1,2}[\\/]|[\\/])/.test(source)) locals.push(source);
	}
	return locals;
}

export function checkPackageManifest(path: string, content: string): ComplianceCheck[] {
	if (!path.endsWith("package.json") && !path.endsWith("settings.json")) return [];

	let parsed: Record<string, unknown>;
	try {
		parsed = JSON.parse(content) as Record<string, unknown>;
	} catch {
		return [];
	}
	if (!parsed || typeof parsed !== "object") return [];

	const checks: ComplianceCheck[] = [];

	// Install sources may live in settings.json (or in a `packages` field).
	const locals = findLocalInstallSources(parsed.packages);
	if (locals.length > 0) {
		checks.push(
			createCheck({
				rule: "manifest-hygiene",
				label: "Install Source Guard",
				status: "fail",
				details: `Local-path install source(s): ${locals.join(", ")}. Install from npm/git instead (AGENTS §8).`,
				targetFile: path,
			}),
		);
	} else if (path.endsWith("settings.json") && Array.isArray(parsed.packages)) {
		checks.push(
			createCheck({
				rule: "manifest-hygiene",
				label: "Install Source Guard",
				status: "pass",
				details: `${(parsed.packages as unknown[]).length} package(s), all npm/git/URL sources`,
				targetFile: path,
			}),
		);
	}

	if (!path.endsWith("package.json")) return checks;

	const dependencies = (parsed.dependencies ?? {}) as Record<string, unknown>;
	const peerDependencies = (parsed.peerDependencies ?? {}) as Record<string, unknown>;
	const keywords = Array.isArray(parsed.keywords) ? (parsed.keywords as string[]) : [];
	const looksLikePiPackage =
		keywords.includes("pi-package") || (typeof parsed.name === "string" && parsed.name.startsWith("pi-"));

	const leaked = CORE_PACKAGES.filter((pkg) => pkg in dependencies);
	if (leaked.length > 0) {
		checks.push(
			createCheck({
				rule: "peer-deps",
				label: "PeerDependencies Guard",
				status: "fail",
				details: `Core package(s) [${leaked.join(", ")}] placed in dependencies! Move them to peerDependencies: { "*": "*" }.`,
				targetFile: path,
			}),
		);
	}
	if (leaked.length === 0 && CORE_PACKAGES.every((pkg) => pkg in peerDependencies)) {
		checks.push(
			createCheck({
				rule: "peer-deps",
				label: "PeerDependencies Guard",
				status: "pass",
				details: "Core packages isolated in peerDependencies: '*'",
				targetFile: path,
			}),
		);
	} else if (leaked.length === 0) {
		const missing = CORE_PACKAGES.filter((pkg) => !(pkg in peerDependencies));
		checks.push(
			createCheck({
				rule: "peer-deps",
				label: "PeerDependencies Guard",
				status: "warn",
				details: `Core package(s) [${missing.join(", ")}] not declared in peerDependencies. Declare every core package the extension imports with '*'.`,
				targetFile: path,
			}),
		);
	}

	if (parsed.type !== "module") {
		checks.push(
			createCheck({
				rule: "manifest-hygiene",
				label: "ESM Manifest Guard",
				status: "fail",
				details: 'package.json is missing "type": "module" — Pi extensions load as ESM.',
				targetFile: path,
			}),
		);
	}

	const hasPiManifest = parsed.pi !== undefined && parsed.pi !== null && typeof parsed.pi === "object";
	if (!hasPiManifest && looksLikePiPackage) {
		checks.push(
			createCheck({
				rule: "manifest-hygiene",
				label: "Pi Manifest Guard",
				status: "fail",
				details: 'Missing "pi" manifest in package.json! Git and npm package sources require an explicit "pi": { "extensions": ["./index.ts"] } (or skills/prompts/themes) to discover resources.',
				targetFile: path,
			}),
		);
	}
	if (hasPiManifest) {
		const piObj = parsed.pi as Record<string, unknown>;
		const hasDeclaredResources =
			(Array.isArray(piObj.extensions) && piObj.extensions.length > 0) ||
			(Array.isArray(piObj.skills) && piObj.skills.length > 0) ||
			(Array.isArray(piObj.prompts) && piObj.prompts.length > 0) ||
			(Array.isArray(piObj.themes) && piObj.themes.length > 0);

		if (!hasDeclaredResources) {
			checks.push(
				createCheck({
					rule: "manifest-hygiene",
					label: "Pi Manifest Guard",
					status: "fail",
					details: '"pi" manifest must declare at least one non-empty array of resources ("extensions", "skills", "prompts", or "themes").',
					targetFile: path,
				}),
			);
		} else {
			checks.push(
				createCheck({
					rule: "manifest-hygiene",
					label: "Pi Manifest Guard",
					status: "pass",
					details: '"pi" manifest declares explicit resources for package distribution.',
					targetFile: path,
				}),
			);
		}
	}
	if (hasPiManifest && !Array.isArray(parsed.files)) {
		checks.push(
			createCheck({
				rule: "manifest-hygiene",
				label: "Publish Files Guard",
				status: "fail",
				details: 'A "pi" package manifest must declare a "files" array (e.g. ["README.md", "package.json", "index.ts"]) to prevent publishing node_modules or full git checkout.',
				targetFile: path,
			}),
		);
	}

	const scripts = (parsed.scripts ?? {}) as Record<string, unknown>;
	if (typeof scripts.test !== "string") {
		checks.push(
			createCheck({
				rule: "manifest-hygiene",
				label: "Test Script Guard",
				status: "warn",
				details: 'No "test" script: the plugin has no proof it does something beyond compiling.',
				targetFile: path,
			}),
		);
	}

	// Flat-architecture guard: logic files in the package root (config.ts, gate.ts, …)
	// drift from the reference layout (thin index.ts + src/ modules, pi-plugin-dev).
	if (Array.isArray(parsed.files)) {
		const flatLogic = (parsed.files as unknown[]).filter(
			(f) => typeof f === "string" && /^\w[\w-]*\.tsx?$/.test(f) && f !== "index.ts",
		);
		if (flatLogic.length > 0) {
			checks.push(
				createCheck({
					rule: "manifest-hygiene",
					label: "Package Layout Guard",
					status: "fail",
					details: `Logic files at package root: ${flatLogic.join(", ")}. Use the reference architecture: thin index.ts composition root + src/ modules (see pi-plugin-dev skill).`,
					targetFile: path,
				}),
			);
		}
	}

	return checks;
}
