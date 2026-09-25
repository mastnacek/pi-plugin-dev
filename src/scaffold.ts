import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { generatePackageJson, scaffoldVsaLayout } from "./manifest-template.js";

export interface ScaffoldOptions {
	targetDir: string;
	name?: string;
	description?: string;
	slices?: string[];
}

export interface ScaffoldResult {
	createdFiles: string[];
	targetDir: string;
	name: string;
}

/**
 * Generate a 100% compliant Pi plugin skeleton following:
 * - Vertical Slice Architecture (references/vsa-architecture.md)
 * - Trailing Space Contract for commands (references/command-completions.md)
 * - StringEnum schema rule & throw contract (references/tools-and-schema.md)
 * - Unsubscribe cleanup & subagent recursion guard (references/lifecycle-and-events.md)
 * - Manifest & peerDependencies isolation (package.json)
 */
export function scaffoldPlugin(options: ScaffoldOptions): ScaffoldResult {
	const targetDir = resolve(options.targetDir);
	const name = options.name || basename(targetDir);
	const description = options.description || `Pi coding agent extension: ${name}`;
	const slices = options.slices && options.slices.length > 0
		? options.slices
		: ["pipeline", "tools", "commands", "settings"];

	if (!existsSync(targetDir)) {
		mkdirSync(targetDir, { recursive: true });
	}

	const createdFiles: string[] = [];

	// 1. VSA Directory layout
	const vsaFiles = scaffoldVsaLayout(targetDir, slices);
	for (const f of vsaFiles) createdFiles.push(f);

	// 2. package.json
	const packageJson = generatePackageJson({
		name,
		description,
		extensions: ["./index.ts"],
		extraFiles: ["dist", "src"],
	});
	writeFileSync(
		join(targetDir, "package.json"),
		JSON.stringify(packageJson, null, 2) + "\n",
		"utf8",
	);
	createdFiles.push("package.json");

	// 3. tsconfig.json
	const tsconfig = {
		compilerOptions: {
			target: "ES2022",
			module: "NodeNext",
			moduleResolution: "NodeNext",
			declaration: true,
			outDir: "./dist",
			rootDir: "./",
			strict: true,
			esModuleInterop: true,
			skipLibCheck: true,
			forceConsistentCasingInFileNames: true,
		},
		include: ["index.ts", "src/**/*.ts"],
		exclude: ["node_modules", "dist", "test"],
	};
	writeFileSync(
		join(targetDir, "tsconfig.json"),
		JSON.stringify(tsconfig, null, 2) + "\n",
		"utf8",
	);
	createdFiles.push("tsconfig.json");

	// 4. tsconfig.test.json
	const tsconfigTest = {
		extends: "./tsconfig.json",
		compilerOptions: {
			rootDir: "./",
			outDir: "./dist",
		},
		include: ["index.ts", "src/**/*.ts", "test/**/*.ts"],
		exclude: ["node_modules", "dist"],
	};
	writeFileSync(
		join(targetDir, "tsconfig.test.json"),
		JSON.stringify(tsconfigTest, null, 2) + "\n",
		"utf8",
	);
	createdFiles.push("tsconfig.test.json");

	// 5. Shared state kernel: src/shared/state.ts
	const stateTs = `/**
 * Shared state kernel for ${name}.
 * Shared across slices; slices never import each other directly.
 */

export interface PluginState {
	enabled: boolean;
	lastRunTimestamp: number;
}

export function createInitialState(): PluginState {
	return {
		enabled: true,
		lastRunTimestamp: 0,
	};
}
`;
	writeFileSync(join(targetDir, "src/shared/state.ts"), stateTs, "utf8");
	createdFiles.push("src/shared/state.ts");

	// 6. Slices barrels & starter code
	const commandsIndex = `/**
 * Commands slice for ${name}.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { PluginState } from "../shared/state.js";

export function registerCommands(pi: ExtensionAPI, state: PluginState): void {
	pi.registerCommand("${name}", {
		description: "${description}",
		handler: async (_args, ctx) => {
			if (ctx.hasUI) {
				ctx.ui.notify("${name} is active (state.enabled = " + state.enabled + ")");
			}
		},
	});
}
`;
	writeFileSync(join(targetDir, "src/slices/commands/index.ts"), commandsIndex, "utf8");
	createdFiles.push("src/slices/commands/index.ts");

	const toolsIndex = `/**
 * Tools slice for ${name}.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import type { PluginState } from "../shared/state.js";

const ActionSchema = StringEnum(["status", "ping"] as const);

export function registerTools(pi: ExtensionAPI, state: PluginState): void {
	pi.registerTool({
		name: "${name.replace(/[^a-zA-Z0-9_]/g, "_")}_status",
		description: "Check status of ${name} plugin",
		parameters: Type.Object({
			action: ActionSchema,
		}),
		async execute(_toolCallId, params) {
			if (params.action === "status") {
				return {
					content: [{ type: "text", text: "Plugin ${name} status: OK (enabled=" + state.enabled + ")" }],
				};
			}
			return {
				content: [{ type: "text", text: "pong" }],
			};
		},
	});
}
`;
	writeFileSync(join(targetDir, "src/slices/tools/index.ts"), toolsIndex, "utf8");
	createdFiles.push("src/slices/tools/index.ts");

	// 7. index.ts composition root
	const indexTs = `/**
 * ${name} — Pi coding agent extension.
 *
 * Composition root only: registers listeners, wires slices,
 * drains listeners on session_shutdown, and guards against subagent recursion.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createInitialState } from "./src/shared/state.js";
import { registerCommands } from "./src/slices/commands/index.js";
import { registerTools } from "./src/slices/tools/index.js";

/** Subagent recursion guard: avoid duplicating hooks in child sessions. */
function isDelegatedSession(): boolean {
	return process.env.PI_SUBAGENT === "true" || Boolean(process.env.PI_CHILD_SESSION);
}

export default function (pi: ExtensionAPI): void {
	if (isDelegatedSession()) {
		return;
	}

	const state = createInitialState();
	const unsubscribers: Array<() => void> = [];
	const track = (result: unknown): void => {
		if (typeof result === "function") unsubscribers.push(result as () => void);
	};

	// Wire slices
	registerCommands(pi, state);
	registerTools(pi, state);

	// Drain all listeners on session shutdown
	pi.on("session_shutdown", async () => {
		while (unsubscribers.length > 0) {
			unsubscribers.pop()?.();
		}
	});
}
`;
	writeFileSync(join(targetDir, "index.ts"), indexTs, "utf8");

	// 8. Starter test
	mkdirSync(join(targetDir, "test"), { recursive: true });
	const testTs = `import test from "node:test";
import assert from "node:assert/strict";
import { createInitialState } from "../src/shared/state.js";

test("state kernel initializes with defaults", () => {
	const st = createInitialState();
	assert.equal(st.enabled, true);
	assert.equal(typeof st.lastRunTimestamp, "number");
});
`;
	writeFileSync(join(targetDir, "test/starter.test.ts"), testTs, "utf8");
	createdFiles.push("test/starter.test.ts");

	// 9. README.md
	const readme = `# ${name}

${description}

## Installation

\`\`\`json
// ~/.pi/agent/settings.json or .pi/settings.json
{
  "packages": [
    "git:github.com/mastnacek/${name}"
  ]
}
\`\`\`
`;
	writeFileSync(join(targetDir, "README.md"), readme, "utf8");
	createdFiles.push("README.md");

	return {
		createdFiles,
		targetDir,
		name,
	};
}
