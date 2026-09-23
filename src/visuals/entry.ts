import { Box, Text } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { ComplianceCheck } from "../types.js";

export const SKILL_AUDIT_ENTRY_TYPE = "pi-plugin-dev:audit";

export interface SkillAuditPayload {
	skillName: string;
	references: Array<{ name: string; summary: string }>;
	compliance: ComplianceCheck[];
	inspectedCount: number;
	modifiedCount: number;
	durationMs: number;
}

export function renderSkillAuditEntry(
	payload: SkillAuditPayload,
	expanded: boolean,
	theme: Theme,
) {
	const th = theme;
	const container = new Box(1, 0);

	const passed = payload.compliance.filter((c) => c.status === "pass").length;
	const total = payload.compliance.length;
	const allPass = total > 0 && passed === total;
	const hasFail = payload.compliance.some((c) => c.status === "fail");

	let scoreColor: Parameters<Theme["fg"]>[0] = "dim";
	if (hasFail) {
		scoreColor = "error";
	} else if (allPass) {
		scoreColor = "success";
	}
	const scoreText = total > 0 ? `${passed}/${total} [${Math.round((passed / total) * 100)}% PASS]` : "Audit Complete";

	const sec = (payload.durationMs / 1000).toFixed(1);
	const badge = th.bg("selectedBg", th.fg("accent", ` 🎯 ${payload.skillName} `));
	const head = `▸ ${badge} ${th.fg("dim", `(${payload.references.length} refs loaded)`)} · ${th.fg(scoreColor, scoreText)} · ${th.fg("dim", `${sec}s`)}`;

	container.addChild(new Text(head));

	if (expanded) {
		if (payload.references.length > 0) {
			container.addChild(new Text(`  ${th.fg("accent", "📖 Guidance Loaded:")}`));
			for (const ref of payload.references) {
				container.addChild(new Text(`    ${th.fg("success", "✓")} ${th.fg("text", ref.name)} ${th.fg("dim", `(${ref.summary})`)}`));
			}
		}

		if (payload.compliance.length > 0) {
			container.addChild(new Text(`  ${th.fg("accent", "🛡️ Compliance Gates:")}`));
			for (const c of payload.compliance) {
				let mark = th.fg("warning", "[WARN]");
				if (c.status === "pass") mark = th.fg("success", "[PASS]");
				else if (c.status === "fail") mark = th.fg("error", "[FAIL]");
				container.addChild(new Text(`    ${mark} ${th.fg("text", c.label)}: ${th.fg("dim", c.details)}`));
			}
		}

		container.addChild(new Text(`  ${th.fg("dim", `Inspected: ${payload.inspectedCount} files · Modified: ${payload.modifiedCount} files`)}`));
	}

	return container;
}
