import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scaffoldPlugin } from "../src/scaffold.js";
import { checkMultilingualUi } from "../src/i18n-auditor.js";

test("scaffoldPlugin generates a fully compliant Pi plugin layout", () => {
	const tmp = mkdtempSync(join(tmpdir(), "pi-scaffold-test-"));
	try {
		const targetDir = join(tmp, "my-test-plugin");
		const res = scaffoldPlugin({
			targetDir,
			name: "my-test-plugin",
			description: "Test plugin description",
		});

		assert.equal(res.name, "my-test-plugin");
		assert.ok(res.createdFiles.includes("package.json"));
		assert.ok(res.createdFiles.includes("index.ts"));
		assert.ok(res.createdFiles.includes("src/shared/state.ts"));
		assert.ok(res.createdFiles.includes("src/slices/commands/index.ts"));
		assert.ok(res.createdFiles.includes("src/slices/tools/index.ts"));
		assert.ok(res.createdFiles.includes("test/starter.test.ts"));

		const pkgRaw = readFileSync(join(targetDir, "package.json"), "utf8");
		const pkg = JSON.parse(pkgRaw);
		assert.equal(pkg.type, "module");
		assert.ok(pkg.peerDependencies["@earendil-works/pi-ai"]);
		assert.ok(pkg.peerDependencies["@earendil-works/pi-coding-agent"]);
		assert.ok(!pkg.dependencies || !pkg.dependencies["@earendil-works/pi-ai"]);

		const indexTs = readFileSync(join(targetDir, "index.ts"), "utf8");
		assert.match(indexTs, /isDelegatedSession/);
		assert.match(indexTs, /session_shutdown/);
	} finally {
		rmSync(tmp, { recursive: true, force: true });
	}
});

test("a scaffolded plugin is Czech + English from the first commit", () => {
	const tmp = mkdtempSync(join(tmpdir(), "pi-scaffold-i18n-"));
	try {
		const targetDir = join(tmp, "demo-i18n");
		const res = scaffoldPlugin({ targetDir, name: "demo-i18n", description: "Demo" });

		assert.ok(res.createdFiles.includes("src/shared/i18n.ts"));
		assert.ok(res.createdFiles.includes("test/i18n.test.ts"));

		const i18n = readFileSync(join(targetDir, "src/shared/i18n.ts"), "utf8");
		assert.match(i18n, /LOCALES = \["en", "cs"\] as const/);
		assert.match(i18n, /cs: \{/);
		assert.match(i18n, /export function stringsFor/);
		assert.match(i18n, /export function normalizeLocale/);

		const state = readFileSync(join(targetDir, "src/shared/state.ts"), "utf8");
		assert.match(state, /lang: Locale/);
		assert.match(state, /lang: DEFAULT_LOCALE/);

		// The generated slices must pass the plugin's own Multilingual UI rule.
		const commands = readFileSync(join(targetDir, "src/slices/commands/index.ts"), "utf8");
		assert.deepEqual(checkMultilingualUi("src/slices/commands/index.ts", commands), []);
		assert.match(commands, /stringsFor\(state\.lang\)/);
		assert.match(commands, /LOCALES/);
	} finally {
		rmSync(tmp, { recursive: true, force: true });
	}
});
