/**
 * Static compliance auditor.
 *
 * Every check is a pure function of (path, source) so it can be unit-tested
 * without a terminal (see `test/auditor.test.ts`) and reused by
 * `/plugin-dev doctor` for a self-audit of this package.
 *
 * Two rules of engagement, learned from real false results:
 *   1. **Comment-blind.** Detection runs on `stripComments(source)`, because a
 *      file that merely *mentions* `unsubscribe` in prose is not compliant.
 *   2. **Prefer `warn` over `fail`** unless the skill states a hard rule. A
 *      `fail` is reserved for things that break at runtime (core package in
 *      `dependencies`, a `✓` inside `item.value`, `custom()` outside TUI mode,
 *      a local-path install source).
 */

import type { ComplianceCheck, ComplianceStatus } from "./types.js";

let checkCounter = 0;

interface CheckOptions {
	rule: ComplianceCheck["rule"];
	label: string;
	status: ComplianceStatus;
	details: string;
	targetFile?: string;
}

function createCheck(opts: CheckOptions): ComplianceCheck {
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
 * Shared scanner used by `stripComments` (keep string bodies) and
 * `stripLiterals` (drop them).
 *
 * Quote-aware and regex-aware: a `//` inside `"https://…"` or inside a regex
 * literal such as `/pi\.on(/)` is content, not a comment, so it neither hides
 * code from the checks nor invents one. Regex literals use the usual "the
 * previous significant character allows a regex" heuristic; without it, a
 * character class containing a backtick would open a phantom string and swallow
 * the rest of the file.
 */
/** A `/` opens a regex only after an operator or opening bracket, never after a value. */
function regexAllowed(prev: string): boolean {
	if (prev === "") return true;
	return "([{,;:=!&|?+-*%~^<>".includes(prev);
}

function scanSource(source: string, keepStringBody: boolean): string {
	let out = "";
	let state: "code" | "line" | "block" | "quote" | "regex" = "code";
	let quote = "";
	let inCharClass = false;
	let prevSignificant = "";

	for (let i = 0; i < source.length; i += 1) {
		const ch = source[i] ?? "";
		const next = source[i + 1];

		if (state === "line") {
			if (ch === "\n") {
				state = "code";
				out += ch;
			}
			continue;
		}
		if (state === "block") {
			if (ch === "*" && next === "/") {
				state = "code";
				i += 1;
			}
			continue;
		}
		if (state === "regex") {
			if (ch === "\\") {
				if (keepStringBody && next !== undefined) out += ch + next;
				i += 1;
				continue;
			}
			if (ch === "[") {
				inCharClass = true;
			} else if (ch === "]" && inCharClass) {
				inCharClass = false;
			} else if (ch === "/" && !inCharClass) {
				state = "code";
				out += ch;
				prevSignificant = "/";
				continue;
			}
			if (keepStringBody) out += ch;
			continue;
		}
		if (state === "quote") {
			if (ch === "\\") {
				if (keepStringBody && next !== undefined) out += ch + next;
				i += 1;
				continue;
			}
			if (ch === quote) {
				state = "code";
				out += ch;
				prevSignificant = ch;
				continue;
			}
			if (keepStringBody) out += ch;
			continue;
		}

		if (ch === "/" && next === "/") {
			state = "line";
			i += 1;
			continue;
		}
		if (ch === "/" && next === "*") {
			state = "block";
			i += 1;
			continue;
		}
		if (ch === "/" && regexAllowed(prevSignificant)) {
			state = "regex";
			inCharClass = false;
			out += ch;
			continue;
		}
		if (ch === '"' || ch === "'" || ch === "`") {
			state = "quote";
			quote = ch;
			out += ch;
			prevSignificant = ch;
			continue;
		}
		if (!/\s/.test(ch)) prevSignificant = ch;
		out += ch;
	}
	return out;
}

export function stripComments(source: string): string {
	return scanSource(source, true);
}

/**
 * Drop comments **and** string/template bodies, keeping the quote characters.
 *
 * Used for counting call sites: without this, a plugin that merely *documents*
 * `pi.on(` inside a string or a regex literal looks like it registers listeners.
 */
export function stripLiterals(source: string): string {
	return scanSource(source, false);
}

const CORE_PACKAGES = [
	"@earendil-works/pi-ai",
	"@earendil-works/pi-agent-core",
	"@earendil-works/pi-coding-agent",
	"@earendil-works/pi-tui",
	"typebox",
];

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

function checkPackageManifest(path: string, content: string): ComplianceCheck[] {
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

	const hasPiManifest = parsed.pi !== undefined && parsed.pi !== null;
	if (!hasPiManifest && looksLikePiPackage) {
		checks.push(
			createCheck({
				rule: "manifest-hygiene",
				label: "Pi Manifest Guard",
				status: "warn",
				details: 'No "pi" manifest: resources are discovered only through conventional directories.',
				targetFile: path,
			}),
		);
	}
	if (hasPiManifest && !Array.isArray(parsed.files)) {
		checks.push(
			createCheck({
				rule: "manifest-hygiene",
				label: "Publish Files Guard",
				status: "warn",
				details: 'A "pi" manifest without "files" can publish the whole checkout (dist, node_modules) to npm.',
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

	return checks;
}

/**
 * Trailing Space Contract, Lazy Parameter Completion and current-value marker
 * hygiene for a file that registers `getArgumentCompletions`.
 */
function checkCommandCompletions(path: string, content: string): ComplianceCheck[] {
	const code = stripComments(content);
	// A file that only wires up a shared builder is audited through that builder
	// (see src/completions.ts), so it is not re-checked here.
	if (/createCompletions\s*\(/.test(code) && !/export function createCompletions/.test(code)) return [];
	const isCompletionFile = /(completion|command)/i.test(path);
	const declaresCompletions = /getArgumentCompletions\s*[:(=]/.test(code);
	if (!isCompletionFile && !declaresCompletions) return [];

	const checks: ComplianceCheck[] = [];

	// A marker inside `value` is inserted verbatim and corrupts the command.
	const valueWithMarker = /value:\s*[^,\n]{0,160}?[✓●○]/.exec(code);
	if (valueWithMarker) {
		checks.push(
			createCheck({
				rule: "trailing-space",
				label: "Completion Marker Guard",
				status: "fail",
				details: `Current-value marker found in an item.value (\`${valueWithMarker[0].trim()}\`). Markers belong in label/description only — value is inserted verbatim.`,
				targetFile: path,
			}),
		);
	}
	if (/description:[^\n]*\\u001b|description:[^\n]*\\x1b/.test(code)) {
		checks.push(
			createCheck({
				rule: "trailing-space",
				label: "Completion Marker Guard",
				status: "warn",
				details: "ANSI escape inside a description: an inner reset cancels the theme colour and breaks the row.",
				targetFile: path,
			}),
		);
	}

	const hasNonTerminal =
		code.includes("NON_TERMINAL") ||
		/\$\{[^}]*\}\s+[`"']/.test(code) ||
		/value:\s*[`"'][^`"'\n]*\s[`"']/.test(code);

	if (!hasNonTerminal) {
		checks.push(
			createCheck({
				rule: "trailing-space",
				label: "Trailing Space Contract",
				status: "warn",
				details: "No non-terminal completion row found: a subcommand with parameters may not offer Tab → space → next level.",
				targetFile: path,
			}),
		);
		return checks;
	}

	checks.push(
		createCheck({
			rule: "trailing-space",
			label: "Trailing Space Contract",
			status: "pass",
			details: "Non-terminal options append a trailing space for parameter chaining",
			targetFile: path,
		}),
	);

	// Lazy expansion: Tab closes the picker, so a fully typed non-terminal token
	// must already return its children.
	const lazyEvidence =
		code.includes("LAZY_EXPAND") ||
		/tokens\.length\s*===?\s*1\s*&&[\s\S]{0,120}?\.has\(/.test(code);
	if (!lazyEvidence && code.includes("NON_TERMINAL")) {
		checks.push(
			createCheck({
				rule: "trailing-space",
				label: "Lazy Parameter Completion",
				status: "warn",
				details: "Non-terminal parameters expand only after a trailing space; Tab cannot re-open the picker (see the skill's Lazy Parameter Completion rule).",
				targetFile: path,
			}),
		);
	}

	// Current-value annotation for on|off menus.
	const hasOnOffRows =
		/\$\{[^}]*\}\s+(on|off)\b/.test(code) || /value:\s*[`"'][^`"'\n]*\b(on|off)\b[`"']/.test(code);
	if (hasOnOffRows && !code.includes("✓")) {
		checks.push(
			createCheck({
				rule: "trailing-space",
				label: "Current-Value Annotation",
				status: "warn",
				details: "on|off rows carry no ✓ marker: the menu does not show which value is in effect.",
				targetFile: path,
			}),
		);
	}

	return checks;
}

function checkStringEnum(path: string, content: string): ComplianceCheck[] {
	const code = stripComments(content);
	if (!code.includes("registerTool") && !code.includes("Type.Object")) return [];

	const usesForbidden =
		/Type\.Union\(\s*\[\s*Type\.Literal/.test(code) ||
		/Type\.Literal\([^)]+\)\s*,\s*Type\.Literal/.test(code);
	if (usesForbidden) {
		return [
			createCheck({
				rule: "string-enum",
				label: "StringEnum Schema Rule",
				status: "fail",
				details: "Type.Union of Type.Literal breaks Google Gemini! Replace with StringEnum([...]).",
				targetFile: path,
			}),
		];
	}
	if (code.includes("StringEnum(")) {
		return [
			createCheck({
				rule: "string-enum",
				label: "StringEnum Schema Rule",
				status: "pass",
				details: "StringEnum used for enum parameters (Gemini compatible)",
				targetFile: path,
			}),
		];
	}
	return [];
}

function checkErrorThrow(path: string, content: string): ComplianceCheck[] {
	const code = stripComments(content);
	if (!code.includes("registerTool") || !code.includes("execute")) return [];

	const returnsError =
		/return\s*\{[^}]*isError:\s*true/.test(code) ||
		/return\s*\{[^}]*error:\s*["'`]/.test(code);
	const throwsError = /throw\s+new\s+Error\(/.test(code);

	if (returnsError && !throwsError) {
		return [
			createCheck({
				rule: "error-throw",
				label: "Tool Error Contract",
				status: "warn",
				details: "Returning an error object does not set isError. Use `throw new Error(...)`.",
				targetFile: path,
			}),
		];
	}
	if (throwsError) {
		return [
			createCheck({
				rule: "error-throw",
				label: "Tool Error Contract",
				status: "pass",
				details: "Failures raised via throw new Error()",
				targetFile: path,
			}),
		];
	}
	return [];
}

/**
 * Listener cleanup, comment-blind.
 *
 * Counting `pi.on(` is not enough (the old check passed on a file whose only
 * mention of "unsubscribe" was a doc comment). This variant counts how many
 * subscriptions are *captured* and then looks for a real drain call.
 */
export function countSubscriptions(code: string): { total: number; stored: number } {
	const codeOnly = stripLiterals(code);
	const commentsOnly = stripComments(code);
	// The `session_shutdown` registration is the drainer itself; it is expected to
	// outlive the listeners it releases, so it is not a missing unsubscribe.
	const shutdown = (commentsOnly.match(/pi\.on\s*\(\s*["']session_shutdown["']/g) ?? []).length;
	const total = (codeOnly.match(/pi\.on\s*\(/g) ?? []).length - shutdown;
	const stored = (
		codeOnly.match(
			/(?:\w+)\s*=\s*pi\.on\s*\(|push\s*\(\s*pi\.on\s*\(|track\s*\(\s*pi\.on\s*\(|disposers\s*\.\s*push\s*\(\s*pi\.on\s*\(/g,
		) ?? []
	).length;
	return { total: Math.max(0, total), stored };
}

function checkLifecycle(path: string, content: string): ComplianceCheck[] {
	const code = stripComments(content);
	const { total, stored } = countSubscriptions(content);
	if (total === 0) return [];

	const hasShutdown = /["']session_shutdown["']/.test(code);
	const hasDrain =
		/\.pop\(\)\s*\?\.\s*\(\)/.test(code) ||
		/\bfor\s*\(\s*const\s+\w+\s+of\s+\w+/.test(code) ||
		/\.forEach\s*\(\s*\(?\s*\w*\s*\)?\s*=>/.test(code);

	if (stored === 0) {
		return [
			createCheck({
				rule: "lifecycle-cleanup",
				label: "Lifecycle Cleanup Rule",
				status: "fail",
				details: `${total} pi.on() subscription(s) with no stored unsubscribe function — listeners leak across /reload and session replacement.`,
				targetFile: path,
			}),
		];
	}
	if (stored < total) {
		return [
			createCheck({
				rule: "lifecycle-cleanup",
				label: "Lifecycle Cleanup Rule",
				status: "warn",
				details: `Only ${stored} of ${total} pi.on() subscriptions are stored for cleanup.`,
				targetFile: path,
			}),
		];
	}
	if (!hasShutdown || !hasDrain) {
		return [
			createCheck({
				rule: "lifecycle-cleanup",
				label: "Lifecycle Cleanup Rule",
				status: "warn",
				details: "Unsubscribers are stored but never drained on session_shutdown.",
				targetFile: path,
			}),
		];
	}
	return [
		createCheck({
			rule: "lifecycle-cleanup",
			label: "Lifecycle Cleanup Rule",
			status: "pass",
			details: `All ${total} listener(s) retained and drained on session_shutdown`,
			targetFile: path,
		}),
	];
}

/**
 * `ctx.ui.custom()` and `ctx.ui.onTerminalInput()` need a real terminal: in RPC
 * mode `custom()` resolves to `undefined` and `onTerminalInput()` is a no-op,
 * while `ctx.hasUI` is still `true`. Guard them with `ctx.mode === "tui"`.
 */
function checkUiModeGuard(path: string, content: string): ComplianceCheck[] {
	const code = stripComments(content);
	const usesTerminalOnly = /\.custom\s*(?:<[^>]*>)?\s*\(/.test(code) || /\.onTerminalInput\s*\(/.test(code);
	if (!usesTerminalOnly) return [];
	if (/mode\s*[!=]==?\s*["']tui["']/.test(code)) {
		return [
			createCheck({
				rule: "ui-mode-guard",
				label: "UI Mode Guard",
				status: "pass",
				details: "Terminal-only UI guarded with ctx.mode === 'tui'",
				targetFile: path,
			}),
		];
	}
	const usesHasUI = /hasUI/.test(code);
	return [
		createCheck({
			rule: "ui-mode-guard",
			label: "UI Mode Guard",
			status: "warn",
			details: usesHasUI
				? "ctx.ui.custom()/onTerminalInput() guarded by hasUI only. In RPC mode hasUI is true but custom() returns undefined — guard with ctx.mode === 'tui'."
				: "ctx.ui.custom()/onTerminalInput() without any mode guard (ctx.mode === 'tui').",
			targetFile: path,
		}),
	];
}

function checkStatePersistence(path: string, content: string): ComplianceCheck[] {
	const code = stripComments(content);
	if (!code.includes("pi.appendEntry(")) return [];
	if (/sessionManager/.test(code)) {
		return [
			createCheck({
				rule: "state-persistence",
				label: "State Persistence Rule",
				status: "pass",
				details: "Appended entries are reconciled from the session on start",
				targetFile: path,
			}),
		];
	}
	return [
		createCheck({
			rule: "state-persistence",
			label: "State Persistence Rule",
			status: "warn",
			details: "pi.appendEntry() with no sessionManager read: state is written but never restored after /tree, /reload or resume.",
			targetFile: path,
		}),
	];
}

/**
 * Machine-absolute install paths in docs break on the next machine, node
 * version or install root. A relative `node_modules/@earendil-works/...`
 * reference is portable and deliberately not flagged.
 */
function checkDocsPortability(path: string, content: string): ComplianceCheck[] {
	const looksLikeDoc = path.endsWith(".md") || path.endsWith(".mdx");
	if (!looksLikeDoc) return [];
	const hit =
		/[A-Za-z]:\\?[^\s"'`)]*node_modules/.exec(content) ?? /node-v\d+\.\d+\.\d+-win/.exec(content);
	if (!hit) return [];
	return [
		createCheck({
			rule: "docs-portability",
			label: "Docs Portability",
			status: "warn",
			details: `Hardcoded engine path (\`${hit[0].slice(0, 60)}…\`). Resolve the docs directory at runtime instead.`,
			targetFile: path,
		}),
	];
}

export function auditCodeContent(
	filePath: string,
	content: string,
	activeInvariants: ReadonlySet<string>,
): ComplianceCheck[] {
	const normalizedPath = filePath.replace(/\\/g, "/");
	// All rules run on every mutation. `activeInvariants` is kept for call-site
	// compatibility; a missing reference must not be able to hide a violation.
	void activeInvariants;
	return [
		...checkPackageManifest(normalizedPath, content),
		...checkCommandCompletions(normalizedPath, content),
		...checkStringEnum(normalizedPath, content),
		...checkErrorThrow(normalizedPath, content),
		...checkLifecycle(normalizedPath, content),
		...checkUiModeGuard(normalizedPath, content),
		...checkStatePersistence(normalizedPath, content),
		...checkDocsPortability(normalizedPath, content),
	];
}

/** Every rule key, so `/plugin-dev doctor` audits with the full rule set. */
export const ALL_INVARIANTS: ReadonlySet<string> = new Set([
	"trailing-space",
	"string-enum",
	"error-throw",
	"peer-deps",
	"lifecycle-cleanup",
	"manifest-hygiene",
	"ui-mode-guard",
	"state-persistence",
	"docs-portability",
]);
