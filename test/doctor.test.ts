/**
 * Doctor tests.
 *
 * `buildDoctorReport()` is pure, so the report is asserted on facts rather than
 * on this machine's actual engine install. `collectDoctorReport()` is exercised
 * only for the shape of its output.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
	buildDoctorReport,
	checkSkillFrontmatter,
	collectDoctorReport,
	formatDoctorReport,
	locateEnginePackage,
	locateRunningEnginePackage,
} from "../src/doctor.js";
import { checkEngineSource } from "../src/engine-version.js";

const SKILL_OK = ["---", "name: pi-plugin-dev", "description: Test skill", "---", "", "# Body"].join("\n");
const SKILL_NO_FRONT = "# Body only\n";
const SKILL_PARTIAL = ["---", "name: pi-plugin-dev", "---", "", "# Body"].join("\n");

function item(report: ReturnType<typeof buildDoctorReport>, label: string) {
	const found = report.items.find((entry) => entry.label === label);
	assert.ok(found, `missing report item "${label}"`);
	return found;
}

test("checkSkillFrontmatter accepts a complete block", () => {
	assert.deepEqual(checkSkillFrontmatter(SKILL_OK), { ok: true, details: "name + description present" });
});

test("checkSkillFrontmatter reports what is missing", () => {
	assert.equal(checkSkillFrontmatter(SKILL_NO_FRONT).ok, false);
	assert.match(checkSkillFrontmatter(SKILL_NO_FRONT).details, /no YAML frontmatter/);
	assert.match(checkSkillFrontmatter(SKILL_PARTIAL).details, /description/);
});

test("report: unresolved engine and unreadable settings warn instead of throwing", () => {
	const report = buildDoctorReport({ pluginRoot: "/tmp/plugin" });
	assert.equal(item(report, "Engine").status, "warn");
	assert.equal(item(report, "Install sources").status, "warn");
	assert.equal(item(report, "Skill manifest").status, "warn");
	assert.equal(item(report, "Engine docs").status, "warn");
});

test("report: a healthy setup passes the non-audit items", () => {
	const report = buildDoctorReport({
		pluginRoot: "/tmp/plugin",
		engineVersion: "0.87.1",
		engineDocsDir: process.cwd(),
		changelogHead: ["## 0.87.1", "- fix"],
		settingsPackages: ["git:github.com/mastnacek/pi-plugin-dev"],
		skillManifest: SKILL_OK,
		auditFiles: [],
	});
	assert.equal(item(report, "Engine").status, "info");
	assert.match(item(report, "Engine").details, /0\.87\.1/);
	assert.equal(item(report, "Engine docs").status, "pass");
	assert.equal(item(report, "Install sources").status, "pass");
	assert.equal(item(report, "Skill manifest").status, "pass");
	assert.equal(item(report, "Self-audit").status, "info");
});

test("report: a local-path install fails and names the offender", () => {
	const report = buildDoctorReport({
		pluginRoot: "/tmp/plugin",
		settingsPackages: ["git:github.com/mastnacek/pi-mcp-viz", "D:/01_programovani/pi/plugins/pi-headroom"],
	});
	const entry = item(report, "Install sources");
	assert.equal(entry.status, "fail");
	assert.match(entry.details, /pi-headroom/);
});

test("report: an invalid skill manifest fails", () => {
	const report = buildDoctorReport({ pluginRoot: "/tmp/plugin", skillManifest: SKILL_PARTIAL });
	assert.equal(item(report, "Skill manifest").status, "fail");
});

test("report: self-audit aggregates real findings over source files", () => {
	const broken = [
		'pi.on("turn_start", () => {});',
		'pi.on("turn_end", () => {});',
	].join("\n");
	const report = buildDoctorReport({
		pluginRoot: "/tmp/plugin",
		auditFiles: [{ path: "/tmp/plugin/index.ts", content: broken }],
	});
	const entry = item(report, "Self-audit");
	assert.equal(entry.status, "fail");
	assert.match(entry.details, /Lifecycle Cleanup Rule/);
});

test("report: self-audit passes and counts files when there is nothing to report", () => {
	const report = buildDoctorReport({
		pluginRoot: "/tmp/plugin",
		auditFiles: [{ path: "/tmp/plugin/src/pure.ts", content: "export const answer = 42;\n" }],
	});
	assert.equal(item(report, "Self-audit").status, "pass");
	assert.match(item(report, "Self-audit").details, /1 file/);
});

test("formatDoctorReport renders an icon per status and the plugin root", () => {
	const text = formatDoctorReport(
		buildDoctorReport({ pluginRoot: "/tmp/plugin", engineVersion: "0.87.1", skillManifest: SKILL_OK }),
	);
	assert.match(text, /pi-plugin-dev — doctor/);
	assert.match(text, /root: \/tmp\/plugin/);
	assert.match(text, /• Engine: @earendil-works\/pi-coding-agent 0\.87\.1/);
	assert.match(text, /✓ Skill manifest/);
});

test("locateEnginePackage honours PI_PACKAGE_DIR", () => {
	const pinned = join(process.cwd(), "..", "node_modules", "@earendil-works", "pi-coding-agent");
	if (!existsSync(pinned)) return; // dev layout absent — nothing to assert here
	const previous = process.env.PI_PACKAGE_DIR;
	process.env.PI_PACKAGE_DIR = pinned;
	try {
		const root = locateEnginePackage(process.cwd());
		assert.equal(
			(root ?? "").split(/[\\/]/).join("/").endsWith("node_modules/@earendil-works/pi-coding-agent"),
			true,
		);
	} finally {
		if (previous === undefined) delete process.env.PI_PACKAGE_DIR;
		else process.env.PI_PACKAGE_DIR = previous;
	}
});

test("checkEngineSource passes when the resolved copy matches the running engine", () => {
	const check = checkEngineSource({ running: "1.0.0", resolved: "1.0.0" });
	assert.equal(check.status, "pass");
	assert.match(check.details, /matches the running engine/);
});

test("checkEngineSource warns when the workspace copy lags the running engine", () => {
	const check = checkEngineSource({ running: "1.0.0", resolved: "0.99.2" });
	assert.equal(check.status, "warn");
	assert.match(check.details, /running 1\.0\.0/);
	assert.match(check.details, /workspace copy is 0\.99\.2/);
	assert.match(check.details, /stale API/);
});

test("checkEngineSource stays informational with only one copy to compare", () => {
	assert.equal(checkEngineSource({ running: "1.0.0" }).status, "info");
	assert.equal(checkEngineSource({ resolved: "1.0.0" }).status, "info");
	assert.match(checkEngineSource({}).details, /no running pi engine/);
});

test("report: a mismatched engine source warns on its own row", () => {
	const report = buildDoctorReport({
		pluginRoot: "/tmp/plugin",
		engineVersion: "1.0.0",
		resolvedEngineVersion: "0.99.2",
	});
	const entry = item(report, "Engine source");
	assert.equal(entry.status, "warn");
	assert.match(entry.details, /0\.99\.2/);
});

test("report: a single engine copy produces no mismatch noise", () => {
	const report = buildDoctorReport({ pluginRoot: "/tmp/plugin", engineVersion: "1.0.0" });
	assert.equal(item(report, "Engine source").status, "info");
});

test("locateRunningEnginePackage resolves the engine from the CLI entry", () => {
	const root = locateRunningEnginePackage();
	// Outside a pi process (plain `node --test`) argv[1] is the test runner, so
	// there is nothing to resolve; inside pi it must land on a real package.
	if (root === undefined) return;
	assert.equal(
		root.split(/[\\/]/).join("/").endsWith("node_modules/@earendil-works/pi-coding-agent"),
		true,
	);
});

test("collectDoctorReport finds the engine and this package's own sources", () => {
	// dist/test/doctor.test.js → ../.. is the package root.
	const root = new URL("../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
	const report = collectDoctorReport(root);
	assert.equal(item(report, "Engine").status, "info");
	assert.equal(item(report, "Engine docs").status, "pass");
	assert.equal(item(report, "Skill manifest").status, "pass");
	assert.equal(item(report, "Self-audit").status, "pass");
});
