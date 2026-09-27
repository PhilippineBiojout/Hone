/*
 * Codex feature wiring for Hone. Mirrors the `setupScan` pattern: a single
 * `brancherCodex(plugin, …)` call from `main.ts::onload` registers the view,
 * a ribbon icon and a command that show or hide the Codex panel in the right
 * sidedock.
 *
 * The panel drives `codex app-server` over JSON-RPC (see transport.ts / rpc.ts /
 * session.ts). The connection belongs to the plugin (SessionCodex), not to the
 * view: hiding or closing the panel keeps Codex connected. Its config lives in
 * Hone's plugin data (reglages/), read lazily when the session connects.
 */

import { type Plugin, type WorkspaceLeaf } from "fragment";
import { CodexView, VIEW_TYPE_CODEX } from "./view";
import { SessionCodex } from "./session";
import type { CodexSettings } from "../reglages/reglages";

/** Wires the Codex panel into a Hone plugin instance. */
export function brancherCodex(
	plugin: Plugin,
	obtenirReglages: () => CodexSettings,
): void {
	const session = new SessionCodex(plugin.app, obtenirReglages);
	plugin.register(() => session.arreter());

	plugin.registerView(VIEW_TYPE_CODEX, (leaf) => new CodexView(leaf, session));

	const basculer = (): Promise<void> => basculerVue(plugin, session);
	plugin.addRibbonIcon("bot", "Codex : afficher / masquer", () => void basculer());

	plugin.addCommand({
		id: "open-codex-panel",
		name: "Codex : afficher / masquer",
		icon: "bot",
		callback: () => void basculer(),
	});
}

/** `getRightLeaf` and `revealLeaf` exist in the core (Workspace.ts) but are
 *  missing from the published `@usefragment/core` 0.1.0 types. */
interface WorkspaceDroit {
	getRightLeaf(): WorkspaceLeaf;
	revealLeaf(leaf: WorkspaceLeaf): void;
}

/** The panel is open when the right dock is unfolded and shows the Codex tab. */
function estOuvert(plugin: Plugin, session: SessionCodex): boolean {
	if (plugin.app.workspace.rightSplit.collapsed) return false;
	return session.racine.isConnected && session.racine.getClientRects().length > 0;
}

/** Hides the panel if it is open (the dock folds, nothing is torn down), shows it otherwise. */
async function basculerVue(plugin: Plugin, session: SessionCodex): Promise<void> {
	if (estOuvert(plugin, session)) {
		plugin.app.workspace.rightSplit.collapse();
		return;
	}
	await activerVue(plugin);
}

/** Reveal the Codex view in the right sidedock, reusing an existing one.
 *  The leaf must live in a tab pile of the dock: a leaf placed directly in
 *  `rightSplit` (createLeafInParent) is never laid out and stays 0 × 0. */
async function activerVue(plugin: Plugin): Promise<void> {
	const workspace = plugin.app.workspace as typeof plugin.app.workspace & WorkspaceDroit;
	let leaf: WorkspaceLeaf | undefined = workspace.getLeavesOfType(VIEW_TYPE_CODEX)[0];
	// A leaf the old code placed straight in the dock is saved that way in
	// workspace.json and restored as is, still 0 × 0: replace it.
	if (leaf && leaf.parent === workspace.rightSplit) {
		await leaf.detach();
		leaf = undefined;
	}
	if (!leaf) {
		leaf = workspace.getRightLeaf();
		await leaf.setViewState({ type: VIEW_TYPE_CODEX, active: true });
	}
	workspace.revealLeaf(leaf);
}
