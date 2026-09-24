/**
 * Slice isolation auditor — statically scans `import … from "…"` specifiers in
 * TypeScript sources under `src/slices/` and flags cross-slice imports.
 *
 * VSA rule (references/vsa-architecture.md): slices never import each other —
 * they depend on `src/shared/` only; the composition root (`index.ts`) is the
 * only multi-slice importer.
 *
 * Pure function of (path, content) so it is unit-testable without a terminal.
 */

export interface CrossSliceFinding {
	/** File that contains the offending import. */
	file: string;
	/** The imported specifier. */
	specifier: string;
	/** The other slice it reaches into. */
	targetSlice: string;
	/** The import statement line, trimmed. */
	line: string;
}

const STATIC_IMPORT = /^\s*import\s+(?:type\s+)?[\s\S]*?from\s*["']([^"']+)["']/;
const DYNAMIC_IMPORT = /import\s*\(\s*["']([^"']+)["']\s*\)/g;

/** Extract relative import specifiers from a TS/JS source body. */
export function extractRelativeImports(content: string): string[] {
	const specifiers: string[] = [];
	for (const line of content.split("\n")) {
		const m = STATIC_IMPORT.exec(line);
		if (m?.[1]) specifiers.push(m[1]);
	}
	for (const m of content.matchAll(DYNAMIC_IMPORT)) {
		if (m[1]) specifiers.push(m[1]);
	}
	return specifiers.filter((s) => s.startsWith("."));
}

/**
 * Resolve a relative specifier against the importing file's directory and
 * normalize to a slash-separated path without extension.
 */
export function resolveImportPath(fromFile: string, specifier: string): string {
	const base = fromFile.replace(/\\/g, "/").split("/").slice(0, -1);
	for (const part of specifier.split("/")) {
		if (part === ".") continue;
		if (part === "..") base.pop();
		else base.push(part);
	}
	return base.join("/").replace(/\.(ts|js|tsx|jsx|mjs|cjs)$/, "");
}

/** The slice name a (normalized, extension-less) path belongs to, if any. */
export function sliceOf(normalizedPath: string): string | undefined {
	const m = /(?:^|\/)slices\/([^/]+)(?:\/|$)/.exec(normalizedPath);
	return m?.[1];
}

/**
 * Audit one source file for cross-slice imports. Returns one finding per
 * offending import. `index.ts` barrels re-exporting a sibling of the SAME
 * slice are fine; importing `../<other-slice>/…` from inside `slices/<a>/`
 * is the violation.
 */
export function checkSliceIsolation(
	filePath: string,
	content: string,
): CrossSliceFinding[] {
	const normalizedFile = filePath.replace(/\\/g, "/").replace(/\.(ts|js|tsx|jsx|mjs|cjs)$/, "");
	const ownSlice = sliceOf(normalizedFile);
	if (!ownSlice) return []; // not inside src/slices/<name>/

	const findings: CrossSliceFinding[] = [];
	for (const specifier of extractRelativeImports(content)) {
		const resolved = resolveImportPath(normalizedFile, specifier);
		const target = sliceOf(resolved);
		if (target && target !== ownSlice) {
			findings.push({
				file: normalizedFile,
				specifier,
				targetSlice: target,
				line: `import … from "${specifier}"`,
			});
		}
	}
	return findings;
}
