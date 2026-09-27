import { Modal, type App } from 'fragment';
import { creer } from './dom';
import { eclore, type Eclosion } from './eclosion';

/**
 * Ce que dit la carte. Au clic sur l'icône après un refus : le rappel. Depuis
 * les commandes « reMarkable: sync » et « reMarkable: show live status » :
 * l'état, et les boutons disent ce qu'ils font.
 */
export type Question = 'rappel' | 'active' | 'coupee' | 'affiche' | 'masque';

const TEXTES: Record<Question, { question: string; non: string; oui: string }> = {
	rappel: { question: 'Autoriser Fragment à télécharger les dossiers et documents de la reMarkable, en PDF, dans reMarkable/ ?', non: 'Refuser', oui: 'Autoriser' },
	active: { question: 'La synchro de la reMarkable est active. La garder ?', non: 'Couper', oui: 'Garder' },
	coupee: { question: 'La synchro est coupée. La relancer ?', non: 'Laisser coupée', oui: 'Relancer' },
	affiche: { question: 'Le statut live est affiché. Le garder ?', non: 'Masquer', oui: 'Garder' },
	masque: { question: 'Le statut live est masqué. L’afficher ?', non: 'Laisser masqué', oui: 'Afficher' },
};

/**
 * La carte qui pose la question, au clic sur l'icône de la tablette tant que
 * la synchro est coupée, ou depuis une commande. Elle sort de l'icône comme une
 * carte de l'agent (le rond de l'icône devient la carte), et s'ouvre à côté,
 * sans voile. Fermée sans réponse (Échap, clic à côté), rien ne change.
 */
export class DemandeAutorisation extends Modal {
	private eclosion: Eclosion | null = null;

	constructor(
		app: App,
		private readonly icone: HTMLElement,
		private readonly question: Question,
		private readonly repondre: (oui: boolean) => void,
	) {
		super(app);
		this.setTitle('reMarkable');
		this.containerEl.classList.add('remarkable-demande');
	}

	onOpen(): void {
		const t = TEXTES[this.question];
		if (this.question === 'rappel') creer(this.contentEl, 'p', 'remarkable-refus', 'Tu n’as pas accepté que Fragment télécharge les dossiers et documents de la reMarkable.');
		creer(this.contentEl, 'p', '', t.question);
		const boutons = creer(this.contentEl, 'div', 'remarkable-boutons');
		for (const [texte, oui] of [[t.non, false], [t.oui, true]] as const) {
			const b = creer(boutons, 'button', oui ? 'mod-cta' : '', texte);
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
