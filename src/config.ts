import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DEFAULT_CONFIG, type PluginDevConfig } from "./types.js";

const CONFIG_PATH = join(homedir(), ".pi", "agent", "pi-plugin-dev.json");

export function loadConfig(): PluginDevConfig {
	try {
		if (existsSync(CONFIG_PATH)) {
			const parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
			return {
				hud: Boolean(parsed?.hud ?? DEFAULT_CONFIG.hud),
				hudDelayMs: Number(parsed?.hudDelayMs ?? DEFAULT_CONFIG.hudDelayMs),
				widget: Boolean(parsed?.widget ?? DEFAULT_CONFIG.widget),
				transcriptCard: Boolean(parsed?.transcriptCard ?? DEFAULT_CONFIG.transcriptCard),
				statusline: Boolean(parsed?.statusline ?? DEFAULT_CONFIG.statusline),
				strictAudit: Boolean(parsed?.strictAudit ?? DEFAULT_CONFIG.strictAudit),
				installOffer: Boolean(parsed?.installOffer ?? DEFAULT_CONFIG.installOffer),
				maxFileLines: Number.isFinite(Number(parsed?.maxFileLines)) && Number(parsed?.maxFileLines) > 0
					? Number(parsed?.maxFileLines)
					: DEFAULT_CONFIG.maxFileLines,
			};
		}
	} catch {
		// Non-fatal fallback
	}
	return { ...DEFAULT_CONFIG };
}

export function saveConfig(cfg: PluginDevConfig): void {
	try {
		mkdirSync(dirname(CONFIG_PATH), { recursive: true });
		writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n", "utf8");
	} catch (err) {
		console.error("pi-plugin-dev: failed to save config:", err);
	}
}
