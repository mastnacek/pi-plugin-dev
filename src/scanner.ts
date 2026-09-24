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

export function stripLiterals(source: string): string {
	return scanSource(source, false);
}
