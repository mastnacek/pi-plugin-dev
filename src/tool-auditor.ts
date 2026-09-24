import type { ComplianceCheck, ComplianceStatus } from "./types.js";
import { stripComments } from "./scanner.js";

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

export function checkCommandCompletions(path: string, content: string): ComplianceCheck[] {
	const code = stripComments(content);
	if (/createCompletions\s*\(/.test(code) && !/export function createCompletions/.test(code)) return [];
	const isCompletionFile = /(completion|command)/i.test(path);
	const declaresCompletions = /getArgumentCompletions\s*[:(=]/.test(code);
	if (!isCompletionFile && !declaresCompletions) return [];

	const checks: ComplianceCheck[] = [];

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

export function checkStringEnum(path: string, content: string): ComplianceCheck[] {
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

export function checkErrorThrow(path: string, content: string): ComplianceCheck[] {
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
