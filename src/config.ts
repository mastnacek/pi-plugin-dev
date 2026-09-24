import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DEFAULT_CONFIG, type PluginDevConfig } from "./types.js";

/** Global config — applies to ALL sessions. */
const GLOBAL_CONFIG_PATH = join(homedir(), ".pi", "agent", "pi-plugin-dev.json");

/** Project config — per-checkout override. */
export const PROJECT_CONFIG_PATH = join(".pi", "pi-plugin-dev.json");

function sanitize(parsed: unknown): PluginDevConfig {
	const p = (parsed ?? {}) as Partial<PluginDevConfig>;
	return {
		hud: Boolean(p.hud ?? DEFAULT_CONFIG.hud),
		hudDelayMs: Number.isFinite(Number(p.hudDelayMs)) && Number(p.hudDelayMs) > 0
			? Number(p.hudDelayMs)
			: DEFAULT_CONFIG.hudDelayMs,
		widget: Boolean(p.widget ?? DEFAULT_CONFIG.widget),
		transcriptCard: Boolean(p.transcriptCard ?? DEFAULT_CONFIG.transcriptCard),
		statusline: Boolean(p.statusline ?? DEFAULT_CONFIG.statusline),
		strictAudit: Boolean(p.strictAudit ?? DEFAULT_CONFIG.strictAudit),
		installOffer: Boolean(p.installOffer ?? DEFAULT_CONFIG.installOffer),
		maxFileLines: Number.isFinite(Number(p.maxFileLines)) && Number(p.maxFileLines) > 0
			? Number(p.maxFileLines)
			: DEFAULT_CONFIG.maxFileLines,
		enforceSkillBeforeEdit: Boolean(p.enforceSkillBeforeEdit ?? DEFAULT_CONFIG.enforceSkillBeforeEdit),
		requiredMcpToolsBeforeEdit: Array.isArray(p.requiredMcpToolsBeforeEdit)
			? (p.requiredMcpToolsBeforeEdit as unknown[]).filter((v): v is string => typeof v === "string")
			: DEFAULT_CONFIG.requiredMcpToolsBeforeEdit,
	};
}

/**
 * Config cascade: defaults ← global (~/.pi/agent/pi-plugin-dev.json) ←
 * project (<cwd>/.pi/pi-plugin-dev.json). Project wins.
 */
export function loadConfig(cwd?: string): PluginDevConfig {
	let merged: PluginDevConfig = { ...DEFAULT_CONFIG };

	try {
		if (existsSync(GLOBAL_CONFIG_PATH)) {
			merged = sanitize({ ...merged, ...JSON.parse(readFileSync(GLOBAL_CONFIG_PATH, "utf8")) });
		}
	} catch {
		// Non-fatal fallback
	}

	if (cwd) {
		try {
			const projectPath = join(cwd, PROJECT_CONFIG_PATH);
			if (existsSync(projectPath)) {
				merged = sanitize({ ...merged, ...JSON.parse(readFileSync(projectPath, "utf8")) });
			}
		} catch {
			// Non-fatal fallback
		}
	}

	return merged;
}

/**
 * Persist config. `global=true` writes the user-wide file (all sessions);
 * otherwise the project override at <cwd>/.pi/pi-plugin-dev.json.
 * Reference pattern: pi-decision-gate saveConfig(cfg, isGlobal, cwd).
 */
export function saveConfig(cfg: PluginDevConfig, global = false, cwd?: string): void {
	try {
		if (global) {
			mkdirSync(dirname(GLOBAL_CONFIG_PATH), { recursive: true });
			writeFileSync(GLOBAL_CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n", "utf8");
		} else {
			const projectDir = cwd ? join(cwd, ".pi") : join(".pi");
			mkdirSync(projectDir, { recursive: true });
			writeFileSync(
				join(projectDir, "pi-plugin-dev.json"),
				JSON.stringify(cfg, null, 2) + "\n",
				"utf8",
			);
		}
	} catch (err) {
		console.error("pi-plugin-dev: failed to save config:", err);
	}
}
