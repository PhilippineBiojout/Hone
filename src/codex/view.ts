/*
 * CodexView — an ItemView in the right sidedock that only lends its content
 * element to the plugin's SessionCodex (session.ts). Closing the view detaches
 * the panel without stopping Codex: the conversation lives on in the session.
 */

import { ItemView, type WorkspaceLeaf } from "fragment";
import type { SessionCodex } from "./session";

export const VIEW_TYPE_CODEX = "codex-on-fragment-view";

export class CodexView extends ItemView {
	constructor(
		leaf: WorkspaceLeaf,
		private readonly session: SessionCodex,
	) {
		super(leaf);
		this.icon = "bot";
	}

	getViewType(): string {
		return VIEW_TYPE_CODEX;
	}

	getDisplayText(): string {
		return "Codex";
	}

	protected async onOpen(): Promise<void> {
		this.session.attacher(this.contentEl);
	}

	protected async onClose(): Promise<void> {
		// Only if the panel is still ours: a newer view may already hold it.
		if (this.contentEl.contains(this.session.racine)) this.session.detacher();
	}
}
