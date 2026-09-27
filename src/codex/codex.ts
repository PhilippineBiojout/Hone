/*
 * Codex feature wiring for Hone. Mirrors the `brancherScan` pattern: a single
 * `brancherCodex(plugin, …)` call from `main.ts::onload` registers the view,
 * a ribbon icon and a command that reveal the Codex panel in the right sidedock.
 *
 * The panel drives `codex app-server` over JSON-RPC (see transport.ts / rpc.ts /
 * view.ts). Its config lives in Hone's plugin data (reglages/), read lazily so a
 * settings change is picked up next time the panel connects.
 */

import { type Plugin, type WorkspaceLeaf } from "fragment";
import { CodexView, VIEW_TYPE_CODEX } from "./view";
import type { CodexSettings } from "../reglages/reglages";

/** Wires the Codex panel into a Hone plugin instance. */
export function brancherCodex(
	plugin: Plugin,
	obtenirReglages: () => CodexSettings,
): void {
	plugin.registerView(
		VIEW_TYPE_CODEX,
		(leaf) => new CodexView(leaf, plugin.app, obtenirReglages),
	);

	plugin.addRibbonIcon("bot", "Open Codex", () => void activerVue(plugin));

	plugin.addCommand({
		id: "open-codex-panel",
		name: "Open Codex panel",
		icon: "bot",
		callback: () => void activerVue(plugin),
	});
}

/** `getRightLeaf` and `revealLeaf` exist in the core (Workspace.ts) but are
 *  missing from the published `@usefragment/core` 0.1.0 types. */
interface WorkspaceDroit {
	getRightLeaf(): WorkspaceLeaf;
	revealLeaf(leaf: WorkspaceLeaf): void;
}

/** Reveal the Codex view in the right sidedock, reusing an existing one.
 *  The leaf must live in a tab pile of the dock: a leaf placed directly in
 *  `rightSplit` (createLeafInParent) is never laid out and stays 0 × 0. */
async function activerVue(plugin: Plugin): Promise<void> {
	const workspace = plugin.app.workspace as typeof plugin.app.workspace & WorkspaceDroit;
	let leaf = workspace.getLeavesOfType(VIEW_TYPE_CODEX)[0];
	if (!leaf) {
		leaf = workspace.getRightLeaf();
		await leaf.setViewState({ type: VIEW_TYPE_CODEX, active: true });
	}
	workspace.revealLeaf(leaf);
}
