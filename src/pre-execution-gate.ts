import path from "node:path";
import { auditCodeContent } from "./auditor.js";
import { checkPackageManifest } from "./manifest-auditor.js";
import type { ComplianceCheck } from "./types.js";

export interface PreExecutionGateResult {
	block: boolean;
	reason?: string;
}

/**
 * Inspect proposed edits or writes before execution and block or warn
 * if fatal invariant violations are detected.
 */
export function checkPreExecutionInvariants(
	targetPath: string,
	content: string,
	strict = false,
): PreExecutionGateResult {
	const filename = path.basename(targetPath);
	const lower = filename.toLowerCase();

	// 1. package.json check (peerDependencies vs dependencies)
	if (lower === "package.json") {
		const checks = checkPackageManifest(targetPath, content);
		const fatal = checks.find((c) => c.status === "fail" && c.rule === "peer-deps");
		if (fatal) {
			return {
				block: true,
				reason:
					`[FATAL INVARIANT: Manifest Isolation] ${fatal.details}\n` +
					"Pi core packages (@earendil-works/pi-*) MUST be in 'peerDependencies: { \"*\": \"*\" }', never in 'dependencies'.",
			};
		}
	}

	// 2. TypeScript / JavaScript code checks
	if (/\.[cm]?[jt]sx?$/.test(lower)) {
		// Run auditor with all active invariants
		const activeInvariants = new Set([
			"string-enum",
			"trailing-space",
			"tool-error-throw",
			"lifecycle-cleanup",
		]);
		const checks: ComplianceCheck[] = auditCodeContent(targetPath, content, activeInvariants);

		// Fatal: Type.Union on strings
		const stringEnumFail = checks.find(
			(c) => c.status === "fail" && c.rule === "string-enum",
		);
		if (stringEnumFail) {
			return {
				block: true,
				reason:
					`[FATAL INVARIANT: StringEnum Rule] ${stringEnumFail.details}\n` +
					"Always use StringEnum([\"a\", \"b\"] as const) from @earendil-works/pi-ai. " +
					"Type.Union/Type.Literal on string enums breaks Google Gemini API requests.",
			};
		}

		// Fatal: Completion marker in item.value
		const completionValueFail = checks.find(
			(c) => c.status === "fail" && c.rule === "trailing-space",
		);
		if (completionValueFail) {
			return {
				block: true,
				reason:
					`[FATAL INVARIANT: Completion Value] ${completionValueFail.details}\n` +
					"item.value is inserted verbatim into editor; state markers (✓, AKTIVNÍ) belong ONLY in item.label or item.description.",
			};
		}

		// If strict mode is enabled, block on any failing compliance check
		if (strict) {
			const anyFail = checks.find((c) => c.status === "fail");
			if (anyFail) {
				return {
					block: true,
					reason: `[INVARIANT REJECTED (strict mode)]: ${anyFail.label} — ${anyFail.details}`,
				};
			}
		}
	}

	return { block: false };
}
