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
 * Enforcement hooks (line limit, consult gates) live in src/hooks/.
 *
 * Controls: /plugin-dev hud|widget|card|status|reset|help
 */

import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { fileURLToPath } from "node:url";
import { createCompletions } from "./src/completions.js";
import { collectDoctorReport, formatDoctorReport } from "./src/doctor.js";
import { loadConfig, saveConfig } from "./src/config.js";
import { registerGuardHooks } from "./src/hooks/guard-hooks.js";
import { createInstallOfferHook } from "./src/hooks/install-offer-hook.js";
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

export default function (pi: ExtensionAPI): void {
	let config: PluginDevConfig = loadConfig();
	const tracker = new SkillTracker();

	/** Unsubscribers from every `pi.on()`; drained on session_shutdown. */
	const unsubscribers: Array<() => void> = [];

	/**
	 * Retain a `pi.on()` return value so it can be released on shutdown.
	 *
	 * The result is typed `unknown` on purpose: older engine versions declared
	 * `pi.on()` as `void`, so the value is only stored when it is callable.
	 */
	const track = (result: unknown): void => {
		if (typeof result === "function") unsubscribers.push(result as () => void);
	};

	/**
	 * `ctx.ui.custom()` and `ctx.ui.onTerminalInput()` need a real terminal:
	 * in RPC mode `hasUI` is still true but `custom()` resolves to `undefined`
	 * and `onTerminalInput()` is a no-op, so the HUD must not be attempted there.
	 */
	const canOverlay = (ctx: ExtensionContext): boolean => ctx.mode === "tui";

	// Enforcement hooks: line limit + consult gates; install offer after push.
	const guardHooks = registerGuardHooks(pi, () => config, tracker, track);
	const installOffer = createInstallOfferHook(() => config);

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
	track(pi.on("session_start", async (_event, ctx: ExtensionContext) => {
		config = loadConfig();
		tracker.reset();
		guardHooks.reset();
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
	}));

	track(pi.on("turn_start", async (_event, _ctx: ExtensionContext) => {
		tracker.startTurn();
	}));

	track(pi.on("tool_execution_start", async (event, ctx: ExtensionContext) => {
		const params = (event.args && typeof event.args === "object")
			? (event.args as Record<string, unknown>)
			: {};

		if (event.toolName === "bash" && typeof params.command === "string") {
			installOffer.trackBash(event.toolCallId, params.command);
		}

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
		if (canOverlay(ctx) && config.hud && (st.activeSkill || st.references.size > 0)) {
			showSkillHud(ctx, st, { delayMs: config.hudDelayMs });
		}

		// Update Above-Editor Widget
		if (config.widget && (st.activeSkill || st.references.size > 0)) {
			updateSkillWidget(ctx, st);
		}
	}));

	track(pi.on("tool_execution_end", async (event, ctx: ExtensionContext) => {
		const command = installOffer.takeBash(event.toolCallId);
		if (command !== undefined && event.isError !== true) {
			installOffer.noteGitActivity(command, ctx.cwd);
		}

		tracker.onToolEnd(event.toolName);
		const st = tracker.getState();
		publishSkillState(st);

		if (!ctx.hasUI) return;
		if (canOverlay(ctx) && config.hud) updateSkillHud(st);
		if (config.widget) updateSkillWidget(ctx, st);
	}));

	track(pi.on("turn_end", (_event, ctx: ExtensionContext) => {
		tracker.endTurn();

		// Push the settled state into the visuals so the HUD's auto-dismiss
		// timer sees `inTurn: false` and can actually fire.
		const st = tracker.getState();
		publishSkillState(st);
		if (!ctx.hasUI) return;
		if (canOverlay(ctx) && config.hud) updateSkillHud(st);
		if (config.widget) updateSkillWidget(ctx, st);
	}));

	track(pi.on("agent_settled", async (_event, ctx: ExtensionContext) => {
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

		await installOffer.offerPendingInstalls(ctx);
	}));

	pi.on("session_shutdown", async () => {
		closeSkillHud();
		try {
			pi.events.emit(SKILL_STATE_CHANNEL, { live: false });
		} catch {
			// Non-fatal: the bus is optional.
		}
		// Release every listener so /reload and session replacement cannot
		// accumulate duplicates (AGENTS §5, skill §4).
		while (unsubscribers.length > 0) {
			unsubscribers.pop()?.();
		}
	});


	// 3. Command: /plugin-dev
	pi.registerCommand("plugin-dev", {
		description: "Ovládání vizualizéru a auditoru plnění pravidel skillů (HUD, widget, audit)",
		getArgumentCompletions: createCompletions(() => config),

		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const tokens = args.trim().split(/\s+/).filter(Boolean);
			// --global suffix on any setting subcommand persists user-wide
			// (~/.pi/agent/pi-plugin-dev.json); without it the project
			// override at <cwd>/.pi/pi-plugin-dev.json is written.
			const isGlobal = tokens.some((t) => t.toLowerCase() === "--global");
			const cleanTokens = tokens.filter((t) => t.toLowerCase() !== "--global");
			const sub = (cleanTokens[0] ?? "").toLowerCase();
			const val = (cleanTokens[1] ?? "").toLowerCase();

			if (!sub || sub === "help" || sub === "-h" || sub === "--help") {
				const help = [
					"# /plugin-dev — Vizualizér & Auditor plnění skillů",
					"",
					"Sleduje kroky agenta řízeného skillem v reálném čase a audituje dodržování",
					"architektonických pravidel (Trailing Space Contract, StringEnum, ErrorThrow).",
					"",
					"Příkazy:",
					"  /plugin-dev status       — Zobrazit aktuální stav sledování a scorecard pravidel",
					"  /plugin-dev doctor       — Engine, instalace, skill manifest, self-audit",
					"  /plugin-dev hud on|off   — Plovoucí HUD overlay v pravém horním rohu",
					"  /plugin-dev widget on|off— Dokovaný stavový widget nad editorem",
					"  /plugin-dev card on|off  — Souhrnná karta auditu do chatu po dokončení",
					"  /plugin-dev install on|off — Nabízet instalaci z GitHubu po commit+push",
					"  /plugin-dev reset        — Vynulovat historii a načtené reference",
					"  /plugin-dev help         — Tato nápověda",
					"",
					`Aktivní stav: HUD=${config.hud ? "ON" : "OFF"} | Widget=${config.widget ? "ON" : "OFF"} | Card=${config.transcriptCard ? "ON" : "OFF"} | Install=${config.installOffer ? "ON" : "OFF"}`,
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

			if (sub === "doctor") {
				const root = fileURLToPath(new URL(".", import.meta.url));
				let message: string;
				try {
					message = formatDoctorReport(collectDoctorReport(root));
				} catch (error) {
					message = `🩺 doctor selhal: ${error instanceof Error ? error.message : String(error)}`;
				}
				ctx.ui.notify(message, "info");
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
				saveConfig(config, isGlobal, ctx.cwd);
				pi.appendEntry(RUNTIME_ENTRY_TYPE, config);
				if (!config.hud) closeSkillHud();
				ctx.ui.notify(`Plovoucí HUD: ${config.hud ? "ZAPNUTO (ON)" : "VYPNUTO (OFF)"}`, "info");
				return;
			}

			if (sub === "widget") {
				config.widget = val !== "off";
				saveConfig(config, isGlobal, ctx.cwd);
				pi.appendEntry(RUNTIME_ENTRY_TYPE, config);
				if (!config.widget) clearSkillWidget(ctx);
				ctx.ui.notify(`Dokovaný widget: ${config.widget ? "ZAPNUTO (ON)" : "VYPNUTO (OFF)"}`, "info");
				return;
			}

			if (sub === "card") {
				config.transcriptCard = val !== "off";
				saveConfig(config, isGlobal, ctx.cwd);
				pi.appendEntry(RUNTIME_ENTRY_TYPE, config);
				ctx.ui.notify(`Souhrnná karta do chatu: ${config.transcriptCard ? "ZAPNUTO (ON)" : "VYPNUTO (OFF)"}`, "info");
				return;
			}

			if (sub === "install") {
				config.installOffer = val !== "off";
				saveConfig(config, isGlobal, ctx.cwd);
				pi.appendEntry(RUNTIME_ENTRY_TYPE, config);
				ctx.ui.notify(
					`Nabídka instalace z GitHubu po commit+push: ${config.installOffer ? "ZAPNUTO (ON)" : "VYPNUTO (OFF)"}`,
					"info",
				);
				return;
			}

			ctx.ui.notify(`Neznámý parametr "${sub}". Použijte: /plugin-dev help`, "warning");
		},
	});
}
