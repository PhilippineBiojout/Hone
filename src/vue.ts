import { ItemView, setIcon, type WorkspaceLeaf } from 'fragment';
import type RemarkablePlugin from './main';

export const VUE_REMARKABLE = 'remarkable-view';

function el<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, cls: string, texte?: string): HTMLElementTagNameMap[K] {
	const e = document.createElement(tag);
	e.className = cls;
	if (texte !== undefined) e.textContent = texte;
	parent.append(e);
	return e;
}

/**
 * L'état de la synchro : la tablette, où est chaque carnet dans le vault, et
 * de quoi récupérer un carnet ou un dossier qu'on avait supprimé du vault.
 */
export class VueRemarkable extends ItemView {
	constructor(leaf: WorkspaceLeaf, private readonly plugin: RemarkablePlugin) {
		super(leaf);
		this.icon = 'tablet';
	}

	getViewType(): string {
		return VUE_REMARKABLE;
	}

	getDisplayText(): string {
		return 'reMarkable';
	}

	protected async onOpen(): Promise<void> {
		this.addAction('refresh-cw', 'Tout retélécharger', () => void this.plugin.toutRetelecharger());
		this.contentEl.classList.add('remarkable-vue');
		this.dessiner();
	}

	protected async onClose(): Promise<void> {
		this.contentEl.replaceChildren();
	}

	dessiner(): void {
		const { synchro, registre } = this.plugin;
		const racine = this.contentEl;
		racine.replaceChildren();

		const etat = el(racine, 'div', 'remarkable-etat');
		etat.dataset.connectee = String(synchro.connectee);
		etat.textContent =
			synchro.connectee === null ? 'recherche de la tablette…'
				: synchro.connectee ? `connectée${synchro.derniere ? `, vue à ${new Date(synchro.derniere).toLocaleTimeString('fr-FR')}` : ''}`
				: 'injoignable';

		const liste = el(racine, 'div', 'remarkable-liste');
		const surTablette = new Set<string>();
		for (const item of synchro.elements) {
			surTablette.add(item.id);
			const ligne = el(liste, 'div', 'remarkable-ligne');
			ligne.style.paddingLeft = `${item.chemin.split('/').length - 1}em`;
			const icone = el(ligne, 'span', 'remarkable-icone');
			setIcon(icone, item.dossier ? 'folder' : 'file-text');
			el(ligne, 'span', 'remarkable-nom', item.nom);

			if (item.dossier) {
				const ignores = this.plugin.ignoresSous(item.chemin);
				if (ignores.length > 0) this.bouton(ligne, `Récupérer le dossier (${ignores.length})`, () => this.plugin.recuperer(ignores));
				continue;
			}
			const e = registre.get(item.id);
			if (e?.ignore) {
				ligne.classList.add('remarkable-ignore');
				el(ligne, 'span', 'remarkable-ou', 'non suivi');
				this.bouton(ligne, 'Récupérer', () => this.plugin.recuperer([item.id]));
			} else if (e?.chemin) {
				const lien = el(ligne, 'span', 'remarkable-ou remarkable-lien', e.chemin);
				const chemin = e.chemin;
				lien.addEventListener('click', () => void this.ouvrir(chemin));
			} else {
				el(ligne, 'span', 'remarkable-ou', 'en attente');
			}
		}

		const partis = Object.entries(registre.carnets).filter(([id, e]) => !surTablette.has(id) && e.chemin);
		if (synchro.connectee && partis.length > 0) {
			el(racine, 'h4', 'remarkable-titre', 'Plus sur la tablette');
			for (const [, e] of partis) el(racine, 'div', 'remarkable-ligne remarkable-ou', e.chemin ?? '');
		}

		el(racine, 'pre', 'remarkable-journal', synchro.journal.slice(-15).join('\n'));
	}

	private bouton(parent: HTMLElement, titre: string, action: () => void): void {
		const b = el(parent, 'button', 'clickable-icon remarkable-recuperer');
		b.title = titre;
		b.setAttribute('aria-label', titre);
		setIcon(b, 'download');
		b.addEventListener('click', action);
	}

	private async ouvrir(chemin: string): Promise<void> {
		const f = this.app.vault.getFileByPath(chemin);
		if (f) await this.app.workspace.getLeaf(false).openFile(f);
	}
}
