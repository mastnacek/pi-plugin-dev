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
	rule: "trailing-space" | "string-enum" | "error-throw" | "peer-deps" | "lifecycle-cleanup";
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
}

export const DEFAULT_CONFIG: PluginDevConfig = {
	hud: true,
	hudDelayMs: 4500,
	widget: true,
	transcriptCard: true,
	statusline: true,
	strictAudit: true,
};
