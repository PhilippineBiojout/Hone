import { Modal, type App } from 'fragment';
import { eclore, type Eclosion } from './eclosion';

function el<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, cls: string, texte = ''): HTMLElementTagNameMap[K] {
	const e = document.createElement(tag);
	e.className = cls;
	e.textContent = texte;
	parent.append(e);
	return e;
}

/**
 * La demande, au clic sur l'icône de la tablette tant qu'on n'a pas accepté.
 * Elle en sort comme une carte de l'agent (le rond de l'icône devient la
 * carte), et s'ouvre à côté, sans voile. Fermée sans réponse (Échap, clic à
 * côté), elle reviendra au prochain clic. Après un refus, elle le rappelle.
 */
export class DemandeAutorisation extends Modal {
	private eclosion: Eclosion | null = null;

	constructor(
		app: App,
		private readonly icone: HTMLElement,
		private readonly refusee: boolean,
		private readonly repondre: (oui: boolean) => void,
	) {
		super(app);
		this.setTitle('reMarkable');
		this.containerEl.classList.add('remarkable-demande');
	}

	onOpen(): void {
		if (this.refusee) el(this.contentEl, 'p', 'remarkable-refus', 'Tu n’as pas accepté que Fragment télécharge les dossiers et documents de la reMarkable.');
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
