/**
 * Guard hooks — source-file line limit + consult-before-edit gates.
 *
 * Extracted from the composition root so index.ts stays under the plugin's
 * own per-file line limit (dogfooded by the line-limit hook itself).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import path from "node:path";
import { checkFileLines, formatLineLimitCheck } from "../line-monitor.js";
import { checkPreExecutionInvariants } from "../pre-execution-gate.js";
import {
	buildMcpGateReason,
	buildSkillGateReason,
	buildUnknownTargetGateReason,
	isGatedEditTarget,
	mutationTargeting,
	toolMatchesAny,
} from "../source-gate.js";
import type { SkillTracker } from "../tracker.js";
import type { PluginDevConfig } from "../types.js";

export interface GuardHookHandle {
	/** Clears session gate state (call from session_start). */
	reset(): void;
}

/**
 * Registers the before_agent_start guidelines, the consult gates on
 * `tool_call` and the line-limit rejection on `tool_result`.
 *
 * `track` stores every unsubscribe so the composition root keeps a single
 * drain point for session_shutdown.
 */
export function registerGuardHooks(
	pi: ExtensionAPI,
	getConfig: () => PluginDevConfig,
	tracker: SkillTracker,
	track: (result: unknown) => void,
): GuardHookHandle {
	/** MCP tool-name patterns satisfied this session (consult gate state). */
	const satisfiedMcpTools = new Set<string>();

	track(pi.on("before_agent_start", (event) => {
		if (!event.systemPromptOptions?.promptGuidelines) return;
		const config = getConfig();
		event.systemPromptOptions.promptGuidelines.push(
			`SOURCE FILE LENGTH LIMIT: Source code files (.ts, .js, .rs, .go, .py, …) must stay at or below ${config.maxFileLines} lines ` +
				`(soft target ${Math.floor(config.maxFileLines * 0.75)}). If an edit or write is rejected with '[Line limit exceeded]', ` +
				"do NOT retry the same file unchanged — extract cohesive sections (classes, function groups, constants, types) " +
				"into new modules in the same folder and import them, then re-run the edit.",
		);
		event.systemPromptOptions.promptGuidelines.push(
			"CONSULT BEFORE EDIT (ENFORCED): edit/write calls on source code files are rejected until the required " +
				"sources have been consulted this session — the relevant Pi skill entry point (SKILL.md) has been read, " +
				"and, when configured, the required MCP tool(s) (e.g. kb_search) have been called. If an edit is rejected " +
				"with 'SKILL BEFORE EDIT' or 'CONSULT BEFORE EDIT', perform the required consultation first, then retry.",
		);
	}));

	// Consult-before-edit gates — skill activation + required MCP tool calls
	track(pi.on("tool_call", (event) => {
		const config = getConfig();
		const rawName = event.toolName || "";
		const required = config.requiredMcpToolsBeforeEdit ?? [];
		if (required.length > 0 && toolMatchesAny(rawName, required)) {
			// Record satisfaction before any early return below.
			for (const pattern of required) {
				if (toolMatchesAny(rawName, [pattern])) satisfiedMcpTools.add(pattern);
			}
		}

		const inputObj = (event.input ?? {}) as Record<string, unknown>;
		const targeting = mutationTargeting(rawName, inputObj, {
			mutationTools: config.gatedMutationTools,
			pathlessTools: config.gatedPathlessTools,
		});
		if (!targeting) return;

		// Anchor-only tools: the file is unknown, so the file-level gates below have
		// nothing to check. The session-level gates still apply, and the reason says so
		// rather than pretending the target was inspected.
		if (targeting === "anchor") {
			if (!config.enforcePathlessEditGate) return;
			if (config.enforceSkillBeforeEdit && !tracker.getState().activeSkill) {
				return { block: true, reason: buildUnknownTargetGateReason(rawName, "SKILL BEFORE EDIT") };
			}
			const missingAnchor = required.filter((p) => !satisfiedMcpTools.has(p));
			if (missingAnchor.length > 0) {
				return { block: true, reason: buildUnknownTargetGateReason(rawName, "CONSULT BEFORE EDIT") };
			}
			return;
		}

		const targetPath = typeof inputObj.path === "string" ? inputObj.path : "";
		if (!targetPath) return;
		if (!isGatedEditTarget(path.resolve(targetPath))) return;

		if (config.enforceSkillBeforeEdit && !tracker.getState().activeSkill) {
			return { block: true, reason: buildSkillGateReason(targetPath) };
		}
		const missing = required.filter((p) => !satisfiedMcpTools.has(p));
		if (missing.length > 0) {
			return { block: true, reason: buildMcpGateReason(missing) };
		}

		// Inspect code / manifest before execution for fatal invariant violations
		let codePayload = "";
		// The editor tools carry their payload under their own argument names, so the
		// invariant check reads all three shapes rather than just `write`/`edit`.
		if (typeof inputObj?.content === "string") {
			codePayload = inputObj.content;
		} else if (Array.isArray(inputObj?.edits)) {
			codePayload = (inputObj.edits as Array<{ newText?: string }>)
				.map((e) => e.newText ?? "")
				.join("\n");
		} else if (Array.isArray(inputObj?.replacement_lines)) {
			// `replace`: the lines that will land in the file.
			codePayload = (inputObj.replacement_lines as unknown[]).join("\n");
		} else if (Array.isArray(inputObj?.lines)) {
			// `insert`: the lines that will land in the file.
			codePayload = (inputObj.lines as unknown[]).join("\n");
		}

		if (codePayload) {
			const preCheck = checkPreExecutionInvariants(
				path.resolve(targetPath),
				codePayload,
				config.strictAudit,
			);
			if (preCheck.block) {
				return { block: true, reason: preCheck.reason };
			}
		}
	}));

	// Source file line limit — edit/write rejection
	track(pi.on("tool_result", (event) => {
		const rawName = event.toolName || "";
		if (event.isError) return;
		// Same classifier as the call gate, so a tool covered there is covered here.
		// The line limit needs the file itself, so an anchor-only result is skipped —
		// the call gate already enforced what it could for those.
		const config = getConfig();
		const resultInput = (event.input ?? {}) as Record<string, unknown>;
		if (
			mutationTargeting(rawName, resultInput, {
				mutationTools: config.gatedMutationTools,
				pathlessTools: config.gatedPathlessTools,
			}) !== "path"
		) {
			return;
		}

		const targetPath = typeof resultInput.path === "string" ? resultInput.path : "";
		if (!targetPath) return;
		const check = checkFileLines(path.resolve(targetPath), getConfig().maxFileLines);
		const notice = formatLineLimitCheck(check);
		if (!notice) return;

		if (check.level === "exceeded") {
			return {
				content: [...event.content, { type: "text", text: notice }],
				isError: true,
			};
		}
		return { content: [...event.content, { type: "text", text: notice }] };
	}));

	return {
		reset: () => satisfiedMcpTools.clear(),
	};
}
