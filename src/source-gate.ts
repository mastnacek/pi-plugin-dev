/**
 * Consult-before-edit gates: turn "read the skill / call the MCP tool first"
 * from prompt prose into hard enforcement. An edit/write `tool_call` on a
 * monitored source file is rejected (`block: true`) until the required source
 * has been consulted this session.
 *
 * Enforcement, not verification: the hook proves the call HAPPENED, not that
 * it was relevant. Same trade-off pi-lotusscript-modular accepts.
 */

import path from "node:path";
import { isMonitoredSourcePath } from "./line-monitor.js";

/**
 * Case-insensitive tool-name pattern match. Trailing `*` = prefix match,
 * otherwise substring match. `"mcp__knowledge_base*"` matches
 * `mcp__knowledge_base_kb_search`; `"kb_search"` matches any name containing it.
 */
export function matchesToolPattern(toolName: string, pattern: string): boolean {
	const t = toolName.toLowerCase();
	const p = pattern.toLowerCase();
	if (p.length === 0) return false;
	return p.endsWith("*") ? t.startsWith(p.slice(0, -1)) : t.includes(p);
}

/** True when any configured pattern matches the (raw or base) tool name. */
export function toolMatchesAny(toolName: string, patterns: readonly string[]): boolean {
	return patterns.some((p) => matchesToolPattern(toolName, p) || matchesToolPattern(baseToolName(toolName), p));
}

function baseToolName(raw: string): string {
	return raw.includes("__") ? raw.split("__").pop()! : raw;
}

/** True when the edit target is a source file the gates apply to. */
export function isGatedEditTarget(resolvedPath: string): boolean {
	return isMonitoredSourcePath(resolvedPath);
}

/**
 * How a mutating tool names its target file.
 *
 * `path` — the arguments carry a filesystem path, so every file-level gate
 * (source check, line limit, pre-execution invariants) can run.
 *
 * `anchor` — the arguments carry an opaque anchor and no path. The editor
 * resolves the anchor to a file inside its own registry, which this plugin has
 * no access to, so only the session-level gates can be enforced.
 *
 * `null` — not a gated mutation tool.
 */
export type MutationTargeting = "path" | "anchor" | null;

/** Arguments a mutating tool may name its target with. */
export interface MutationInput {
	/** Present on `edit`/`write` and on anchor editors configured to require a path. */
	path?: unknown;
	/** Editor arguments carry many more keys (anchor, lines, edits); only `path` matters here. */
	[key: string]: unknown;
}
/**
 * Classify a tool call as a gated mutation, and say how it names its target.
 *
 * This is the seam that keeps the gates from silently going blind when a new
 * editor tool ships. `pi-hashline-edit-pro` registers `replace` and `insert`;
 * a gate that only knows `edit`/`write` stops being a gate the moment the agent
 * switches editors. Both names are configurable, so a fourth one is a config
 * edit rather than a patch here.
 */
export function mutationTargeting(
	rawName: string,
	input: MutationInput,
	cfg: { mutationTools: readonly string[]; pathlessTools: readonly string[] },
): MutationTargeting {
	if (!toolMatchesAny(rawName, cfg.mutationTools)) return null;
	// An explicit path always wins: even an anchor-first tool can be told the file.
	if (typeof input.path === "string" && input.path.trim().length > 0) return "path";
	return toolMatchesAny(rawName, cfg.pathlessTools) ? "anchor" : "path";
}

/** Block reason for a mutation tool that does not expose its target file. */
export function buildUnknownTargetGateReason(toolName: string, gate: string): string {
	return [
		`${gate}: '${baseToolName(toolName)}' changes a file but names it only by anchor, ` +
		"which this plugin cannot resolve — the editor keeps its own registry.",
		"Per project rules, the relevant Pi skill must be consulted first, so the session-level " +
		"gate applies to this tool too.",
		"Mandatory step: read the skill entry point with the 'read' tool — the file is named SKILL.md, " +
		"e.g. '~/.pi/agent/skills/<skill-name>/SKILL.md' — then retry.",
		'(Turn the anchor-only gate off with "enforcePathlessEditGate": false, or drop the tool ' +
		'from "gatedPathlessTools", in \'~/.pi/agent/pi-plugin-dev.json\'.)',
	].join(" ");
}

/** Block reason for the skill gate: no Pi skill has been activated this session. */
export function buildSkillGateReason(filePath: string): string {
	return [
		`SKILL BEFORE EDIT: '${path.basename(filePath)}' is source code, but no Pi skill has been activated in this session.`,
		"Per project rules, loading the relevant skill first is MANDATORY before writing code.",
		"Mandatory step: read the skill entry point with the 'read' tool —",
		"  e.g. '.pi/skills/<skill-name>/SKILL.md' or '~/.pi/agent/skills/<skill-name>/SKILL.md' —",
		"then retry this edit.",
		"(Disable this gate with \"enforceSkillBeforeEdit\": false in '~/.pi/agent/pi-plugin-dev.json'.)",
	].join(" ");
}

/** Block reason for the MCP consult gate: required tool calls not observed yet. */
export function buildMcpGateReason(missingPatterns: readonly string[]): string {
	return [
		`CONSULT BEFORE EDIT: required MCP tool call(s) not observed yet this session: ${missingPatterns.join(", ")}.`,
		"Do NOT retry this edit unchanged — it will be rejected again.",
		"Mandatory step first: call the listed MCP tool(s) (e.g. a knowledge-base search relevant to this change),",
		"then re-run this edit.",
	].join(" ");
}
