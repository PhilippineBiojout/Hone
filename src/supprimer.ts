import { boutonIcone } from './bouton';

// ═══════════════════════════════════════════════════════════════════════════
//  Le pied d'une carte d'outil ou d'un chat. Deux boutons :
//
//  - la tête de chat, à droite, sur toute carte dont la réponse est arrivée :
//    la carte devient un chat sur cette réponse (agentLayer) ;
//  - la poubelle, à gauche, seulement sur une réponse rouverte depuis la marge
//    (traces.ts). Un clic la remplace par une confirmation, « Annuler » et « Supprimer » en
//  rouge. « Supprimer » retire l'annotation : l'icône de la marge, la réponse
//  gardée et le trait d'encre. C'est le calque (agentLayer) qui le fait.
//
//  ★ POURQUOI une confirmation DANS la carte et pas une boîte du navigateur :
//    une boîte modale bloque la fenêtre, et la carte est non modale ; la
//    question se pose là où l'on a cliqué.
//
//  La poubelle est masquée tant qu'on ne l'a pas montrée : une réponse qui
//  vient d'arriver n'est pas encore une annotation de la marge. Le pied
//  entier l'est quand aucun des deux boutons n'est montré.
// ═══════════════════════════════════════════════════════════════════════════

export class PiedSupprimer {

    readonly el: HTMLElement;
    private readonly poubelleEl: HTMLButtonElement;
    private readonly confirmationEl: HTMLElement;
    private readonly annulerEl: HTMLButtonElement;
    /** La tête de chat : absente du pied d'un chat, qui est déjà une conversation. */
    readonly discuterEl: HTMLButtonElement | null = null;
    private poubelle = false;
    private discuter = false;

    constructor(onSupprimer: () => void, onDiscuter?: () => void) {
        this.el = document.createElement('div');
        this.el.classList.add('agent-pied');
        this.el.hidden = true;

        this.poubelleEl = boutonIcone(this.el, 'trash-2', "Supprimer l'annotation",
            () => this.confirmer(true), 'agent-pied-bouton', 'agent-pied-poubelle');

        this.confirmationEl = this.el.appendChild(document.createElement('div'));
        this.confirmationEl.classList.add('agent-pied-confirmation');
        this.confirmationEl.setAttribute('role', 'group');
        this.confirmationEl.setAttribute('aria-label', "Supprimer l'annotation ?");
        const question = this.confirmationEl.appendChild(document.createElement('span'));
        question.textContent = "Supprimer l'annotation ?";

        this.annulerEl = this.confirmationEl.appendChild(document.createElement('button'));
        this.annulerEl.type = 'button';
        this.annulerEl.classList.add('agent-pied-annuler');
        this.annulerEl.textContent = 'Annuler';
        this.annulerEl.addEventListener('click', () => {
            this.confirmer(false);
            this.poubelleEl.focus();
        });

        const supprimerEl = this.confirmationEl.appendChild(document.createElement('button'));
        supprimerEl.type = 'button';
        supprimerEl.classList.add('agent-pied-supprimer');
        supprimerEl.textContent = 'Supprimer';
        supprimerEl.addEventListener('click', () => onSupprimer());

        if (onDiscuter) {
            this.discuterEl = boutonIcone(this.el, 'cat', 'Discuter de cette réponse',
                () => onDiscuter(), 'agent-pied-bouton', 'agent-pied-discuter');
        }

        this.confirmer(false);
    }

    /**
     * Échap, relayé par la portée clavier de la carte ou du chat (clavier.ts) :
     * pendant la confirmation, il renonce comme « Annuler ». Rend `true` s'il a
     * servi.
     */
    echap(): boolean {
        if (this.confirmationEl.hidden) return false;
        this.confirmer(false);
        this.poubelleEl.focus();
        return true;
    }

    /** Montre ou masque la poubelle (réponse rouverte depuis la marge). */
    montrer(visible: boolean): void {
        this.poubelle = visible;
        this.confirmer(false);
    }

    /** Montre ou masque la tête de chat (réponse arrivée, pas en erreur). */
    montrerDiscuter(visible: boolean): void {
        this.discuter = visible;
        this.confirmer(false);
    }

    private confirmer(oui: boolean): void {
        this.el.hidden = !this.poubelle && !(this.discuter && this.discuterEl);
        this.poubelleEl.hidden = oui || !this.poubelle;
        // La confirmation prend toute la largeur : la tête de chat s'efface.
        if (this.discuterEl) this.discuterEl.hidden = oui || !this.discuter;
        this.confirmationEl.hidden = !oui;
        // « Annuler » prend le focus : Entrée par réflexe ne supprime rien.
        if (oui) this.annulerEl.focus();
    }
}
