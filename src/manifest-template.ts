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
