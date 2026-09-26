import { ItemView, Modal, setIcon, type App, type WorkspaceLeaf } from 'fragment';
import { eclore, type Eclosion } from './eclosion';
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

		// Pas encore accepté, ou refusé : rien n'est téléchargé, et on peut changer d'avis.
		if (this.plugin.autorise !== true) {
			el(racine, 'p', 'remarkable-refus', 'Tu n’as pas accepté que Fragment télécharge les dossiers et documents de la reMarkable.');
			const b = el(racine, 'button', 'mod-cta', 'Autoriser');
			b.addEventListener('click', () => void this.plugin.autoriser(true));
			return;
		}

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

/**
 * La demande, au premier clic sur l'icône de la tablette. Elle en sort comme
 * une carte de l'agent (le rond de l'icône devient la carte), et s'ouvre à côté,
 * sans voile. Fermée sans réponse (Échap, clic à côté), elle reviendra au prochain clic.
 */
export class DemandeAutorisation extends Modal {
	private eclosion: Eclosion | null = null;

	constructor(app: App, private readonly icone: HTMLElement, private readonly repondre: (oui: boolean) => void) {
		super(app);
		this.setTitle('reMarkable');
		this.containerEl.classList.add('remarkable-demande');
	}

	onOpen(): void {
		el(this.contentEl, 'p', '', 'Autoriser Fragment à télécharger les dossiers et documents de la reMarkable, en PDF, dans reMarkable/ ?');
		const boutons = el(this.contentEl, 'div', 'remarkable-boutons');
		for (const [texte, oui] of [['Refuser', false], ['Autoriser', true]] as const) {
			const b = el(boutons, 'button', oui ? 'mod-cta' : '', texte);
			b.addEventListener('click', () => {
				this.close();
				this.repondre(oui);
			});
		}

		// À 8 px à droite de l'icône, alignée sur son haut, sans sortir de l'écran.
		const r = this.icone.getBoundingClientRect();
		const carte = this.modalEl;
		carte.style.left = `${r.right + 8}px`;
		carte.style.top = `${Math.max(8, Math.min(r.top, window.innerHeight - carte.offsetHeight - 8))}px`;
		this.eclosion = eclore(this.icone, carte);
	}

	onClose(): void {
		this.eclosion?.annuler();
	}
}
