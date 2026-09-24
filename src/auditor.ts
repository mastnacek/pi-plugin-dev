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
 *      `dependencies`, missing "pi" manifest, a `✓` inside `item.value`,
 *      `custom()` outside TUI mode, a local-path install source).
 */

import type { ComplianceCheck } from "./types.js";
import { checkPackageManifest, findLocalInstallSources } from "./manifest-auditor.js";
import { checkSliceIsolation } from "./slice-auditor.js";
import {
	checkCommandCompletions,
	checkErrorThrow,
	checkStringEnum,
} from "./tool-auditor.js";
import {
	checkDocsPortability,
	checkLifecycle,
	checkStatePersistence,
	checkUiModeGuard,
	countSubscriptions,
} from "./lifecycle-auditor.js";
import { stripComments, stripLiterals } from "./scanner.js";

export const ALL_INVARIANTS: ReadonlySet<string> = new Set<string>([
	"trailing-space",
	"string-enum",
	"error-throw",
	"peer-deps",
	"lifecycle-cleanup",
	"manifest-hygiene",
	"ui-mode-guard",
	"state-persistence",
	"docs-portability",
	"slice-isolation",
]);

export { checkSliceIsolation } from "./slice-auditor.js";

export {
	findLocalInstallSources,
	checkPackageManifest,
	checkCommandCompletions,
	checkStringEnum,
	checkErrorThrow,
	countSubscriptions,
	checkLifecycle,
	checkUiModeGuard,
	checkStatePersistence,
	checkDocsPortability,
	stripComments,
	stripLiterals,
};

export function auditCodeContent(
	path: string,
	content: string,
	_invariants?: ReadonlySet<string>,
): ComplianceCheck[] {
	if (path.endsWith("package.json") || path.endsWith("settings.json")) {
		return checkPackageManifest(path, content);
	}

	if (path.endsWith(".md") || path.endsWith(".mdx")) {
		return checkDocsPortability(path, content);
	}

	if (!/\.(ts|js|mjs|cjs)$/.test(path)) return [];

	// VSA slice isolation: slices never import each other (shared/ only).
	// One fail row per offending import; clean slices raise nothing.
	const crossSlice = checkSliceIsolation(path, content);
	const sliceChecks: ComplianceCheck[] = crossSlice.map((f) => ({
		id: `chk-${Date.now()}-slice-${f.targetSlice}-${Math.random().toString(36).slice(2, 8)}`,
		rule: "slice-isolation" as const,
		label: "Slice Isolation",
		status: "fail" as const,
		details: `Cross-slice import in ${f.file}: ${f.line} — reaches into slice '${f.targetSlice}'. Slices depend on src/shared/ only; the composition root is the only multi-slice importer (references/vsa-architecture.md).`,
		targetFile: path,
		timestamp: Date.now(),
	}));

	return [
		...sliceChecks,
		...checkCommandCompletions(path, content),
		...checkStringEnum(path, content),
		...checkErrorThrow(path, content),
		...checkLifecycle(path, content),
		...checkUiModeGuard(path, content),
		...checkStatePersistence(path, content),
		...checkDocsPortability(path, content),
	];
}
