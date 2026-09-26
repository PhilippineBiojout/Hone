import { ItemView, setIcon, type WorkspaceLeaf } from 'fragment';
import type RemarkablePlugin from './main';

export const VUE_REMARKABLE = 'remarkable-view';

function el<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, cls: string, texte = ''): HTMLElementTagNameMap[K] {
	const e = document.createElement(tag);
	e.className = cls;
	e.textContent = texte;
	parent.append(e);
	return e;
}

/**
 * Les carnets de la tablette, où chacun est dans le vault, un bouton pour
 * récupérer ce qu'on avait supprimé, et le journal de la synchro.
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
		this.contentEl.classList.add('remarkable-vue');
		this.dessiner();
	}

	dessiner(): void {
		const { synchro, registre } = this.plugin;
		const racine = this.contentEl;
		racine.replaceChildren();

		const etat = synchro.connectee === null ? 'recherche de la tablette…' : synchro.connectee ? 'connectée' : 'injoignable';
		el(racine, 'div', 'remarkable-etat', etat).dataset.connectee = String(synchro.connectee);

		for (const item of synchro.elements) {
			const ligne = el(racine, 'div', 'remarkable-ligne');
			ligne.style.paddingLeft = `${item.chemin.split('/').length - 1}em`;
			setIcon(el(ligne, 'span', 'remarkable-icone'), item.dossier ? 'folder' : 'file-text');
			el(ligne, 'span', 'remarkable-nom', item.nom);

			if (item.dossier) {
				// Les carnets non suivis sous ce dossier.
				const ignores = synchro.elements
					.filter((x) => !x.dossier && x.chemin.startsWith(item.chemin + '/') && registre.carnets[x.id]?.ignore)
					.map((x) => x.id);
				if (ignores.length > 0) this.bouton(ligne, `Récupérer le dossier (${ignores.length})`, ignores);
			} else if (registre.carnets[item.id]?.ignore) {
				el(ligne, 'span', 'remarkable-ou', 'non suivi');
				this.bouton(ligne, 'Récupérer', [item.id]);
			} else {
				el(ligne, 'span', 'remarkable-ou', registre.carnets[item.id]?.chemin ?? 'en attente');
			}
		}

		el(racine, 'pre', 'remarkable-journal', synchro.journal.slice(-15).join('\n'));
	}

	private bouton(ligne: HTMLElement, titre: string, ids: string[]): void {
		const b = el(ligne, 'button', 'clickable-icon remarkable-recuperer');
		b.title = titre;
		b.setAttribute('aria-label', titre);
		setIcon(b, 'download');
		b.addEventListener('click', () => void this.plugin.recuperer(ids));
	}
}
