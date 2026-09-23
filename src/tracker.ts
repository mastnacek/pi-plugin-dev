import { basename } from "node:path";
import { auditCodeContent } from "./auditor.js";
import type {
	ComplianceCheck,
	SkillAction,
	SkillExecutionState,
	SkillLoadedReference,
} from "./types.js";

function detectReferenceSummary(filename: string): { invariant?: string; summary: string } {
	const lower = filename.toLowerCase();
	if (lower.includes("command-completion")) {
		return { invariant: "trailing-space", summary: "Trailing Space Contract & Autocomplete Engine" };
	}
	if (lower.includes("tools-and-schema")) {
		return { invariant: "string-enum", summary: "StringEnum Rule & Tool Execution Contract" };
	}
	if (lower.includes("lifecycle")) {
		return { invariant: "lifecycle-cleanup", summary: "Lifecycle Events & Engine Compatibility" };
	}
	if (lower.includes("state-persistence")) {
		return { invariant: "state-persistence", summary: "Branch-Aware Session State & Global Config" };
	}
	if (lower.includes("api-docs")) {
		return { summary: "Live Local Engine Documentation Index" };
	}
	return { summary: "Skill Guidance Reference Document" };
}

export class SkillTracker {
	private activeSkill?: string;
	private skillPath?: string;
	private references = new Map<string, SkillLoadedReference>();
	private actions: SkillAction[] = [];
	private compliance: ComplianceCheck[] = [];
	private activeInvariants = new Set<string>();
	private inspectedFiles = new Set<string>();
	private modifiedFiles = new Set<string>();
	private startTime = Date.now();
	private lastUpdateTime = Date.now();
	private turnCount = 0;
	private inTurn = false;
	private listeners: Array<() => void> = [];

	subscribe(fn: () => void): () => void {
		this.listeners.push(fn);
		return () => {
			this.listeners = this.listeners.filter((l) => l !== fn);
		};
	}

	private notify(): void {
		this.lastUpdateTime = Date.now();
		for (const fn of this.listeners) {
			try {
				fn();
			} catch {
				// Prevent listener crash from stopping tracker
			}
		}
	}

	startTurn(): void {
		this.inTurn = true;
		this.turnCount += 1;
		this.notify();
	}

	endTurn(): void {
		this.inTurn = false;
		this.notify();
	}

	onToolStart(toolName: string, params: Record<string, unknown>): void {
		const now = Date.now();
		const rawPath = String(params.path ?? "");
		const normPath = rawPath.replace(/\\/g, "/");

		// 1. Skill activation via SKILL.md read
		if (toolName === "read" && normPath.endsWith("SKILL.md")) {
			const segments = normPath.split("/").filter(Boolean);
			const idx = segments.indexOf("SKILL.md");
			const skillName = idx > 0 ? segments[idx - 1] : "pi-skill";
			this.activeSkill = skillName;
			this.skillPath = normPath;

			this.actions.push({
				id: `act-${now}-${this.actions.length + 1}`,
				type: "read",
				target: normPath,
				summary: `Loaded skill entry point: ${skillName}`,
				timestamp: now,
			});
			this.notify();
			return;
		}

		// 2. Skill Reference guidance document read
		if (toolName === "read" && (normPath.includes("/references/") || normPath.includes("\\references\\"))) {
			const refName = basename(normPath);
			const meta = detectReferenceSummary(refName);
			if (meta.invariant) {
				this.activeInvariants.add(meta.invariant);
			}

			if (!this.references.has(refName)) {
				this.references.set(refName, {
					name: refName,
					path: normPath,
					loadedAt: now,
					lines: Number(params.limit ?? 0) || 80,
					sizeBytes: 0,
					summary: meta.summary,
				});
			}

			this.actions.push({
				id: `act-${now}-${this.actions.length + 1}`,
				type: "read",
				target: refName,
				summary: `Guidance: ${meta.summary}`,
				timestamp: now,
			});
			this.notify();
			return;
		}

		// 3. Local engine docs consultation
		if (toolName === "read" && normPath.includes("@earendil-works/pi-coding-agent/docs")) {
			const docName = basename(normPath);
			this.actions.push({
				id: `act-${now}-${this.actions.length + 1}`,
				type: "doc_consult",
				target: docName,
				summary: `Engine API doc: ${docName}`,
				timestamp: now,
			});
			this.notify();
			return;
		}

		// 4. Code file read / inspection
		if (toolName === "read" && rawPath) {
			this.inspectedFiles.add(rawPath);
			this.actions.push({
				id: `act-${now}-${this.actions.length + 1}`,
				type: "read",
				target: basename(rawPath),
				summary: `Inspecting ${basename(rawPath)}`,
				timestamp: now,
			});
			this.notify();
			return;
		}

		// 5. Code modification (edit or write) -> Run Compliance Auditor
		if (toolName === "edit" || toolName === "write") {
			if (rawPath) {
				this.modifiedFiles.add(rawPath);
			}
			let codePayload = "";
			if (toolName === "write" && typeof params.content === "string") {
				codePayload = params.content;
			} else if (toolName === "edit" && Array.isArray(params.edits)) {
				codePayload = (params.edits as Array<{ newText?: string }>)
					.map((e) => e.newText ?? "")
					.join("\n");
			}

			const newChecks = auditCodeContent(rawPath, codePayload, this.activeInvariants);
			for (const chk of newChecks) {
				const existingIdx = this.compliance.findIndex((c) => c.rule === chk.rule && c.targetFile === chk.targetFile);
				if (existingIdx >= 0) {
					this.compliance[existingIdx] = chk;
				} else {
					this.compliance.push(chk);
				}
			}

			this.actions.push({
				id: `act-${now}-${this.actions.length + 1}`,
				type: toolName,
				target: basename(rawPath),
				summary: `${toolName === "edit" ? "Modifying" : "Writing"} ${basename(rawPath)}`,
				timestamp: now,
			});
			this.notify();
			return;
		}

		// 6. Bash verification commands
		if (toolName === "bash" && typeof params.command === "string") {
			this.actions.push({
				id: `act-${now}-${this.actions.length + 1}`,
				type: "bash",
				target: params.command.slice(0, 40),
				summary: `Shell: ${params.command.slice(0, 48)}`,
				timestamp: now,
			});
			this.notify();
		}
	}

	onToolEnd(toolName: string): void {
		void toolName;
		const last = this.actions[this.actions.length - 1];
		if (last && last.durationMs === undefined) {
			last.durationMs = Date.now() - last.timestamp;
		}
		this.notify();
	}

	getState(): SkillExecutionState {
		return {
			activeSkill: this.activeSkill,
			skillPath: this.skillPath,
			references: new Map(this.references),
			actions: [...this.actions],
			compliance: [...this.compliance],
			inspectedFiles: new Set(this.inspectedFiles),
			modifiedFiles: new Set(this.modifiedFiles),
			startTime: this.startTime,
			lastUpdateTime: this.lastUpdateTime,
			turnCount: this.turnCount,
			inTurn: this.inTurn,
		};
	}

	reset(): void {
		this.activeSkill = undefined;
		this.skillPath = undefined;
		this.references.clear();
		this.actions = [];
		this.compliance = [];
		this.activeInvariants.clear();
		this.inspectedFiles.clear();
		this.modifiedFiles.clear();
		this.startTime = Date.now();
		this.lastUpdateTime = Date.now();
		this.turnCount = 0;
		this.inTurn = false;
		this.notify();
	}
}
