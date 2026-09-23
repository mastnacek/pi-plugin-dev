/**
 * pi-plugin-dev — Extension & Skill Visualizer & Compliance Auditor.
 *
 * Provides real-time visibility into the agent's actions when following skills,
 * specifically auditing adherence to Pi package invariants:
 *   - Trailing Space Contract on command autocompletions
 *   - TypeBox StringEnum schema rule (Google Gemini compatibility)
 *   - Error throwing contract (throw new Error vs returning objects)
 *   - PeerDependencies isolation (no core package leaks)
 *   - Clean event listener unsubscribe cleanup on session_shutdown
 *
 * Visual surfaces:
 *   1. Floating HUD Overlay (ctx.ui.custom with overlay: true)
 *   2. Docked Editor Widget (ctx.ui.setWidget above editor)
 *   3. Durable Transcript Card (pi.appendEntry + registerEntryRenderer)
 *   4. Statusline Badge (ctx.ui.setStatus)
 *
 * Controls: /plugin-dev hud|widget|card|status|reset|help
 */

import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { loadConfig, saveConfig } from "./src/config.js";
import { SkillTracker } from "./src/tracker.js";
import type { PluginDevConfig, SkillExecutionState } from "./src/types.js";
import {
	renderSkillAuditEntry,
	SKILL_AUDIT_ENTRY_TYPE,
	type SkillAuditPayload,
} from "./src/visuals/entry.js";
import { closeSkillHud, showSkillHud, updateSkillHud } from "./src/visuals/hud.js";
import { clearSkillWidget, updateSkillWidget } from "./src/visuals/widget.js";

const RUNTIME_ENTRY_TYPE = "pi-plugin-dev:runtime";

/** Shared event-bus channel; consumed by other extensions (e.g. pi-sidebar). */
export const SKILL_STATE_CHANNEL = "pi-plugin-dev:state";

/** Flat, render-friendly projection of SkillExecutionState (Map/Set → arrays). */
export interface PublishedSkillState {
	live: boolean;
	activeSkill?: string;
	references: Array<{ name: string; summary: string }>;
	actions: Array<{ type: string; target: string; summary: string; timestamp: number }>;
	compliance: Array<{ rule: string; label: string; status: string; details: string }>;
	inspectedCount: number;
	modifiedCount: number;
	startTime: number;
	lastUpdateTime: number;
	inTurn: boolean;
	turnCount: number;
}

const COMMAND_DOCS: Record<string, string> = {
	status: "Zobrazit aktuální stav monitoringu a scorecard pravidel",
	hud: "Přepnout plovoucí HUD overlay (on | off)",
	widget: "Přepnout dokovaný widget nad editorem (on | off)",
	card: "Přepnout ukládání souhrnných karet do chatu (on | off)",
	reset: "Vynulovat počítadla a načtené reference aktuálního běhu",
	help: "Zobrazit podrobnou nápovědu k příkazu /plugin-dev",
};

