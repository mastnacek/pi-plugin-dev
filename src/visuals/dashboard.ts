import type { Component, KeybindingsManager, TUI } from "@earendil-works/pi-tui";
import { matchesKey, visibleWidth } from "@earendil-works/pi-tui";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { PluginDevConfig, SkillExecutionState } from "../types.js";
import { collectDoctorReport } from "../doctor.js";
import { fitBorderedRow, fitLineToWidth } from "./tui-fit.js";

type TabId = "scorecard" | "invariants" | "config" | "doctor";

const TABS: Array<{ id: TabId; label: string; num: string }> = [
	{ id: "scorecard", label: "Scorecard", num: "1" },
	{ id: "invariants", label: "Invariants", num: "2" },
	{ id: "config", label: "Config", num: "3" },
	{ id: "doctor", label: "Doctor", num: "4" },
];

export interface DashboardOptions {
	onDone: () => void;
	requestRender: () => void;
}

export class SkillDashboardModal implements Component {
	private readonly theme: Theme;
	private readonly state: SkillExecutionState;
	private readonly config: PluginDevConfig;
	private readonly options: DashboardOptions;
	private activeTab: TabId = "scorecard";
	private cachedDoctorReport?: ReturnType<typeof collectDoctorReport>;

	constructor(
		theme: Theme,
		state: SkillExecutionState,
		config: PluginDevConfig,
		options: DashboardOptions,
	) {
		this.theme = theme;
		this.state = state;
		this.config = config;
		this.options = options;
	}

	invalidate(): void {
		// Re-evaluate on next frame
	}

	dispose(): void {
		// Clean up resources if any
	}

	handleInput(data: string): boolean {
		if (matchesKey(data, "escape") || matchesKey(data, "q") || matchesKey(data, "enter")) {
			this.options.onDone();
			return true;
		}

		if (matchesKey(data, "tab") || matchesKey(data, "right")) {
			const idx = TABS.findIndex((t) => t.id === this.activeTab);
			this.activeTab = TABS[(idx + 1) % TABS.length]!.id;
			this.options.requestRender();
			return true;
		}

		if (matchesKey(data, "left")) {
			const idx = TABS.findIndex((t) => t.id === this.activeTab);
			this.activeTab = TABS[(idx - 1 + TABS.length) % TABS.length]!.id;
			this.options.requestRender();
			return true;
		}

		if (matchesKey(data, "1")) {
			this.activeTab = "scorecard";
			this.options.requestRender();
			return true;
		}
		if (matchesKey(data, "2")) {
			this.activeTab = "invariants";
			this.options.requestRender();
			return true;
		}
		if (matchesKey(data, "3")) {
			this.activeTab = "config";
			this.options.requestRender();
			return true;
		}
		if (matchesKey(data, "4")) {
			this.activeTab = "doctor";
			this.options.requestRender();
			return true;
		}

		return false;
	}

	render(width: number): string[] {
		const th = this.theme;
		const totalWidth = Math.max(50, Math.min(width, 100));
		const innerWidth = totalWidth - 4; // ║ + 2 padding + ║

		const lines: string[] = [];
		const bTop = `╔═${"═".repeat(innerWidth + 2)}═╗`;
		const bSep = `╟─${"─".repeat(innerWidth + 2)}─╢`;
		const bBot = `╚═${"═".repeat(innerWidth + 2)}═╝`;

		const pad = (content: string) =>
			fitBorderedRow(content, innerWidth + 2, th.fg("accent", "║"), th.fg("accent", "║"), 1);

		lines.push(th.fg("accent", bTop));

		// Modal Title
		const title = th.fg("toolTitle", "🛠️ PI-PLUGIN-DEV · ARCHITECTURE & AUDIT DASHBOARD");
		lines.push(pad(title));

		// Tab Bar
		const tabItems = TABS.map((t) => {
			const active = t.id === this.activeTab;
			const tag = `[${t.num}. ${t.label}]`;
			return active ? th.fg("accent", tag) : th.fg("dim", tag);
		}).join("  ");
		lines.push(pad(tabItems));
		lines.push(th.fg("accent", bSep));

		// Tab Content
		if (this.activeTab === "scorecard") {
			this.renderScorecard(pad, th);
		} else if (this.activeTab === "invariants") {
			this.renderInvariants(pad, th);
		} else if (this.activeTab === "config") {
			this.renderConfig(pad, th);
		} else {
			this.renderDoctor(pad, th);
		}

		lines.push(th.fg("accent", bSep));

		// Footer Navigation Hints
		const footer = `${th.fg("dim", "[Tab/←/→]")} Next Tab  ${th.fg("dim", "[1-4]")} Direct  ${th.fg("dim", "[Esc/q]")} Close`;
		lines.push(pad(footer));
		lines.push(th.fg("accent", bBot));

		return lines;
	}

