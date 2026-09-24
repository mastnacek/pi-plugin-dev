/**
 * Install-offer hook — session state for the "install from GitHub after
 * commit+push" offer. Extracted from the composition root (line-limit
 * dogfooding); pure flow logic lives in ../install-offer.ts.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	findPluginCandidate,
	installedRepoKeys,
	isGitCommitCommand,
	isGitPushCommand,
	readSettingsPackages,
	resolveCandidateDir,
	runInstallAsync,
	settingsPaths,
	type InstallScope,
	type PluginCandidate,
} from "../install-offer.js";
import type { PluginDevConfig } from "../types.js";

export interface InstallOfferHook {
	/** Remember the `bash` command behind a tool call id. */
	trackBash(toolCallId: string, command: string): void;
	/** Pop the remembered command for a tool call id, if any. */
	takeBash(toolCallId: string): string | undefined;
	/** Feed every successful `bash` command; collects commit+push candidates. */
	noteGitActivity(command: string, sessionCwd: string): void;
	/** Offers pending installs once the agent has settled. */
	offerPendingInstalls(ctx: ExtensionContext): Promise<void>;
}

export function createInstallOfferHook(getConfig: () => PluginDevConfig): InstallOfferHook {
	/** `bash` command per tool call, so an end event can tell a commit from a push. */
	const pendingBash = new Map<string, string>();
	/** Checkouts committed in this session — a push of older commits must not offer. */
	const committedDirs = new Set<string>();
	/** Push-verified Pi plugins waiting for the install offer. */
	const installCandidates = new Map<string, PluginCandidate>();
	/** Repos already offered this session, so the user is asked at most once. */
	const offeredRepos = new Set<string>();

	/**
	 * A successful `git commit` marks the checkout; a successful `git push` of a
	 * checkout committed in this session collects an install candidate.
	 */
	const noteGitActivity = (command: string, sessionCwd: string): void => {
		if (!getConfig().installOffer) return;
		const dir = resolveCandidateDir(command, sessionCwd);
		if (isGitCommitCommand(command)) committedDirs.add(dir);
		if (!isGitPushCommand(command)) return;
		if (!committedDirs.has(dir)) return;
		const candidate = findPluginCandidate(command, sessionCwd);
		if (candidate) installCandidates.set(candidate.repoKey, candidate);
	};

	/**
	 * Offer the pending installs once the agent has settled.
	 *
	 * Deliberately at `agent_settled` rather than inside `tool_execution_end`: a
	 * dialog there would sit between a tool result and the model, and blocking the
	 * turn on a user answer is exactly what settles are for.
	 */
	const offerPendingInstalls = async (ctx: ExtensionContext): Promise<void> => {
		if (!getConfig().installOffer || !ctx.hasUI || installCandidates.size === 0) return;

		const installed = installedRepoKeys(readSettingsPackages(settingsPaths(ctx.cwd)));
		for (const [key, candidate] of [...installCandidates]) {
			installCandidates.delete(key);
			if (installed.has(key) || offeredRepos.has(key)) continue;
			offeredRepos.add(key);

			const choice = await ctx.ui.select(`Instalovat ${candidate.name} z GitHubu?`, [
				`Globálně — ${candidate.source}`,
				"Projekt — .pi/settings.json",
				"Teď ne",
			]);
			if (choice === undefined || choice.startsWith("Teď ne")) continue;
			const scope: InstallScope = choice.startsWith("Projekt") ? "project" : "global";

			ctx.ui.setStatus("pi-plugin-dev", `📦 Instaluji ${candidate.name}…`);
			const result = await runInstallAsync(candidate.source, scope, ctx.cwd);
			if (result.ok) {
				ctx.ui.notify(
					`📦 ${candidate.name} nainstalován z ${candidate.source} (${scope}). Restart Pi (nebo /reload) ho načte.`,
					"info",
				);
			} else {
				ctx.ui.notify(
					`Instalace selhala. Spusť ručně: pi install ${candidate.source}${scope === "project" ? " --local" : ""}\n${result.output}`,
					"error",
				);
			}
		}
	};

	const trackBash = (toolCallId: string, command: string): void => {
		pendingBash.set(toolCallId, command);
	};

	const takeBash = (toolCallId: string): string | undefined => {
		const command = pendingBash.get(toolCallId);
		if (command !== undefined) pendingBash.delete(toolCallId);
		return command;
	};

	return { trackBash, takeBash, noteGitActivity, offerPendingInstalls };
}
