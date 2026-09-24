/**
 * Config-cascade auditor tests — the mandatory --global behavior contract.
 * Reference implementation: pi-decision-gate (saveConfig(cfg, isGlobal, cwd)).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { ALL_INVARIANTS } from "../src/auditor.js";
import { checkConfigCascade } from "../src/config-cascade-auditor.js";


// --------------------------------------------------- config cascade (--global)

test("config cascade: mutating command without --global fails", () => {
	const code = [
		"export function registerCommands(pi: ExtensionAPI) {",
		"  pi.registerCommand(\"gate\", {",
		"    handler: async (args, ctx) => {",
		"      state.config.enabled = true;",
		"      saveConfig(state.config);",
		"    },",
		"  });",
		"}",
	].join("\n");
	const findings = checkConfigCascade("src/slices/commands/index.ts", code);
	assert.equal(findings.length, 1, "missing --global parsing must fail");
	assert.match(findings[0]?.hint ?? "", /pi-decision-gate/);
});

test("config cascade: handler parsing --global passes", () => {
	const code = [
		"const tokens = args.split(/\s+/);",
		"const isGlobal = tokens.some((t) => t === \"--global\");",
		"const clean = tokens.filter((t) => t !== \"--global\");",
		"state.config.enabled = true;",
		"saveConfig(state.config, isGlobal, ctx.cwd);",
	].join("\n");
	const findings = checkConfigCascade("src/slices/commands/index.ts", code);
	assert.equal(findings.length, 0);
});

test("config cascade: project-only config module without global write fails", () => {
	const code = [
		'import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";',
		'import { join } from "node:path";',
		"export function saveConfig(cfg: Cfg, cwd?: string): void {",
		'  mkdirSync(join(cwd ?? ".", ".pi"), { recursive: true });',
		'  writeFileSync(join(cwd ?? ".", ".pi", "my-plugin.json"), JSON.stringify(cfg));',
		"}",
		"export function loadConfig(cwd?: string): Cfg {",
		'  const p = join(cwd ?? ".", ".pi", "my-plugin.json");',
		"  if (existsSync(p)) return JSON.parse(readFileSync(p, \"utf8\"));",
		"  return { ...DEFAULT_CONFIG };",
		"}",
	].join("\n");
	const findings = checkConfigCascade("src/shared/config.ts", code);
	assert.equal(findings.length, 1, "no global write path must fail");
	assert.match(findings[0]?.problem ?? "", /global/);
});

test("config cascade: cascade loader with global file passes", () => {
	const code = [
		'import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";',
		'import { homedir } from "node:os";',
		'import { join } from "node:path";',
		'const GLOBAL_CONFIG_FILE = join(homedir(), ".pi", "agent", "my-plugin.json");',
		"export function loadConfig(cwd?: string): Cfg {",
		"  let merged = { ...DEFAULT_CONFIG };",
		"  if (existsSync(GLOBAL_CONFIG_FILE)) merged = { ...merged, ...JSON.parse(readFileSync(GLOBAL_CONFIG_FILE, 'utf8')) };",
		'  const proj = join(cwd ?? ".", ".pi", "my-plugin.json");',
		"  if (existsSync(proj)) merged = { ...merged, ...JSON.parse(readFileSync(proj, 'utf8')) };",
		"  return merged;",
		"}",
		"export function saveConfig(cfg: Cfg, global = false, cwd?: string): void {",
		"  if (global) writeFileSync(GLOBAL_CONFIG_FILE, JSON.stringify(cfg));",
		'  else { mkdirSync(join(cwd ?? ".", ".pi"), { recursive: true }); writeFileSync(join(cwd, ".pi", "my-plugin.json"), JSON.stringify(cfg)); }',
		"}",
	].join("\n");
	assert.equal(checkConfigCascade("src/shared/config.ts", code).length, 0);
});

test("config cascade: ALL_INVARIANTS includes config-cascade", () => {
	assert.equal(ALL_INVARIANTS.has("config-cascade"), true);
});

