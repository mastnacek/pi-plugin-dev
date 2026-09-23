/**
 * Install-offer tests.
 *
 * The detection is pure (command + filesystem + settings in, candidate out), so
 * these exercise the exact cases that decide whether a user is offered an
 * install: which directory a commit/push touched, that a push alone is not
 * enough, that only Pi packages with a GitHub origin qualify, and that an
 * already-declared package is never offered again.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import {
	buildInstallArgs,
	extractCommandDir,
	findPluginCandidate,
	installedRepoKeys,
	isGitCommitCommand,
	isGitPushCommand,
	isPiPackageManifest,
	parseGitHubRepo,
	readOriginUrl,
	readSettingsPackages,
	resolveCandidateDir,
	settingsPaths,
} from "../src/install-offer.js";

// ------------------------------------------------------------- detection

test("commit and push are recognised inside a chained command", () => {
	const chained = "cd D:/dev/pi-x && git add -A && git commit -m 'feat: x' && git push origin main";
	assert.equal(isGitCommitCommand(chained), true);
	assert.equal(isGitPushCommand(chained), true);

	assert.equal(isGitCommitCommand("git push origin main"), false);
	assert.equal(isGitPushCommand("git commit -m x"), false);
	assert.equal(isGitCommitCommand("npm test"), false);
	assert.equal(isGitPushCommand("ls -la"), false);
});

test("the last explicit directory wins", () => {
	assert.equal(extractCommandDir("git -C D:/dev/pi-x push"), "D:/dev/pi-x");
	assert.equal(extractCommandDir('git -C "D:/my plugins/pi-x" push'), "D:/my plugins/pi-x");
	assert.equal(extractCommandDir("cd D:/dev/pi-x && git commit -m x"), "D:/dev/pi-x");
	assert.equal(extractCommandDir("cd /d D:\\dev\\pi-x && git push"), "D:\\dev\\pi-x");
	assert.equal(extractCommandDir("git commit -m x && git push"), undefined);
});

test("resolveCandidateDir falls back to the session cwd and resolves relative paths", () => {
	assert.equal(resolveCandidateDir("git push", "D:/proj"), "D:/proj");
	assert.equal(resolveCandidateDir("cd pi-x && git push", "D:/proj"), resolve("D:/proj", "pi-x"));
	assert.equal(resolveCandidateDir("cd D:/else/pi-x && git push", "D:/proj"), "D:/else/pi-x");
	// `git -C <relative>` after a `cd` resolves against that cd directory.
	assert.equal(resolveCandidateDir("cd D:/dev && git -C pi-x push", "D:/proj"), resolve("D:/dev", "pi-x"));
});

// ------------------------------------------------------------- remote parsing

test("GitHub remotes parse in every documented form", () => {
	assert.deepEqual(parseGitHubRepo("https://github.com/mastnacek/pi-batch-openrouter.git"), {
		owner: "mastnacek",
		repo: "pi-batch-openrouter",
	});
	assert.deepEqual(parseGitHubRepo("git+https://github.com/mastnacek/pi-x"), { owner: "mastnacek", repo: "pi-x" });
	assert.deepEqual(parseGitHubRepo("git@github.com:mastnacek/pi-x.git"), { owner: "mastnacek", repo: "pi-x" });
	assert.deepEqual(parseGitHubRepo("ssh://git@github.com/mastnacek/pi-x.git"), { owner: "mastnacek", repo: "pi-x" });
	assert.equal(parseGitHubRepo("https://gitlab.com/o/r.git"), undefined);
	assert.equal(parseGitHubRepo("not a url"), undefined);
});

// ------------------------------------------------------------- manifest guard

test("only Pi packages qualify", () => {
	assert.equal(isPiPackageManifest({ keywords: ["pi-package"] }), true);
	assert.equal(isPiPackageManifest({ pi: { extensions: ["./index.ts"] } }), true);
	assert.equal(isPiPackageManifest({ keywords: ["cli"], pi: null }), false);
	assert.equal(isPiPackageManifest({ name: "plain-lib" }), false);
});

// ------------------------------------------------------------- filesystem

function makeCheckout(options: { piPackage?: boolean; origin?: string; dotGitFile?: boolean } = {}): string {
	const dir = mkdtempSync(join(tmpdir(), "plugin-install-"));
	const manifest = options.piPackage === false
		? { name: "plain-lib", version: "1.0.0" }
		: { name: "pi-batch-openrouter", version: "0.1.0", keywords: ["pi-package"] };
	writeFileSync(join(dir, "package.json"), JSON.stringify(manifest), "utf8");

	if (options.origin !== undefined) {
		const gitDir = join(dir, ".git");
		mkdirSync(gitDir, { recursive: true });
		writeFileSync(
			join(gitDir, "config"),
			`[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = ${options.origin}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n`,
			"utf8",
		);
		if (options.dotGitFile) {
			// Worktree-style pointer: `.git` is a file, the config lives elsewhere.
			writeFileSync(join(dir, ".git.pointer"), `gitdir: ${gitDir}\n`, "utf8");
		}
	}
	return dir;
}

test("readOriginUrl reads the origin from .git/config", () => {
	const dir = makeCheckout({ origin: "https://github.com/mastnacek/pi-batch-openrouter.git" });
	assert.equal(readOriginUrl(dir), "https://github.com/mastnacek/pi-batch-openrouter.git");
	assert.equal(readOriginUrl(join(dir, "nope")), undefined);

	const noOrigin = makeCheckout({});
	assert.equal(readOriginUrl(noOrigin), undefined);
});

test("a worktree .git file pointing at another gitdir is followed", () => {
	const real = makeCheckout({ origin: "git@github.com:mastnacek/pi-x.git" });
	const worktree = mkdtempSync(join(tmpdir(), "plugin-wt-"));
	writeFileSync(join(worktree, "package.json"), JSON.stringify({ name: "pi-x", keywords: ["pi-package"] }), "utf8");
	writeFileSync(join(worktree, ".git"), `gitdir: ${join(real, ".git")}\n`, "utf8");
	assert.equal(readOriginUrl(worktree), "git@github.com:mastnacek/pi-x.git");
});

test("findPluginCandidate accepts a pushed Pi package and rejects the rest", () => {
	const pushed = makeCheckout({ origin: "https://github.com/mastnacek/pi-batch-openrouter.git" });
	const candidate = findPluginCandidate(`cd ${pushed} && git push`, "D:/proj");
	assert.ok(candidate);
	assert.equal(candidate.name, "pi-batch-openrouter");
	assert.equal(candidate.source, "git:github.com/mastnacek/pi-batch-openrouter");
	assert.equal(candidate.repoKey, "mastnacek/pi-batch-openrouter");

	assert.equal(findPluginCandidate(`cd ${makeCheckout({ piPackage: false, origin: "https://github.com/o/r.git" })} && git push`, "D:/proj"), undefined);
	assert.equal(findPluginCandidate(`cd ${makeCheckout({})} && git push`, "D:/proj"), undefined);
	assert.equal(findPluginCandidate("cd D:/does/not/exist && git push", "D:/proj"), undefined);
});

// ------------------------------------------------------------- settings

test("installed repos are detected across settings forms and casing", () => {
	const keys = installedRepoKeys([
		"git:github.com/mastnacek/pi-batch-openrouter",
		{ source: "https://github.com/Mastnacek/Pi-Other.git" },
		"npm:pi-web-access",
		"git:github.com/other/thing",
		null,
		42,
	]);
	assert.equal(keys.has("mastnacek/pi-batch-openrouter"), true);
	assert.equal(keys.has("mastnacek/pi-other"), true);
	assert.equal(keys.has("other/thing"), true);
	assert.equal(keys.size, 3);
	assert.deepEqual(installedRepoKeys("not an array"), new Set());
});

test("readSettingsPackages merges files and ignores missing ones", () => {
	const dir = mkdtempSync(join(tmpdir(), "plugin-settings-"));
	const a = join(dir, "a.json");
	const b = join(dir, "b.json");
	writeFileSync(a, JSON.stringify({ packages: ["git:github.com/o/r"] }), "utf8");
	writeFileSync(b, JSON.stringify({ packages: [{ source: "npm:x" }] }), "utf8");
	assert.deepEqual(readSettingsPackages([a, b, join(dir, "missing.json")]), [
		"git:github.com/o/r",
		{ source: "npm:x" },
	]);
});

test("settingsPaths lists personal first, project second", () => {
	const paths = settingsPaths("D:/proj");
	assert.equal(paths.length, 2);
	assert.match(paths[0] ?? "", /\.pi[\\/]agent[\\/]settings\.json$/);
	assert.equal(paths[1], join("D:/proj", ".pi", "settings.json"));
});

// ------------------------------------------------------------- install command

test("project scope adds --local, global does not", () => {
	assert.deepEqual(buildInstallArgs("git:github.com/o/r", "global"), ["install", "git:github.com/o/r"]);
	assert.deepEqual(buildInstallArgs("git:github.com/o/r", "project"), ["install", "git:github.com/o/r", "--local"]);
});