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

function checkPackageJson(path: string, content: string): ComplianceCheck[] {
	if (!path.endsWith("package.json")) return [];
	try {
		const parsed = JSON.parse(content);
		const deps = parsed.dependencies ?? {};
		const peerDeps = parsed.peerDependencies ?? {};
		const corePkgs = [
			"@earendil-works/pi-ai",
			"@earendil-works/pi-agent-core",
			"@earendil-works/pi-coding-agent",
			"@earendil-works/pi-tui",
			"typebox",
		];
		const leaked = corePkgs.filter((pkg) => pkg in deps);
		if (leaked.length > 0) {
			return [
				createCheck({
					rule: "peer-deps",
					label: "PeerDependencies Guard",
					status: "fail",
					details: `Core package(s) [${leaked.join(", ")}] placed in dependencies!`,
					targetFile: path,
				}),
			];
		}
		if (corePkgs.some((pkg) => pkg in peerDeps)) {
			return [
				createCheck({
					rule: "peer-deps",
					label: "PeerDependencies Guard",
					status: "pass",
					details: "Core packages isolated in peerDependencies: '*'",
					targetFile: path,
				}),
			];
		}
	} catch {
		// Non-fatal JSON parse error
	}
	return [];
}

function checkTrailingSpace(path: string, content: string, activeInvariants: Set<string>): ComplianceCheck[] {
	if (!content.includes("getArgumentCompletions") && !path.includes("complete") && !path.includes("command")) {
		return [];
	}
	const hasNonTerminal =
		content.includes("NON_TERMINAL") ||
		content.includes("space: true") ||
		content.includes("space ?") ||
		/\$\{[a-zA-Z0-9_]+\}\s+["'`]/.test(content) ||
		/value:\s*[`"'].*?\s+[`"']/.test(content);

	if (hasNonTerminal) {
		return [
			createCheck({
				rule: "trailing-space",
				label: "Trailing Space Contract",
				status: "pass",
				details: "Non-terminal options append trailing space for parameter chaining",
				targetFile: path,
			}),
		];
	}
	const hasBare = /value:\s*[a-zA-Z0-9_]+\s*[,}]/.test(content);
	if (hasBare && activeInvariants.has("trailing-space")) {
		return [
			createCheck({
				rule: "trailing-space",
				label: "Trailing Space Contract",
				status: "warn",
				details: "Autocompletions detected without NON_TERMINAL space separation",
				targetFile: path,
			}),
		];
	}
	return [];
}

function checkStringEnum(path: string, content: string): ComplianceCheck[] {
	if (!content.includes("registerTool") && !content.includes("Type.Object")) return [];
	const usesForbidden =
		/Type\.Union\(\s*\[\s*Type\.Literal/.test(content) ||
		/Type\.Literal\([^)]+\)\s*,\s*Type\.Literal/.test(content);
	if (usesForbidden) {
		return [
			createCheck({
				rule: "string-enum",
				label: "StringEnum Schema Rule",
				status: "fail",
				details: "Type.Union of Type.Literal breaks Gemini! Replace with StringEnum([...])",
				targetFile: path,
			}),
		];
	}
	if (content.includes("StringEnum(")) {
		return [
			createCheck({
				rule: "string-enum",
				label: "StringEnum Schema Rule",
				status: "pass",
				details: "StringEnum imported from @earendil-works/pi-ai (Gemini compatible)",
				targetFile: path,
			}),
		];
	}
	return [];
}

function checkErrorThrow(path: string, content: string): ComplianceCheck[] {
	if (!content.includes("registerTool") || !content.includes("execute:")) return [];
	const returnsError =
		/return\s*\{[^}]*isError:\s*true/.test(content) ||
		/return\s*\{[^}]*error:\s*["'`]/.test(content);
	const throwsError = /throw\s+new\s+Error\(/.test(content);

	if (returnsError && !throwsError) {
		return [
			createCheck({
				rule: "error-throw",
				label: "Tool Error Contract",
				status: "warn",
				details: "Returning error object does not set isError flag in Pi. Use 'throw new Error(...)'",
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
				details: "Errors correctly raised via throw new Error()",
				targetFile: path,
			}),
		];
	}
	return [];
}

function checkLifecycle(path: string, content: string): ComplianceCheck[] {
	if (!content.includes('pi.on("') && !content.includes("pi.on('")) return [];
	const unsubStored =
		content.includes("unsubscribe") ||
		content.includes("unsubs") ||
		content.includes(".push(pi.on(") ||
		content.includes("const unsub = pi.on(");
	const hasShutdown =
		content.includes('"session_shutdown"') ||
		content.includes("'session_shutdown'");

	if (unsubStored && hasShutdown) {
		return [
			createCheck({
				rule: "lifecycle-cleanup",
				label: "Lifecycle Cleanup Rule",
				status: "pass",
				details: "Listeners unsubscribed on session_shutdown",
				targetFile: path,
			}),
		];
	}
	return [];
}

export function auditCodeContent(
	filePath: string,
	content: string,
	activeInvariants: Set<string>,
): ComplianceCheck[] {
	const normalizedPath = filePath.replace(/\\/g, "/");
	return [
		...checkPackageJson(normalizedPath, content),
		...checkTrailingSpace(normalizedPath, content, activeInvariants),
		...checkStringEnum(normalizedPath, content),
		...checkErrorThrow(normalizedPath, content),
		...checkLifecycle(normalizedPath, content),
	];
}