	private renderScorecard(pad: (s: string) => string, th: Theme): void {
		pad(th.fg("accent", "📊 Active Session Scorecard:"));
		pad(`  🎯 Skill: ${th.fg("toolTitle", this.state.activeSkill ?? "(No skill active)")}`);
		pad(`  📖 References Loaded: ${this.state.references.size}`);
		pad(`  📂 Files Inspected: ${this.state.inspectedFiles.size} · Modified: ${this.state.modifiedFiles.size}`);

		const total = this.state.compliance.length;
		const passed = this.state.compliance.filter((c) => c.status === "pass").length;
		const failed = this.state.compliance.filter((c) => c.status === "fail").length;
		const rate = total > 0 ? Math.round((passed / total) * 100) : 100;
		const rateColor = failed > 0 ? "error" : total > 0 ? "success" : "dim";

		pad(`  🛡️ Rule Compliance: ${th.fg(rateColor, `${passed}/${total} checks passed [${rate}%]`)}`);
		pad("");

		const lastAction = this.state.actions[this.state.actions.length - 1];
		const actionText = lastAction ? `${lastAction.type} ${lastAction.target} (${lastAction.summary})` : "idle";
		pad(`  ⚡ Last Agent Action: ${th.fg("text", actionText)}`);
	}

	private renderInvariants(pad: (s: string) => string, th: Theme): void {
		pad(th.fg("accent", "🛡️ Architectural Invariants & Compliance Rules:"));

		if (this.state.compliance.length === 0) {
			pad(th.fg("dim", "  (No compliance events recorded yet for this session)"));
			return;
		}

		for (const chk of this.state.compliance.slice(-8)) {
			const badge =
				chk.status === "pass"
					? th.fg("success", "[PASS]")
					: chk.status === "fail"
						? th.fg("error", "[FAIL]")
						: th.fg("warning", "[WARN]");
			pad(`  ${badge} ${th.fg("text", chk.label)}: ${th.fg("dim", chk.details)}`);
		}
	}

	private renderConfig(pad: (s: string) => string, th: Theme): void {
		pad(th.fg("accent", "⚙️ Active PluginDev Configuration Cascade:"));
		pad(`  • HUD Overlay: ${this.config.hud ? th.fg("success", "ON") : th.fg("dim", "OFF")}`);
		pad(`  • Docked Widget: ${this.config.widget ? th.fg("success", "ON") : th.fg("dim", "OFF")}`);
		pad(`  • Transcript Card: ${this.config.transcriptCard ? th.fg("success", "ON") : th.fg("dim", "OFF")}`);
		pad(`  • Statusline Badge: ${this.config.statusline ? th.fg("success", "ON") : th.fg("dim", "OFF")}`);
		pad(`  • Line Limit: max ${this.config.maxFileLines} lines/file`);
		pad(`  • Enforce Skill Before Edit: ${this.config.enforceSkillBeforeEdit ? th.fg("success", "YES") : th.fg("dim", "NO")}`);
		pad(`  • Required MCP Tools: ${this.config.requiredMcpToolsBeforeEdit.join(", ") || "(none)"}`);
	}

	private renderDoctor(pad: (s: string) => string, th: Theme): void {
		pad(th.fg("accent", "🩺 Doctor & Engine Health Summary:"));
		if (!this.cachedDoctorReport) {
			this.cachedDoctorReport = collectDoctorReport(process.cwd());
		}
		const r = this.cachedDoctorReport;
		for (const it of r.items.slice(0, 6)) {
			const badge =
				it.status === "pass"
					? th.fg("success", "[✓]")
					: it.status === "fail"
						? th.fg("error", "[✗]")
						: it.status === "warn"
							? th.fg("warning", "[!]")
							: th.fg("dim", "[•]");
			pad(`  ${badge} ${th.fg("text", it.label)}: ${th.fg("dim", it.details)}`);
		}
	}
}

/** Open interactive modal dashboard. */
export async function showSkillDashboard(
	ctx: ExtensionContext,
	state: SkillExecutionState,
	config: PluginDevConfig,
): Promise<void> {
	if (ctx.mode !== "tui") {
		return;
	}

	await ctx.ui.custom<void>(
		(tui: TUI, theme: Theme, _kb: KeybindingsManager, done: (val: void) => void) => {
			return new SkillDashboardModal(theme, state, config, {
				onDone: () => done(),
				requestRender: () => tui.requestRender(),
			});
		},
		{
			overlay: true,
		},
	);
}
