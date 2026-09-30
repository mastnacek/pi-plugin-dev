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

/**
 * Return the balanced `{...}` object literal that follows a `return`.
 *
 * A regex with `[^}]*` cannot do this job: the documented 0.99 idiom
 * `return { content, details: { query: q }, isError: true }` nests an object, so
 * the scan dies at the inner `}` and never reaches `isError` — the check was
 * simultaneously firing on code the engine accepts and staying silent on the
 * shape we document. Brace counting with string literals skipped is the
 * smallest thing that reads the whole literal.
 */
function returnedObject(code: string): string | undefined {
	const start = code.indexOf("return {");
	if (start === -1) return undefined;
	const from = start + "return".length;
	let depth = 0;
	for (let i = from; i < code.length; i += 1) {
		const ch = code[i];
		if (ch === '"' || ch === "'" || ch === "`") {
			i += 1;
			while (i < code.length && code[i] !== ch) {
				if (code[i] === "\\") i += 1;
				i += 1;
			}
			continue;
		}
		if (ch === "{") depth += 1;
		else if (ch === "}") {
			depth -= 1;
			if (depth === 0) return code.slice(from, i + 1);
		}
	}
	return undefined;
}

export function checkErrorThrow(path: string, content: string): ComplianceCheck[] {
	const code = stripComments(content);
	if (!code.includes("registerTool") || !code.includes("execute")) return [];

	const returned = returnedObject(code);
	// `error:` is not a field on AgentToolResult, so returning one is read by the
	// model as a success. `isError: true` is the real contract (0.99.0+).
	const returnsErrorField = returned !== undefined && /\berror:\s*["'`]/.test(returned);
	const returnsIsError = returned !== undefined && /isError:\s*true/.test(returned);
	const throwsError = /throw\s+new\s+Error\(/.test(code);

	if (returnsErrorField && !throwsError) {
		return [
			createCheck({
				rule: "error-throw",
				label: "Tool Error Contract",
				status: "warn",
				details:
					"`error:` is not a tool result field, so the model reads this as a success. " +
					"Return `{ isError: true }` (0.99.0+) or `throw new Error(...)`.",
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
	if (returnsIsError) {
		return [
			createCheck({
				rule: "error-throw",
				label: "Tool Error Contract",
				status: "pass",
				details: "Failure reported via `isError: true` (0.99.0+); `details` survives for the UI",
				targetFile: path,
			}),
		];
	}
	return [];
}
