/**
 * Standard package.json template for Pi coding agent packages.
 * Based on official engine documentation: docs/packages.md
 */

export interface PackageJsonTemplateOptions {
	name: string;
	description: string;
	author?: string;
	license?: string;
	version?: string;
	/** Extension entry files, e.g. ["./index.ts"] */
	extensions?: string[];
	/** Skill directories or glob patterns, e.g. ["./skills/my-skill"] */
	skills?: string[];
	/** Prompt glob patterns, e.g. ["./prompts/*.md"] */
	prompts?: string[];
	/** Theme glob patterns, e.g. ["./themes/*.json"] */
	themes?: string[];
	/** Additional files to include in package tarball */
	extraFiles?: string[];
	/** Additional runtime npm dependencies */
	dependencies?: Record<string, string>;
}

/**
 * Scaffold the VSA folder skeleton for a new Pi plugin (see
 * references/vsa-architecture.md in the skill): thin index.ts composition
 * root, src/shared/ kernel, src/slices/<feature>/ with barrels.
 */
export function scaffoldVsaLayout(pluginRoot: string, sliceNames: string[] = []): string[] {
	const path = require("node:path") as typeof import("node:path");
	const fs = require("node:fs") as typeof import("node:fs");
	const created: string[] = [];

	const dirs = [
		"src/shared",
		"src/slices/pipeline",
		"src/slices/tools",
		"src/slices/commands",
		"src/slices/settings",
		...sliceNames.map((s) => `src/slices/${s}`),
	];
	for (const dir of dirs) {
		fs.mkdirSync(path.join(pluginRoot, dir), { recursive: true });
		created.push(dir);
	}

	const indexTs = `/**
 * ${path.basename(pluginRoot)} — composition root.
 *
 * Composition root ONLY: creates the plugin state kernel and wires slices
 * onto Pi events. No business logic lives here. Layout and slice-membership
 * rules: pi-plugin-dev skill, references/vsa-architecture.md.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function pluginExtension(pi: ExtensionAPI): void {
	// Create the shared state kernel (src/shared/state.ts), then:
	// registerPipeline(pi, state); registerModelTools(pi, state);
	// registerCommands(pi, state); and drain listeners on session_shutdown.
}
`;
	fs.writeFileSync(path.join(pluginRoot, "index.ts"), indexTs, "utf8");
	created.push("index.ts");

	return created;
}

export function generatePackageJson(options: PackageJsonTemplateOptions): Record<string, unknown> {
	const extensions = options.extensions ?? ["./index.ts"];
	const files = Array.from(
		new Set(["README.md", "package.json", ...extensions, ...(options.extraFiles ?? [])]),
	);

	const piManifest: Record<string, string[]> = {};
	if (extensions.length > 0) piManifest.extensions = extensions;
	if (options.skills && options.skills.length > 0) piManifest.skills = options.skills;
	if (options.prompts && options.prompts.length > 0) piManifest.prompts = options.prompts;
	if (options.themes && options.themes.length > 0) piManifest.themes = options.themes;

	const pkg: Record<string, unknown> = {
		name: options.name,
		version: options.version ?? "0.1.0",
		description: options.description,
		type: "module",
		main: extensions[0] ?? "index.ts",
		keywords: ["pi", "pi-package", "pi-extension"],
		author: options.author ?? "mastnacek",
		license: options.license ?? "MIT",
		files,
		pi: piManifest,
		peerDependencies: {
			"@earendil-works/pi-agent-core": "*",
			"@earendil-works/pi-ai": "*",
			"@earendil-works/pi-coding-agent": "*",
			"@earendil-works/pi-tui": "*",
			typebox: "*",
		},
		scripts: {
			test: "node --test test/**/*.test.js",
		},
	};

	if (options.dependencies && Object.keys(options.dependencies).length > 0) {
		pkg.dependencies = options.dependencies;
	}

	return pkg;
}
