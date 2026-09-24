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
