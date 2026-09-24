/**
 * Config-cascade auditor — enforces the mandatory `--global` behavior contract.
 *
 * Every Pi plugin that persists settings MUST support:
 *   1. `--global` suffix accepted by every setting-changing command →
 *      persists to ~/.pi/agent/<plugin>.json (all sessions).
 *   2. Without `--global` → persists to <cwd>/.pi/<plugin>.json (project only).
 *   3. loadConfig merges global → project (project wins).
 *
 * Reference implementation: pi-decision-gate/src/config.ts + index.ts
 * (`saveConfig(cfg, isGlobal, cwd)`).
 *
 * Pure function of (path, content) — unit-testable without a terminal.
 */

export interface GlobalFlagFinding {
	/** What is missing, human-readable. */
	problem: string;
	hint: string;
}

const GLOBAL_FLAG_PATTERN = /["'`]--global["'`]|--global\b/i;

export function checkConfigCascade(
	filePath: string,
	content: string,
): GlobalFlagFinding[] {
	const normalized = filePath.replace(/\\/g, "/");
	const fileBase = normalized.split("/").pop() ?? "";

	// 1. A command handler file that mutates settings must parse --global.
	const isCommandish = /command|complete|handler/i.test(normalized) || /\bregisterCommand\b/.test(content);
	const mutatesConfig = /\bsaveConfig\s*\(|\bconfig\.\w+\s*=/i.test(content);
	if (isCommandish && mutatesConfig && !GLOBAL_FLAG_PATTERN.test(content)) {
		return [
			{
				problem: "Setting-changing command handler does not parse the --global flag.",
				hint: "Accept a trailing --global on every setting command: global → persist to ~/.pi/agent/<plugin>.json (all sessions); without it → <cwd>/.pi/<plugin>.json (project). Reference: pi-decision-gate/src/config.ts saveConfig(cfg, isGlobal, cwd).",
			},
		];
	}

	// 2. A config module that writes project config must also offer the global write.
	const isConfigModule = /(^|\/)config\.(ts|js)$/.test(normalized);
	if (isConfigModule) {
		const writesProject = /\.pi["'`/\\]/.test(content) && /writeFileSync|appendFileSync/.test(content);
		const writesGlobal = /agent["'`/\\]|homedir\(\)/i.test(content);
		if (writesProject && !writesGlobal) {
			return [
				{
					problem: "Config module writes project .pi/ config but never the global ~/.pi/agent/ one.",
					hint: "Every plugin must support global behavior for all sessions: saveConfig(cfg, global, cwd) writes the global file when global=true. Reference: pi-decision-gate/src/config.ts.",
				},
			];
		}
		// 3. loadConfig must cascade global → project.
		const hasLoader = /loadConfig\s*\(/.test(content);
		const cascades = /GLOBAL_CONFIG_FILE|\.pi\/agent|homedir\(\)/i.test(content) && content.includes("cwd");
		if (hasLoader && writesProject && !cascades) {
			return [
				{
					problem: "loadConfig does not merge the global config before the project one.",
					hint: "Cascade: defaults ← ~/.pi/agent/<plugin>.json ← <cwd>/.pi/<plugin>.json (project wins). Reference: pi-decision-gate/src/config.ts loadConfig(cwd).",
				},
			];
		}
	}

	void fileBase;
	return [];
}
