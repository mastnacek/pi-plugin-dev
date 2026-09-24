import type { ComplianceCheck, ComplianceStatus } from "./types.js";
import { stripComments, stripLiterals } from "./scanner.js";

interface CheckOptions {
	rule: ComplianceCheck["rule"];
	label: string;
	status: ComplianceStatus;
	details: string;
	targetFile?: string;
}

let checkCounter = 0;

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

export function countSubscriptions(code: string): { total: number; stored: number } {
	const codeOnly = stripLiterals(code);
	const commentsOnly = stripComments(code);
	const shutdown = (commentsOnly.match(/pi\.on\s*\(\s*["']session_shutdown["']/g) ?? []).length;
	const total = (codeOnly.match(/pi\.on\s*\(/g) ?? []).length - shutdown;
	const stored = (
		codeOnly.match(
			/(?:\w+)\s*=\s*pi\.on\s*\(|push\s*\(\s*pi\.on\s*\(|track\s*\(\s*pi\.on\s*\(|disposers\s*\.\s*push\s*\(\s*pi\.on\s*\(/g,
		) ?? []
	).length;
	return { total: Math.max(0, total), stored };
}

export function checkLifecycle(path: string, content: string): ComplianceCheck[] {
	const code = stripComments(content);
	const { total, stored } = countSubscriptions(content);
	if (total === 0) return [];

	const hasShutdown = /["']session_shutdown["']/.test(code);
	const hasDrain =
		/\.pop\(\)\s*\?\.\s*\(\)/.test(code) ||
		/\bfor\s*\(\s*const\s+\w+\s+of\s+\w+/.test(code) ||
		/\.forEach\s*\(\s*\(?\s*\w*\s*\)?\s*=>/.test(code);
	const hasDelegatedTrack = /\btrack\s*:\s*\([^)]*\)\s*=>\s*void/.test(code);

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
	if (!hasDelegatedTrack && (!hasShutdown || !hasDrain)) {
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

export function checkUiModeGuard(path: string, content: string): ComplianceCheck[] {
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

export function checkStatePersistence(path: string, content: string): ComplianceCheck[] {
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

export function checkDocsPortability(path: string, content: string): ComplianceCheck[] {
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
