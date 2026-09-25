import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { scaffoldPlugin } from "./scaffold.js";

export function registerScaffoldTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "plugin_dev_scaffold",
		label: "Plugin Dev Scaffold",
		description:
			"Scaffold a 100% compliant Pi coding agent plugin with VSA layout, peerDependencies isolation, TypeBox schemas, and tests.",
		parameters: Type.Object({
			targetDir: Type.String({ description: "Target directory path for the plugin" }),
			name: Type.Optional(Type.String({ description: "Plugin package name" })),
			description: Type.Optional(Type.String({ description: "Short description of the plugin" })),
		}),
		async execute(_toolCallId, params) {
			const res = scaffoldPlugin({
				targetDir: params.targetDir,
				name: params.name,
				description: params.description,
			});
			return {
				content: [
					{
						type: "text",
						text: `Plugin '${res.name}' successfully scaffolded in ${res.targetDir} (${res.createdFiles.length} files created):\n- ` +
							res.createdFiles.join("\n- "),
					},
				],
				details: {
					name: res.name,
					targetDir: res.targetDir,
					createdFiles: res.createdFiles,
				},
			};
		},
	});
}
