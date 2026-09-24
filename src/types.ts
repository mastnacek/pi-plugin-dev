import { DEFAULT_MAX_FILE_LINES } from "./line-monitor.js";

export type ComplianceStatus = "pass" | "fail" | "warn";

export interface SkillLoadedReference {
	name: string;
	path: string;
	loadedAt: number;
	lines: number;
	sizeBytes: number;
	summary: string;
}

export interface ComplianceCheck {
	id: string;
	rule:
		| "trailing-space"
		| "string-enum"
		| "error-throw"
		| "peer-deps"
		| "lifecycle-cleanup"
		| "manifest-hygiene"
		| "ui-mode-guard"
		| "state-persistence"
		| "docs-portability";
	label: string;
	status: ComplianceStatus;
	details: string;
	targetFile?: string;
	timestamp: number;
}

export interface SkillAction {
	id: string;
	type: "read" | "write" | "edit" | "bash" | "doc_consult";
	target: string;
	summary: string;
	timestamp: number;
	durationMs?: number;
	complianceCheckId?: string;
}

export interface SkillExecutionState {
	activeSkill?: string;
	skillPath?: string;
	skillDescription?: string;
	references: Map<string, SkillLoadedReference>;
	actions: SkillAction[];
	compliance: ComplianceCheck[];
	inspectedFiles: Set<string>;
	modifiedFiles: Set<string>;
	startTime: number;
	lastUpdateTime: number;
	turnCount: number;
	inTurn: boolean;
}

export interface PluginDevConfig {
	hud: boolean;
	hudDelayMs: number;
	widget: boolean;
	transcriptCard: boolean;
	statusline: boolean;
	strictAudit: boolean;
	/** After a successful commit+push of a Pi plugin, offer to install it from GitHub. */
	installOffer: boolean;
	/** Hard per-file line limit for monitored source files (line-monitor.ts). */
	maxFileLines: number;
	/** HARD GATE: block source edits until a Pi skill entry point (SKILL.md) has been read this session. */
	enforceSkillBeforeEdit: boolean;
	/** HARD GATE: MCP tool-name patterns (e.g. "kb_search", "mcp__knowledge_base*") that must be called before source edits. Empty disables. */
	requiredMcpToolsBeforeEdit: string[];
}

export const DEFAULT_CONFIG: PluginDevConfig = {
	hud: true,
	hudDelayMs: 4500,
	widget: true,
	transcriptCard: true,
	statusline: true,
	strictAudit: true,
	installOffer: true,
	maxFileLines: DEFAULT_MAX_FILE_LINES,
	enforceSkillBeforeEdit: true,
	requiredMcpToolsBeforeEdit: [],
};
