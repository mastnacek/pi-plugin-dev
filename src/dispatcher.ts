import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { collectDoctorReport, formatDoctorReport } from "./doctor.js";
import { saveConfig } from "./config.js";
import { scaffoldPlugin } from "./scaffold.js";
import type { SkillTracker } from "./tracker.js";
import type { PluginDevConfig } from "./types.js";
import { closeSkillHud } from "./visuals/hud.js";
import { clearSkillWidget } from "./visuals/widget.js";
import { showSkillDashboard } from "./visuals/dashboard.js";

export async function dispatchPluginDev(
	args: string,
	ctx: ExtensionCommandContext,
	config: PluginDevConfig,
	tracker: SkillTracker,
	onPersist: (cfg: PluginDevConfig) => void,
): Promise<void> {
	const tokens = args.trim().split(/\s+/).filter(Boolean);
	const isGlobal = tokens.some((t) => t.toLowerCase() === "--global");
	const cleanTokens = tokens.filter((t) => t.toLowerCase() !== "--global");
	const sub = (cleanTokens[0] ?? "").toLowerCase();
	const val = (cleanTokens[1] ?? "").toLowerCase();

	if (!sub || sub === "help" || sub === "-h" || sub === "--help") {
		const help = [
			"# /plugin-dev — Vizualizér & Auditor plnění skillů",
			"",
			"Sleduje kroky agenta řízeného skillem v reálném čase a audituje dodržování",
			"architektonických pravidel (Trailing Space Contract, StringEnum, ErrorThrow).",
			"",
			"Příkazy:",
			"  /plugin-dev dashboard    — Otevřít interaktivní TUI dashboard (Scorecard, Invariants, Doctor)",
			"  /plugin-dev scaffold <dir> — Vygenerovat 100% compliant VSA kostru Pi pluginu",
			"  /plugin-dev status       — Zobrazit aktuální stav sledování a scorecard pravidel",
			"  /plugin-dev doctor       — Engine, instalace, skill manifest, self-audit",
			"  /plugin-dev hud on|off   — Plovoucí HUD overlay v pravém horním rohu",
			"  /plugin-dev widget on|off— Dokovaný stavový widget nad editorem",
			"  /plugin-dev card on|off  — Souhrnná karta auditu do chatu po dokončení",
			"  /plugin-dev install on|off — Nabízet instalaci z GitHubu po commit+push",
			"  /plugin-dev reset        — Vynulovat historii a načtené reference",
			"  /plugin-dev help         — Tato nápověda",
			"",
			`Aktivní stav: HUD=${config.hud ? "ON" : "OFF"} | Widget=${config.widget ? "ON" : "OFF"} | Card=${config.transcriptCard ? "ON" : "OFF"} | Install=${config.installOffer ? "ON" : "OFF"}`,
		].join("\n");
		ctx.ui.notify(help, "info");
		return;
	}

	if (sub === "dashboard") {
		if (ctx.mode !== "tui") {
			ctx.ui.notify("Interaktivní dashboard vyžaduje TUI režim.", "warning");
			return;
		}
		await showSkillDashboard(ctx, tracker.getState(), config);
		return;
	}

	if (sub === "scaffold") {
		const target = cleanTokens[1] ?? "my-plugin";
		const absTarget = resolve(ctx.cwd, target);
		try {
			const res = scaffoldPlugin({ targetDir: absTarget });
			ctx.ui.notify(
				`✅ Plugin "${res.name}" úspěšně vygenerován v ${target} (${res.createdFiles.length} souborů, VSA layout, peerDeps).`,
				"info",
			);
		} catch (err) {
			ctx.ui.notify(
				`❌ Chyba při generování kostry pluginu: ${err instanceof Error ? err.message : String(err)}`,
				"error",
			);
		}
		return;
	}

	if (sub === "status") {
		const st = tracker.getState();
		const passed = st.compliance.filter((c) => c.status === "pass").length;
		const total = st.compliance.length;
		const score = total > 0 ? `${passed}/${total} [${Math.round((passed / total) * 100)}%]` : "žádné kontroly neproběhly";

		const lines = [
			"🎯 [pi-plugin-dev — Auditní zpráva]",
			`- Aktivní skill: ${st.activeSkill ?? "žádný"}`,
			`- Načtené reference (${st.references.size}): ${Array.from(st.references.keys()).join(", ") || "žádné"}`,
			`- Prohlédnuté soubory: ${st.inspectedFiles.size}`,
			`- Modifikované soubory: ${st.modifiedFiles.size}`,
			`- Skóre shody s pravidly: ${score}`,
		];

		if (st.compliance.length > 0) {
			lines.push("", "Pravidla:");
			for (const c of st.compliance) {
				lines.push(`  ${c.status === "pass" ? "✓" : "✗"} [${c.rule}] ${c.label}: ${c.details}`);
			}
		}

		ctx.ui.notify(lines.join("\n"), "info");
		return;
	}

	if (sub === "doctor") {
		const root = fileURLToPath(new URL(".", import.meta.url));
		let message: string;
		try {
			message = formatDoctorReport(collectDoctorReport(root));
		} catch (error) {
			message = `🩺 doctor selhal: ${error instanceof Error ? error.message : String(error)}`;
		}
		ctx.ui.notify(message, "info");
		return;
	}

	if (sub === "reset") {
		tracker.reset();
		closeSkillHud();
		clearSkillWidget(ctx);
		ctx.ui.notify("Stav sledování byl vynulován.", "info");
		return;
	}

	if (sub === "hud") {
		config.hud = val !== "off";
		saveConfig(config, isGlobal, ctx.cwd);
		onPersist(config);
		if (!config.hud) closeSkillHud();
		ctx.ui.notify(`Plovoucí HUD: ${config.hud ? "ZAPNUTO (ON)" : "VYPNUTO (OFF)"}`, "info");
		return;
	}

	if (sub === "widget") {
		config.widget = val !== "off";
		saveConfig(config, isGlobal, ctx.cwd);
		onPersist(config);
		if (!config.widget) clearSkillWidget(ctx);
		ctx.ui.notify(`Dokovaný widget: ${config.widget ? "ZAPNUTO (ON)" : "VYPNUTO (OFF)"}`, "info");
		return;
	}

	if (sub === "card") {
		config.transcriptCard = val !== "off";
		saveConfig(config, isGlobal, ctx.cwd);
		onPersist(config);
		ctx.ui.notify(`Souhrnná karta do chatu: ${config.transcriptCard ? "ZAPNUTO (ON)" : "VYPNUTO (OFF)"}`, "info");
		return;
	}

	if (sub === "install") {
		config.installOffer = val !== "off";
		saveConfig(config, isGlobal, ctx.cwd);
		onPersist(config);
		ctx.ui.notify(
			`Nabídka instalace z GitHubu po commit+push: ${config.installOffer ? "ZAPNUTO (ON)" : "VYPNUTO (OFF)"}`,
			"info",
		);
		return;
	}

	ctx.ui.notify(`Neznámý parametr "${sub}". Použijte: /plugin-dev help`, "warning");
}
