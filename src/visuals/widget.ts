import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { SkillExecutionState } from "../types.js";

const WIDGET_KEY = "pi-plugin-dev";

export function updateSkillWidget(
	ctx: ExtensionContext,
	theme: Theme,
	state: SkillExecutionState,
	width: number = 80,
): void {
	if (!ctx.hasUI) return;

	// If no skill or references loaded, remove widget
	if (!state.activeSkill && state.references.size === 0) {
		ctx.ui.setWidget(WIDGET_KEY, undefined);
		return;
	}

	const th = theme;
	const innerWidth = Math.max(30, width - 4);
	const skillTitle = state.activeSkill ?? "Skill Monitor";

	// 1. Top border with active skill and refs
	const refNames = Array.from(state.references.keys()).join(" · ") || "reading...";
	const topHeader = ` 🎯 ${th.fg("toolTitle", skillTitle)} ── 📖 ${th.fg("dim", refNames)} `;
	const topHeaderLen = visibleWidth(topHeader);
	const topBorderDash = Math.max(2, innerWidth - topHeaderLen);
	const lineTop = `${th.fg("accent", "┌──")}${topHeader}${th.fg("accent", "─".repeat(topBorderDash))}┐`;

	// 2. Middle Row: Focus + Compliance stats
	const lastAction = state.actions[state.actions.length - 1];
	const actionText = lastAction ? `${lastAction.type} ${lastAction.target}` : "waiting...";
	const totalChecks = state.compliance.length;
	const passedChecks = state.compliance.filter((c) => c.status === "pass").length;
	const failedChecks = state.compliance.filter((c) => c.status === "fail").length;

	let compBadge = th.fg("dim", "audit pending");
	if (totalChecks > 0) {
		const scoreColor = failedChecks > 0 ? "error" : "success";
		compBadge = th.fg(scoreColor, `${passedChecks}/${totalChecks} [${Math.round((passedChecks / totalChecks) * 100)}%]`);
	}

	const leftMid = ` ⚡ Focus: ${th.fg("text", truncateToWidth(actionText, 30))}`;
	const rightMid = `🛡️ Gates: ${compBadge} `;
	const midSpace = Math.max(1, innerWidth - visibleWidth(leftMid) - visibleWidth(rightMid));
	const lineMid = `${th.fg("accent", "│")}${leftMid}${" ".repeat(midSpace)}${rightMid}${th.fg("accent", "│")}`;

	// 3. Bottom border
	const lineBot = `${th.fg("accent", "└──")}${th.fg("accent", "─".repeat(innerWidth))}┘`;

	ctx.ui.setWidget(WIDGET_KEY, [lineTop, lineMid, lineBot], {
		placement: "aboveEditor",
	});
}

export function clearSkillWidget(ctx: ExtensionContext): void {
	if (ctx.hasUI) {
		ctx.ui.setWidget(WIDGET_KEY, undefined);
	}
}
