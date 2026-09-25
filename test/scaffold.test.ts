import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scaffoldPlugin } from "../src/scaffold.js";

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