export default function (pi: ExtensionAPI): void {
	let config: PluginDevConfig = loadConfig();
	const tracker = new SkillTracker();

	/**
	 * Publish the tracker snapshot on the shared event bus so other extensions
	 * (pi-sidebar's Skills tab) can render the same numbers without duplicating
	 * skill detection. Best-effort: telemetry must never break the agent loop.
	 */
	const publishSkillState = (st: SkillExecutionState): void => {
		try {
			const payload: PublishedSkillState = {
				live: true,
				activeSkill: st.activeSkill,
				references: Array.from(st.references.values()).map((r) => ({
					name: r.name,
					summary: r.summary,
				})),
				actions: st.actions.slice(-8).map((a) => ({
					type: a.type,
					target: a.target,
					summary: a.summary,
					timestamp: a.timestamp,
				})),
				compliance: st.compliance.map((c) => ({
					rule: c.rule,
					label: c.label,
					status: c.status,
					details: c.details,
				})),
				inspectedCount: st.inspectedFiles.size,
				modifiedCount: st.modifiedFiles.size,
				startTime: st.startTime,
				lastUpdateTime: st.lastUpdateTime,
				inTurn: st.inTurn,
				turnCount: st.turnCount,
			};
			pi.events.emit(SKILL_STATE_CHANNEL, payload);
		} catch {
			// Non-fatal: the bus is optional.
		}
	};

	// 1. Durable Transcript Card Renderer
	pi.registerEntryRenderer<SkillAuditPayload>(
		SKILL_AUDIT_ENTRY_TYPE,
		(entry, { expanded }, theme) => renderSkillAuditEntry(entry.data, expanded, theme),
	);

	// 2. Lifecycle Listeners
	pi.on("session_start", async (_event, ctx: ExtensionContext) => {
		config = loadConfig();
		tracker.reset();
		publishSkillState(tracker.getState());
		closeSkillHud();
		clearSkillWidget(ctx);

		// Restore runtime state from session entry (branch-aware, survives /tree & compact)
		for (const entry of ctx.sessionManager.getEntries()) {
			if (entry.type === "custom" && entry.customType === RUNTIME_ENTRY_TYPE) {
				const data = entry.data as Partial<PluginDevConfig> | undefined;
				if (data && typeof data.hud === "boolean") config.hud = data.hud;
				if (data && typeof data.widget === "boolean") config.widget = data.widget;
				if (data && typeof data.transcriptCard === "boolean") config.transcriptCard = data.transcriptCard;
				if (data && typeof data.statusline === "boolean") config.statusline = data.statusline;
				break; // Last one wins
			}
		}

		if (ctx.hasUI && config.statusline) {
			ctx.ui.setStatus("pi-plugin-dev", undefined);
		}
	});

	pi.on("turn_start", async (_event, _ctx: ExtensionContext) => {
		tracker.startTurn();
	});

	pi.on("tool_execution_start", async (event, ctx: ExtensionContext) => {
		const params = (event.args && typeof event.args === "object")
			? (event.args as Record<string, unknown>)
			: {};

		tracker.onToolStart(event.toolName, params);
		const st = tracker.getState();
		publishSkillState(st);

		if (!ctx.hasUI) return;

		// Update Statusline
		if (config.statusline && (st.activeSkill || st.references.size > 0)) {
			const passed = st.compliance.filter((c) => c.status === "pass").length;
			const total = st.compliance.length;
			const comp = total > 0 ? ` · ${passed}/${total} [${Math.round((passed / total) * 100)}%]` : "";
			ctx.ui.setStatus(
				"pi-plugin-dev",
				`🎯 ${st.activeSkill ?? "skill"}: ${st.references.size} refs${comp}`,
			);
		}

		// Update / Show Floating HUD
		if (config.hud && (st.activeSkill || st.references.size > 0)) {
			showSkillHud(ctx, st, { delayMs: config.hudDelayMs });
		}

		// Update Above-Editor Widget
		if (config.widget && (st.activeSkill || st.references.size > 0)) {
			updateSkillWidget(ctx, ctx.ui.theme, st);
		}
	});

	pi.on("tool_execution_end", async (event, ctx: ExtensionContext) => {
		tracker.onToolEnd(event.toolName);
		const st = tracker.getState();
		publishSkillState(st);

		if (!ctx.hasUI) return;
		if (config.hud) updateSkillHud(st);
		if (config.widget) updateSkillWidget(ctx, ctx.ui.theme, st);
	});

	pi.on("turn_end", (_event, ctx: ExtensionContext) => {
		tracker.endTurn();

		// Push the settled state into the visuals so the HUD's auto-dismiss
		// timer sees `inTurn: false` and can actually fire.
		const st = tracker.getState();
		publishSkillState(st);
		if (!ctx.hasUI) return;
		if (config.hud) updateSkillHud(st);
		if (config.widget) updateSkillWidget(ctx, ctx.ui.theme, st);
	});

	pi.on("agent_settled", async (_event, ctx: ExtensionContext) => {
		const st = tracker.getState();
		publishSkillState(st);

		// If a skill was active and performed actions, record durable audit card
		if (st.activeSkill && (st.references.size > 0 || st.compliance.length > 0)) {
			if (config.transcriptCard) {
				const payload: SkillAuditPayload = {
					skillName: st.activeSkill,
					references: Array.from(st.references.values()).map((r) => ({
						name: r.name,
						summary: r.summary,
					})),
					compliance: st.compliance,
					inspectedCount: st.inspectedFiles.size,
					modifiedCount: st.modifiedFiles.size,
					durationMs: Date.now() - st.startTime,
				};
				pi.appendEntry(SKILL_AUDIT_ENTRY_TYPE, payload);
			}

			if (ctx.hasUI && config.statusline) {
				const passed = st.compliance.filter((c) => c.status === "pass").length;
				const total = st.compliance.length;
				const badge = total > 0 ? ` · ${passed}/${total} [✓]` : " · complete";
				ctx.ui.setStatus("pi-plugin-dev", `🎯 ${st.activeSkill}${badge}`);
			}
		}
	});

	pi.on("session_shutdown", async () => {
		closeSkillHud();
		try {
			pi.events.emit(SKILL_STATE_CHANNEL, { live: false });
		} catch {
			// Non-fatal: the bus is optional.
		}
	});


	// 3. Command: /plugin-dev
	pi.registerCommand("plugin-dev", {
		description: "Ovládání vizualizéru a auditoru plnění pravidel skillů (HUD, widget, audit)",
		getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
			const tokens = prefix.split(/\s+/).filter(Boolean);
			const trailingSpace = /\s$/.test(prefix);
			const normalizedPrefix = tokens.join(" ").toLowerCase();

			// 2nd-level parameters
			if (tokens.length > 1 || (trailingSpace && tokens.length === 1)) {
				const cmd = tokens[0]?.toLowerCase();

				if (cmd === "hud" || cmd === "widget" || cmd === "card") {
					const items = [
						{
							value: `${cmd} on`,
							label: "on",
							description: `Zapnout ${cmd.toUpperCase()}`,
						},
						{
							value: `${cmd} off`,
							label: "off",
							description: `Vypnout ${cmd.toUpperCase()}`,
						},
					];
					const filtered = items.filter((i) => i.value.toLowerCase().startsWith(normalizedPrefix));
					return filtered.length > 0 ? filtered : null;
				}

				return null;
			}

			// 1st-level subcommands with Trailing Space Contract
			const typed = (tokens[0] ?? "").toLowerCase();
			const NON_TERMINAL = new Set(["hud", "widget", "card"]);
			const items: AutocompleteItem[] = [];

			for (const [key, description] of Object.entries(COMMAND_DOCS)) {
				if (key.toLowerCase().startsWith(typed)) {
					const hasNext = NON_TERMINAL.has(key);
					items.push({
						value: hasNext ? `${key} ` : key,
						label: key,
						description,
					});
				}
			}

			return items.length > 0 ? items : null;
		},

		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const tokens = args.trim().split(/\s+/).filter(Boolean);
			const sub = (tokens[0] ?? "").toLowerCase();
			const val = (tokens[1] ?? "").toLowerCase();

			if (!sub || sub === "help" || sub === "-h" || sub === "--help") {
				const help = [
					"# /plugin-dev — Vizualizér & Auditor plnění skillů",
					"",
					"Sleduje kroky agenta řízeného skillem v reálném čase a audituje dodržování",
					"architektonických pravidel (Trailing Space Contract, StringEnum, ErrorThrow).",
					"",
					"Příkazy:",
					"  /plugin-dev status       — Zobrazit aktuální stav sledování a scorecard pravidel",
					"  /plugin-dev hud on|off   — Plovoucí HUD overlay v pravém horním rohu",
					"  /plugin-dev widget on|off— Dokovaný stavový widget nad editorem",
					"  /plugin-dev card on|off  — Souhrnná karta auditu do chatu po dokončení",
					"  /plugin-dev reset        — Vynulovat historii a načtené reference",
					"  /plugin-dev help         — Tato nápověda",
					"",
					`Aktivní stav: HUD=${config.hud ? "ON" : "OFF"} | Widget=${config.widget ? "ON" : "OFF"} | Card=${config.transcriptCard ? "ON" : "OFF"}`,
				].join("\n");
				ctx.ui.notify(help, "info");
				return;
			}

			if (sub === "status") {
				const st = tracker.getState();
				const passed = st.compliance.filter((c) => c.status === "pass").length;
				const total = st.compliance.length;
				const score = total > 0 ? `${passed}/${total} [${Math.round((passed / total) * 100)}%]` : "žádné kontroly neproběhly";

				const lines = [
					"🎯 [pi-plugin-dev — Auditní zpráva]",
					`- Aktivní skill: ${st.activeSkill ?? "žádný"}`,
					`- Načtené reference (${st.references.size}): ${Array.from(st.references.keys()).join(", ") || "žádné"}`,
					`- Prohlédnuté soubory: ${st.inspectedFiles.size}`,
					`- Modifikované soubory: ${st.modifiedFiles.size}`,
					`- Skóre shody s pravidly: ${score}`,
				];

				if (st.compliance.length > 0) {
					lines.push("", "Pravidla:");
					for (const c of st.compliance) {
						lines.push(`  ${c.status === "pass" ? "✓" : "✗"} [${c.rule}] ${c.label}: ${c.details}`);
					}
				}

				ctx.ui.notify(lines.join("\n"), "info");
				return;
			}

			if (sub === "reset") {
				tracker.reset();
				closeSkillHud();
				clearSkillWidget(ctx);
				ctx.ui.notify("Stav sledování byl vynulován.", "info");
				return;
			}

			if (sub === "hud") {
				config.hud = val !== "off";
				saveConfig(config);
				pi.appendEntry(RUNTIME_ENTRY_TYPE, config);
				if (!config.hud) closeSkillHud();
				ctx.ui.notify(`Plovoucí HUD: ${config.hud ? "ZAPNUTO (ON)" : "VYPNUTO (OFF)"}`, "info");
				return;
			}

			if (sub === "widget") {
				config.widget = val !== "off";
				saveConfig(config);
				pi.appendEntry(RUNTIME_ENTRY_TYPE, config);
				if (!config.widget) clearSkillWidget(ctx);
				ctx.ui.notify(`Dokovaný widget: ${config.widget ? "ZAPNUTO (ON)" : "VYPNUTO (OFF)"}`, "info");
				return;
			}

			if (sub === "card") {
				config.transcriptCard = val !== "off";
				saveConfig(config);
				pi.appendEntry(RUNTIME_ENTRY_TYPE, config);
				ctx.ui.notify(`Souhrnná karta do chatu: ${config.transcriptCard ? "ZAPNUTO (ON)" : "VYPNUTO (OFF)"}`, "info");
				return;
			}

			ctx.ui.notify(`Neznámý parametr "${sub}". Použijte: /plugin-dev help`, "warning");
		},
	});
}