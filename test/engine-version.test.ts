import test from "node:test";
import assert from "node:assert/strict";

import { checkEngineVersion, compareVersions, fetchLatestEngineVersion } from "../src/engine-version.js";

test("compareVersions orders dotted versions numerically", () => {
	assert.equal(compareVersions("0.87.1", "0.87.1"), 0);
	assert.equal(compareVersions("0.86.0", "0.87.1"), -1);
	assert.equal(compareVersions("0.88.0", "0.87.1"), 1);
	assert.equal(compareVersions("0.9.0", "0.10.0"), -1, "10 must not sort below 9");
	assert.equal(compareVersions("1.0.0", "0.99.99"), 1);
});

test("compareVersions tolerates v-prefixes and unequal lengths", () => {
	assert.equal(compareVersions("v0.87.1", "0.87.1"), 0);
	assert.equal(compareVersions("0.87", "0.87.0"), 0);
	assert.equal(compareVersions("0.87.2", "0.87"), 1);
});

test("compareVersions applies real semver precedence to prereleases", () => {
	assert.equal(compareVersions("0.87.1-beta.1", "0.87.1"), -1, "a prerelease is older than its release");
	assert.equal(compareVersions("0.88.0-beta.1", "0.87.1"), 1, "the release part still dominates");
	assert.equal(compareVersions("0.88.0-alpha.1", "0.88.0-beta.1"), -1);
	assert.equal(compareVersions("0.88.0-alpha.1", "0.88.0-alpha.2"), -1);
	assert.equal(compareVersions("0.88.0-alpha", "0.88.0-alpha.1"), -1, "fewer identifiers sort lower");
});

test("compareVersions ignores build metadata, which has no precedence", () => {
	assert.equal(compareVersions("0.87.1+build.7", "0.87.1"), 0);
	assert.equal(compareVersions("0.87.1-alpha+build.7", "0.87.1-alpha"), 0);
});

test("compareVersions never yields NaN for junk input", () => {
	// Junk parses as 0.0, which is genuinely older than 0.1 rather than NaN.
	assert.equal(compareVersions("garbage", "0.1"), -1);
	assert.equal(compareVersions("", ""), 0);
	assert.equal(compareVersions("0.87.1", "garbage"), 1);
});

test("a lagging pin warns with the exact gap and the rule reference", () => {
	const result = checkEngineVersion({ installed: "0.85.1", latest: "0.87.1" });
	assert.equal(result.status, "warn");
	assert.match(result.details, /0\.87\.1 on npm/);
	assert.match(result.details, /0\.85\.1 installed/);
	assert.match(result.details, /SKILL\.md §0/);
});

test("an up-to-date pin passes", () => {
	const result = checkEngineVersion({ installed: "0.87.1", latest: "0.87.1" });
	assert.equal(result.status, "pass");
	assert.match(result.details, /up to date/);
});

test("a newer local build than npm does not warn", () => {
	const result = checkEngineVersion({ installed: "0.88.0", latest: "0.87.1" });
	assert.equal(result.status, "pass");
});

test("an unreachable registry is info, never a failure", () => {
	const result = checkEngineVersion({ installed: "0.87.1", latest: undefined });
	assert.equal(result.status, "info");
	assert.match(result.details, /unknown/);
});

test("an unresolvable installed version warns about the missing fact", () => {
	const result = checkEngineVersion({ installed: undefined, latest: "0.87.1" });
	assert.equal(result.status, "warn");
	assert.match(result.details, /without the installed version/);
});

test("fetchLatestEngineVersion reads the version from the registry", async () => {
	const fakeFetch = (async () =>
		({
			ok: true,
			json: async () => ({ version: "0.88.0" }),
		}) as unknown as Response) as unknown as typeof fetch;

	assert.equal(await fetchLatestEngineVersion(fakeFetch), "0.88.0");
});

test("fetchLatestEngineVersion collapses a non-OK response to undefined", async () => {
	const fakeFetch = (async () =>
		({ ok: false, status: 500, json: async () => ({}) }) as unknown as Response) as unknown as typeof fetch;

	assert.equal(await fetchLatestEngineVersion(fakeFetch), undefined);
});

test("fetchLatestEngineVersion swallows a network throw", async () => {
	const fakeFetch = (async () => {
		throw new Error("ENOTFOUND registry.npmjs.org");
	}) as unknown as typeof fetch;

	assert.equal(await fetchLatestEngineVersion(fakeFetch), undefined);
});

test("fetchLatestEngineVersion ignores a payload with no version string", async () => {
	const fakeFetch = (async () =>
		({ ok: true, json: async () => ({ distTags: {} }) }) as unknown as Response) as unknown as typeof fetch;

	assert.equal(await fetchLatestEngineVersion(fakeFetch), undefined);
});
