// Skill-state projection published on the shared event bus.
//
// Other extensions (e.g. pi-sidebar's Skills tab) consume this to render the same
// numbers without duplicating skill detection. Best-effort: telemetry must never
// break the agent loop.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { SkillExecutionState } from "./types.js";

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



/**
 * Publish the tracker snapshot on the shared event bus so other extensions
 * (pi-sidebar's Skills tab) can render the same numbers without duplicating
 * skill detection. Best-effort: telemetry must never break the agent loop.
 */
export function publishSkillState(pi: ExtensionAPI, st: SkillExecutionState): void {
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
}
