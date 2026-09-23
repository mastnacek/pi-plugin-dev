import type { Component, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { SkillExecutionState } from "../types.js";

const WIDGET_KEY = "pi-plugin-dev";

/** Floor so a very narrow terminal still gets a legible box. */
const MIN_TOTAL_WIDTH = 34;
/** Width at which the focus row gains the action summary. */
const WIDE_SUMMARY = 52;
/** Width at which per-gate detail rows are appended. */
const WIDE_GATES = 68;

function badge(theme: Theme, status: string): string {
	if (status === "pass") return theme.fg("success", "[PASS]");
	if (status === "fail") return theme.fg("error", "[FAIL]");
	return theme.fg("warning", "[WARN]");
}

/**
 * Docked widget above the editor.
 *
 * Rendered as a `Component` rather than a fixed-width `string[]` so the box and
 * its content follow the real render width. A `string[]` widget is baked at the
 * moment `setWidget` runs (the tracker never learns the terminal width), which
 * is why the previous version was frozen at 80 columns. Here the host calls
 * `render(width)` on every frame instead, so widening the terminal — or a host
 * pane that forwards its own width — reveals more of the reference list, the
 * action summary and the gate details instead of clipping them.
 */
class SkillWidgetComponent implements Component {
	constructor(
		private readonly theme: Theme,
		private readonly state: SkillExecutionState,
	) {}

	invalidate(): void {
		// Stateless renderer: nothing is cached between frames.
	}

	dispose(): void {
		// No listeners or timers to release.
	}

	render(width: number): string[] {
		const th = this.theme;
		const totalWidth = Math.max(MIN_TOTAL_WIDTH, Math.floor(width) || 0);
		const inner = Math.max(16, totalWidth - 4);

		/** `│ <content> │`, clipped to the inner width so the box never breaks. */
		const row = (content: string): string => {
			const clipped =
				visibleWidth(content) > inner
					? truncateToWidth(content, inner, "…")
					: content;
			const gap = Math.max(0, inner - visibleWidth(clipped));
			return `${th.fg("accent", "│")} ${clipped}${" ".repeat(gap)} ${th.fg("accent", "│")}`;
		};

		const skillTitle = this.state.activeSkill ?? "Skill Monitor";
		const refNames = Array.from(this.state.references.keys()).join(" · ") || "reading...";

		// Top border carries the ref list — it grows (or clips) with the width.
		const header = ` 🎯 ${th.fg("toolTitle", skillTitle)} ── 📖 ${th.fg("dim", refNames)} `;
		const trimmedHeader = truncateToWidth(header, Math.max(6, totalWidth - 6), "…");
		const dash = Math.max(2, totalWidth - 4 - visibleWidth(trimmedHeader));
		const lineTop = `${th.fg("accent", "┌──")}${trimmedHeader}${th.fg("accent", "─".repeat(dash))}┐`;
		const lineBot = `${th.fg("accent", "└──")}${th.fg("accent", "─".repeat(Math.max(2, totalWidth - 4)))}┘`;

		const lastAction = this.state.actions[this.state.actions.length - 1];
		const actionCore = lastAction
			? `${lastAction.type} ${lastAction.target}`
			: "waiting...";
		const actionText =
			lastAction?.summary && inner >= WIDE_SUMMARY
				? `${actionCore} — ${lastAction.summary}`
				: actionCore;

		const total = this.state.compliance.length;
		const passed = this.state.compliance.filter((c) => c.status === "pass").length;
		const failed = this.state.compliance.filter((c) => c.status === "fail").length;
		const gates = total > 0
			? `${passed}/${total} [${Math.round((passed / total) * 100)}%]`
			: "audit pending";
		const gatesColor = failed > 0 ? "error" : total > 0 ? "success" : "dim";

		const lines: string[] = [lineTop];
		lines.push(row(` ⚡ Focus: ${th.fg("text", actionText)}`));
		lines.push(row(` 🛡️ Gates: ${th.fg(gatesColor, gates)} `));

		if (inner >= WIDE_GATES && this.state.compliance.length > 0) {
			for (const chk of this.state.compliance.slice(-3)) {
				lines.push(row(`   ${badge(th, chk.status)} ${th.fg("text", chk.label)}: ${th.fg("dim", chk.details)}`));
			}
		}

		lines.push(lineBot);
		return lines;
	}
}

/**
 * Point the docked widget at the latest snapshot. Each call re-registers the
 * factory, which disposes the previous component and stores a fresh one that
 * will be asked to `render(width)` on the next frame.
 */
export function updateSkillWidget(
	ctx: ExtensionContext,
	state: SkillExecutionState,
): void {
	if (!ctx.hasUI) return;

	// If no skill or references loaded, remove widget
	if (!state.activeSkill && state.references.size === 0) {
		ctx.ui.setWidget(WIDGET_KEY, undefined);
		return;
	}

	ctx.ui.setWidget(
		WIDGET_KEY,
		(_tui: TUI, theme: Theme) => new SkillWidgetComponent(theme, state),
		{ placement: "aboveEditor" },
	);
}

export function clearSkillWidget(ctx: ExtensionContext): void {
	if (ctx.hasUI) {
		ctx.ui.setWidget(WIDGET_KEY, undefined);
	}
}
