import type { Component, KeybindingsManager, OverlayHandle, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { SkillExecutionState } from "../types.js";

const MIN_WIDTH = 48;
const MAX_WIDTH = 78;

export interface HudOptions {
	delayMs: number;
	onDone: () => void;
	requestRender: () => void;
}

export class SkillHudCard implements Component {
	private readonly theme: Theme;
	private state: SkillExecutionState;
	private readonly options: HudOptions;
	private closed = false;
	private cachedWidth?: number;
	private cachedLines?: string[];
	private timer?: ReturnType<typeof setInterval>;

	constructor(theme: Theme, state: SkillExecutionState, options: HudOptions) {
		this.theme = theme;
		this.state = state;
		this.options = options;

		this.timer = setInterval(() => {
			if (this.closed) return;
			// If turn finished and delay elapsed, auto-dismiss
			if (!this.state.inTurn && Date.now() - this.state.lastUpdateTime > this.options.delayMs) {
				this.dismiss();
				return;
			}
			this.invalidate();
			this.options.requestRender();
		}, 300);
		this.timer.unref?.();
	}

	updateState(nextState: SkillExecutionState): void {
		this.state = nextState;
		this.invalidate();
		this.options.requestRender();
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}

	dismiss(): void {
		if (this.closed) return;
		this.closed = true;
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
		this.options.onDone();
	}

	handleInput(): boolean {
		// Any keypress dismisses the overlay early without consuming the key
		this.dismiss();
		return false;
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) {
			return this.cachedLines;
		}

		const totalWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, width - 2));
		const lines = this.draw(totalWidth);
		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}

	private draw(totalWidth: number): string[] {
		const th = this.theme;
		const innerWidth = totalWidth - 4; // ║ + 2 padding + ║
		const lines: string[] = [];

		const borderTop = `╔═${"═".repeat(innerWidth + 2)}═╗`;
		const borderSep = `╟─${"─".repeat(innerWidth + 2)}─╢`;
		const borderBot = `╚═${"═".repeat(innerWidth + 2)}═╝`;

		const padRow = (content: string): string => {
			const visLen = visibleWidth(content);
			const spaceNeeded = Math.max(0, innerWidth - visLen);
			return `${th.fg("accent", "║")} ${content}${" ".repeat(spaceNeeded)} ${th.fg("accent", "║")}`;
		};

		lines.push(th.fg("accent", borderTop));

		// 1. Header Row
		const elapsedSec = ((Date.now() - this.state.startTime) / 1000).toFixed(1);
		const skillName = this.state.activeSkill ?? "Generic Agent";
		const leftHeader = `${th.fg("accent", "🎯 SKILL:")} ${th.fg("toolTitle", skillName)}`;
		const rightHeader = th.fg("dim", `${this.state.references.size} refs · ${elapsedSec}s`);
		const headerSpace = Math.max(1, innerWidth - visibleWidth(leftHeader) - visibleWidth(rightHeader));
		lines.push(`${th.fg("accent", "║")} ${leftHeader}${" ".repeat(headerSpace)}${rightHeader} ${th.fg("accent", "║")}`);

		lines.push(th.fg("accent", borderSep));

		// 2. Active Guidance / References Section
		lines.push(padRow(th.fg("accent", "📖 Loaded Guidance:")));
		if (this.state.references.size === 0) {
			lines.push(padRow(th.fg("dim", "  (No specific skill references loaded yet)")));
		} else {
			for (const ref of this.state.references.values()) {
				const mark = th.fg("success", "✓");
				const name = th.fg("text", ref.name);
				const sum = th.fg("dim", `(${ref.summary})`);
				const lineContent = `  ${mark} ${name} ${sum}`;
				lines.push(padRow(truncateToWidth(lineContent, innerWidth)));
			}
		}

		lines.push(th.fg("accent", borderSep));

		// 3. Current / Recent Operation
		const lastAction = this.state.actions[this.state.actions.length - 1];
		lines.push(padRow(th.fg("accent", "⚡ Agent Focus:")));
		if (lastAction) {
			let icon = "⚡";
			if (lastAction.type === "read") icon = "📖";
			if (lastAction.type === "edit") icon = "✏️";
			if (lastAction.type === "write") icon = "✍️";
			if (lastAction.type === "bash") icon = "🧪";
			if (lastAction.type === "doc_consult") icon = "📚";

			const targetStr = th.fg("text", truncateToWidth(lastAction.target, 32));
			const sumStr = th.fg("dim", `[${lastAction.summary}]`);
			lines.push(padRow(`  ${icon} ${targetStr} ${sumStr}`));
		} else {
			lines.push(padRow(th.fg("dim", "  Idle / waiting for agent")));
		}

		lines.push(th.fg("accent", borderSep));

		// 4. Compliance Gates
		lines.push(padRow(th.fg("accent", "🛡️ Instruction Compliance:")));
		if (this.state.compliance.length === 0) {
			lines.push(padRow(th.fg("dim", "  ● Awaiting code mutations for contract audit...")));
		} else {
			for (const chk of this.state.compliance.slice(-4)) {
				const badge =
					chk.status === "pass"
						? th.fg("success", "[PASS]")
						: chk.status === "fail"
							? th.fg("error", "[FAIL]")
							: th.fg("warning", "[WARN]");
				const ruleLabel = th.fg("text", chk.label);
				const row = `  ${badge} ${ruleLabel}: ${th.fg("dim", truncateToWidth(chk.details, innerWidth - 28))}`;
				lines.push(padRow(row));
			}
		}

		lines.push(th.fg("accent", borderSep));

		// 5. Footer Line
		const leftFoot = th.fg("dim", "Press any key to dismiss");
		const rightFoot = th.fg("dim", "pi-plugin-dev");
		const footSpace = Math.max(1, innerWidth - visibleWidth(leftFoot) - visibleWidth(rightFoot));
		lines.push(`${th.fg("accent", "║")} ${leftFoot}${" ".repeat(footSpace)}${rightFoot} ${th.fg("accent", "║")}`);

		lines.push(th.fg("accent", borderBot));
		return lines;
	}
}

let activeHud: SkillHudCard | null = null;

export function showSkillHud(
	ctx: ExtensionContext,
	state: SkillExecutionState,
	options: { delayMs: number },
): void {
	if (activeHud) {
		activeHud.updateState(state);
		return;
	}

	void ctx.ui
		.custom<undefined>(
			(tui: TUI, theme: Theme, _kb: KeybindingsManager, done: (val: undefined) => void) => {
				const card = new SkillHudCard(theme, state, {
					delayMs: options.delayMs,
					onDone: () => {
						activeHud = null;
						done(undefined);
					},
					requestRender: () => tui.requestRender(),
				});
				activeHud = card;
				return card;
			},
			{
				overlay: true,
				overlayOptions: {
					anchor: "top-right",
					width: MAX_WIDTH,
					margin: 1,
					visible: (termWidth: number) => termWidth >= 70,
				},
				onHandle: (handle: OverlayHandle) => handle.unfocus(),
			},
		)
		.catch(() => {
			activeHud = null;
		});
}

export function updateSkillHud(state: SkillExecutionState): void {
	activeHud?.updateState(state);
}

export function closeSkillHud(): void {
	activeHud?.dismiss();
	activeHud = null;
}
