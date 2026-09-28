/**
 * Multilingual UI auditor — flags user-facing text that never reaches a string table.
 *
 * A plugin that hardcodes `ctx.ui.notify("Cards: 3")` is English forever, and the
 * fix is never obvious later: the string looks fine, it is just not localizable.
 * The rule this module enforces:
 *
 *   - text the USER reads (notify, select, confirm, statusline, command
 *     description) must come from the string table, i.e. `stringsFor(lang).…`
 *     or another expression — never from an inline prose literal;
 *   - text the MODEL reads (tool `description`, tool result text) stays English in
 *     every locale, because the agent is the one being instructed.
 *
 * Comment-blind (a file that merely mentions `notify` in prose is compliant) and a
 * pure function of (path, content), so it unit-tests without a terminal.
 *
 * Cross-platform by construction: a pure string scan — no filesystem, no shell,
 * no locale-dependent API, no path separator assumptions.
 */

/** An import that pulls the file into a localized package. */
const USES_TABLE =
	/from\s+["'][^"']*(?:i18n|strings|locale|messages|translations)[^"']*["']/i;

export interface MultilingualUiFinding {
	/** File that contains the hardcoded text. */
	file: string;
	/** The UI sink that received it. */
	sink: string;
	/** The offending literal, truncated for the report. */
	literal: string;
	line: number;
	/** "fail" for prose, "warn" for a single token (an id, a level, a unit). */
	severity: "fail" | "warn";
}

/** Sinks that carry text to the user. `description:` covers registerCommand. */
const UI_SINKS: readonly RegExp[] = [
	/\b(?:ui|ctx)\s*\.\s*notify\s*\(/g,
	/\b(?:ui|ctx)\s*\.\s*select\s*\(/g,
	/\b(?:ui|ctx)\s*\.\s*confirm\s*\(/g,
	/\bsetStatus\s*\(/g,
	/\bdescription\s*:\s*/g,
];

/** Files allowed to contain prose: the tables themselves. */
const TABLE_FILE = /(?:^|\/)(?:i18n|strings|locale|messages|translations)[/.]/i;

/** Expressions that already resolve through the table. */
const FROM_TABLE =
	/\b(?:stringsFor|strings|t|i18n|s|copy|locale|tr)\s*[.(]|\b(?:s|strings)\.[A-Za-z_$]/;

/** A quoted run: we only need the raw text between the quotes. */
const LITERAL = /(["'`])((?:[^\\]|\\.)*?)\1/;

function isTableFile(filePath: string): boolean {
	return TABLE_FILE.test(filePath.replace(/\\/g, "/"));
}

/** Split on top-level commas, ignoring those inside strings or brackets. */
function splitTopLevel(text: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let quote: string | undefined;
	let start = 0;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i] as string;
		if (quote) {
			if (ch === "\\") i++;
			else if (ch === quote) quote = undefined;
			continue;
		}
		if (ch === '"' || ch === "'" || ch === "`") {
			quote = ch;
			continue;
		}
		if (ch === "(" || ch === "[" || ch === "{") depth++;
		else if (ch === ")" || ch === "]" || ch === "}") depth--;
		else if (ch === "," && depth === 0) {
			parts.push(text.slice(start, i));
			start = i + 1;
		}
	}
	parts.push(text.slice(start));
	return parts.map((part) => part.trim());
}

/** The argument list of a call, or undefined when the call has no arguments. */
function argumentsOf(content: string, openParen: number): string[] | undefined {
	const args = splitTopLevel(content.slice(openParen + 1, closeParenIndex(content, openParen)));
	return args.length > 0 && args[0] !== "" ? args : undefined;
}

function closeParenIndex(content: string, openParen: number): number {
	let depth = 0;
	let quote: string | undefined;
	for (let i = openParen; i < content.length; i++) {
		const ch = content[i] as string;
		if (quote) {
			if (ch === "\\") i++;
			else if (ch === quote) quote = undefined;
			continue;
		}
		if (ch === '"' || ch === "'" || ch === "`") quote = ch;
		else if (ch === "(") depth++;
		else if (ch === ")") {
			depth--;
			if (depth === 0) return i;
		}
	}
	return content.length;
}

/**
 * Blank out template-literal bodies, preserving offsets and newlines.
 *
 * Generated source lives in template literals (a scaffolder, a docs builder), and
 * a `description:` inside one is text ABOUT code, not a call site — scanning it would
 * make the auditor fail its own generator. Real user-facing text in a template is
 * dynamic anyway, and dynamic text is not this rule's business.
 */
function maskTemplateLiterals(content: string): string {
	const out = content.split("");
	let i = 0;
	while (i < content.length) {
		const ch = content[i] as string;
		if (ch === "\\") {
			i += 2;
			continue;
		}
		if (ch !== "`") {
			i++;
			continue;
		}
		// Inside the literal: blank everything, but keep interpolations balanced so
		// a stray backtick inside `${…}` cannot end the span early.
		let braces = 0;
		for (i++; i < content.length; i++) {
			const c = content[i] as string;
			if (c === "\\") {
				i++;
				continue;
			}
			if (c === "$" && content[i + 1] === "{") {
				braces++;
				i++;
				continue;
			}
			if (c === "}" && braces > 0) {
				braces--;
				continue;
			}
			if (c === "`" && braces === 0) break;
			if (c !== "\n") out[i] = " ";
		}
	}
	return out.join("");
}

/** Strip block and line comments, keeping string contents intact. */
function stripComments(content: string): string {
	return content
		.replace(/\/\*[\s\S]*?\*\//g, " ")
		.replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1 ");
}

/**
 * The literal value that starts at `from`, or undefined when the value is
 * anything else: an identifier, a member access, a call, or a template literal.
 *
 * Deliberately simple rather than a parser: a template literal is composed at
 * runtime, so its text cannot be judged here, and every dynamic value is the
 * plugin author's business. Only a plain quoted run is a candidate.
 */
function literalValueAt(text: string, from: number): string | undefined {
	const m = /^\s*(["'])([\s\S]*?)\1/.exec(text.slice(from));
	return m?.[2];
}

/**
 * The registration a sink sits inside: `registerTool` text is read by the model,
 * `registerCommand` text by the user. Scans backwards for the nearest opener,
 * which is exact enough because registrations do not nest.
 */
function enclosingRegistration(text: string, index: number): "tool" | "command" | undefined {
	const before = text.slice(Math.max(0, index - 400), index);
	const last = [...before.matchAll(/\bregister(Tool|Command|Shortcut)\s*\(/g)].pop();
	if (!last?.[1]) return undefined;
	return last[1] === "Tool" ? "tool" : "command";
}

/** Index just past the first top-level comma, or undefined if there is none. */
function indexAfterTopLevelComma(text: string, from: number): number | undefined {
	let depth = 0;
	let quote: string | undefined;
	for (let i = from; i < text.length; i++) {
		const ch = text[i] as string;
		if (quote) {
			if (ch === "\\") i++;
			else if (ch === quote) quote = undefined;
			continue;
		}
		if (ch === '"' || ch === "'" || ch === "`") quote = ch;
		else if (ch === "(" || ch === "[" || ch === "{") depth++;
		else if (ch === ")" || ch === "]" || ch === "}") depth--;
		else if (ch === "," && depth === 0) return i + 1;
	}
	return undefined;
}

/**
 * Audit one source file for hardcoded user-facing text.
 *
 * Scope — this rule guards LOCALIZED plugins, adoption is the scaffold's job:
 * a file that never touches a string table cannot "bypass" one, and a repo of
 * English-only plugins would drown in noise that nothing acts on. So a file is
 * only in scope once it imports its table, and from then on every bypass is a real
 * defect in a plugin that promised localization.
 *
 * One finding per offending sink; a clean file raises nothing.
 */
export function checkMultilingualUi(filePath: string, content: string): MultilingualUiFinding[] {
	if (isTableFile(filePath)) return [];
	// Order matters: comments first (a `//` inside a string is not a comment),
	// then template bodies (generated source is not a call site).
	const stripped = maskTemplateLiterals(stripComments(content));
	if (!USES_TABLE.test(stripped)) return [];
	const findings: MultilingualUiFinding[] = [];

	for (const sinkRe of UI_SINKS) {
		sinkRe.lastIndex = 0;
		for (let m = sinkRe.exec(stripped); m !== null; m = sinkRe.exec(stripped)) {
			const sink = m[0].replace(/[(:].*$/, "").trim();
			// `description:` is user-facing in registerCommand and model-facing in
			if (sink === "description" && enclosingRegistration(stripped, m.index) === "tool") {
				continue;
			}
			const afterSink = m.index + m[0].length;
			// setStatus(id, text): the id is ours, the text is the user's.
			const start = sink === "setStatus" ? indexAfterTopLevelComma(stripped, afterSink) : afterSink;
			if (start === undefined) continue;
			const text = literalValueAt(stripped, start);
			if (!text || !/[A-Za-zÀ-ɏ]/.test(text)) continue; // dynamic, empty, or a symbol

			findings.push({
				file: filePath.replace(/\\/g, "/"),
				sink,
				literal: text.length > 60 ? `${text.slice(0, 57)}…` : text,
				line: stripped.slice(0, m.index).split("\n").length,
				// Prose is a hard failure; a lone token is only worth a warning.
				severity: /\s/.test(text.trim()) ? "fail" : "warn",
			});
		}
	}
	return findings;
}
