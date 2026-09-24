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
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createCompletions } from "./src/completions.js";
import { collectDoctorReport, formatDoctorReport } from "./src/doctor.js";
import { loadConfig, saveConfig } from "./src/config.js";
import { checkFileLines, formatLineLimitCheck } from "./src/line-monitor.js";
import {
	buildMcpGateReason,
	buildSkillGateReason,
	isGatedEditTarget,
	toolMatchesAny,
} from "./src/source-gate.js";
import {
	findPluginCandidate,
	installedRepoKeys,
	isGitCommitCommand,
	isGitPushCommand,
	readSettingsPackages,
	resolveCandidateDir,
	runInstallAsync,
	settingsPaths,
	type InstallScope,
	type PluginCandidate,
} from "./src/install-offer.js";
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

	/** `bash` command per tool call, so an end event can tell a commit from a push. */
	const pendingBash = new Map<string, string>();
	/** Checkouts committed in this session — a push of older commits must not offer. */
	const committedDirs = new Set<string>();
	/** Push-verified Pi plugins waiting for the install offer. */
	const installCandidates = new Map<string, PluginCandidate>();
	/** Repos already offered this session, so the user is asked at most once. */
	const offeredRepos = new Set<string>();

	/**
	 * A successful `git commit` marks the checkout; a successful `git push` of a
	 * checkout committed in this session collects an install candidate.
	 */
	const noteGitActivity = (command: string, sessionCwd: string): void => {
		if (!config.installOffer) return;
		const dir = resolveCandidateDir(command, sessionCwd);
		if (isGitCommitCommand(command)) committedDirs.add(dir);
		if (!isGitPushCommand(command)) return;
		if (!committedDirs.has(dir)) return;
		const candidate = findPluginCandidate(command, sessionCwd);
		if (candidate) installCandidates.set(candidate.repoKey, candidate);
	};

	/**
	 * Offer the pending installs once the agent has settled.
	 *
	 * Deliberately at `agent_settled` rather than inside `tool_execution_end`: a
	 * dialog there would sit between a tool result and the model, and blocking the
	 * turn on a user answer is exactly what settles are for.
	 */
	const offerPendingInstalls = async (ctx: ExtensionContext): Promise<void> => {
		if (!config.installOffer || !ctx.hasUI || installCandidates.size === 0) return;

		const installed = installedRepoKeys(readSettingsPackages(settingsPaths(ctx.cwd)));
		for (const [key, candidate] of [...installCandidates]) {
			installCandidates.delete(key);
			if (installed.has(key) || offeredRepos.has(key)) continue;
			offeredRepos.add(key);

			const choice = await ctx.ui.select(`Instalovat ${candidate.name} z GitHubu?`, [
				`Globálně — ${candidate.source}`,
				"Projekt — .pi/settings.json",
				"Teď ne",
			]);
			if (choice === undefined || choice.startsWith("Teď ne")) continue;
			const scope: InstallScope = choice.startsWith("Projekt") ? "project" : "global";

			ctx.ui.setStatus("pi-plugin-dev", `📦 Instaluji ${candidate.name}…`);
			const result = await runInstallAsync(candidate.source, scope, ctx.cwd);
			if (result.ok) {
				ctx.ui.notify(
					`📦 ${candidate.name} nainstalován z ${candidate.source} (${scope}). Restart Pi (nebo /reload) ho načte.`,
					"info",
				);
			} else {
				ctx.ui.notify(
					`Instalace selhala. Spusť ručně: pi install ${candidate.source}${scope === "project" ? " --local" : ""}\n${result.output}`,
					"error",
				);
			}
		}
	};

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

	// 1b. Source file line limit — prompt guideline + edit/write rejection
	track(pi.on("before_agent_start", (event) => {
		if (!event.systemPromptOptions?.promptGuidelines) return;
		event.systemPromptOptions.promptGuidelines.push(
			`SOURCE FILE LENGTH LIMIT: Source code files (.ts, .js, .rs, .go, .py, …) must stay at or below ${config.maxFileLines} lines ` +
				`(soft target ${Math.floor(config.maxFileLines * 0.75)}). If an edit or write is rejected with '[Line limit exceeded]', ` +
				"do NOT retry the same file unchanged — extract cohesive sections (classes, function groups, constants, types) " +
				"into new modules in the same folder and import them, then re-run the edit.",
		);
		event.systemPromptOptions.promptGuidelines.push(
			"CONSULT BEFORE EDIT (ENFORCED): edit/write calls on source code files are rejected until the required " +
				"sources have been consulted this session — the relevant Pi skill entry point (SKILL.md) has been read, " +
				"and, when configured, the required MCP tool(s) (e.g. kb_search) have been called. If an edit is rejected " +
				"with 'SKILL BEFORE EDIT' or 'CONSULT BEFORE EDIT', perform the required consultation first, then retry.",
		);
	}));

	/** MCP tool-name patterns satisfied this session (consult gate state). */
	const satisfiedMcpTools = new Set<string>();

	// 1c. Consult-before-edit gates — skill activation + required MCP tool calls
	track(pi.on("tool_call", (event) => {
		const rawName = event.toolName || "";
		const required = config.requiredMcpToolsBeforeEdit ?? [];
		if (required.length > 0 && toolMatchesAny(rawName, required)) {
			// Record satisfaction before any early return below.
			for (const pattern of required) {
				if (toolMatchesAny(rawName, [pattern])) satisfiedMcpTools.add(pattern);
			}
		}

		const baseToolName = rawName.includes("__") ? rawName.split("__").pop()! : rawName;
		if (baseToolName !== "edit" && baseToolName !== "write") return;

		const targetPath = (event.input as { path?: string } | undefined)?.path;
		if (!targetPath) return;
		if (!isGatedEditTarget(path.resolve(targetPath))) return;

		if (config.enforceSkillBeforeEdit && !tracker.getState().activeSkill) {
			return { block: true, reason: buildSkillGateReason(targetPath) };
		}
		const missing = required.filter((p) => !satisfiedMcpTools.has(p));
		if (missing.length > 0) {
			return { block: true, reason: buildMcpGateReason(missing) };
		}
	}));

	track(pi.on("tool_result", (event) => {
		const rawName = event.toolName || "";
		const baseToolName = rawName.includes("__") ? rawName.split("__").pop()! : rawName;
		if (baseToolName !== "edit" && baseToolName !== "write") return;
		if (event.isError) return;

		const targetPath = (event.input as { path?: string } | undefined)?.path;
		if (!targetPath) return;

		const check = checkFileLines(path.resolve(targetPath), config.maxFileLines);
		const notice = formatLineLimitCheck(check);
		if (!notice) return;

		if (check.level === "exceeded") {
			return {
				content: [...event.content, { type: "text", text: notice }],
				isError: true,
			};
		}
		return { content: [...event.content, { type: "text", text: notice }] };
	}));

	// 2. Lifecycle Listeners
	track(pi.on("session_start", async (_event, ctx: ExtensionContext) => {
		config = loadConfig();
		tracker.reset();
		satisfiedMcpTools.clear();
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
			pendingBash.set(event.toolCallId, params.command);
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
		const command = pendingBash.get(event.toolCallId);
		if (command !== undefined) {
			pendingBash.delete(event.toolCallId);
			if (event.isError !== true) noteGitActivity(command, ctx.cwd);
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

		await offerPendingInstalls(ctx);
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

			if (sub === "install") {
				config.installOffer = val !== "off";
				saveConfig(config);
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