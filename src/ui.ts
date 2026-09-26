import { Scope, setIcon, type App } from 'fragment';
import { creer } from './animations';
import type { Outil } from './protocole';

export { creer };

/** Les cinq outils : leur icône Lucide et leur nom, dans l'ordre de la barre. */
export const OUTILS: Record<Outil, { icone: string; libelle: string }> = {
    definir: { icone: 'book-a', libelle: 'Définir' },
    visualiser: { icone: 'chart-network', libelle: 'Visualiser' },
    aider: { icone: 'lightbulb', libelle: 'Aider' },
    traduire: { icone: 'languages', libelle: 'Traduire' },
    resumer: { icone: 'list', libelle: 'Résumer' },
};

/** Un bouton à icône Lucide. `onClick` null : le bouton d'envoi du formulaire. */
export function boutonIcone(
    parent: HTMLElement, icone: string, libelle: string, onClick: (() => void) | null, ...classes: string[]
): HTMLButtonElement {
    const el = creer(parent, 'button', ...classes);
    el.type = onClick ? 'button' : 'submit';
    el.setAttribute('aria-label', libelle);
    el.title = libelle;
    setIcon(el, icone);
    if (onClick) el.addEventListener('click', onClick);
    return el;
}

/** L'arc qui tourne autour d'un rond pendant que l'agent réfléchit. */
export function arc(parent: HTMLElement): void {
    parent.insertAdjacentHTML('beforeend',
        '<svg class="agent-action-arc" viewBox="0 0 60 60" aria-hidden="true"><circle cx="30" cy="30" r="28" pathLength="100"/></svg>');
}

/**
 * Empile `Scope.echap` tant que le focus est dans `el` : aucun raccourci de l'app
 * ne passe, Échap quitte le champ (sauf si `surEchap` l'a traité). Rend le dépilement.
 */
export function proteger(app: App, el: HTMLElement, surEchap: () => boolean = () => false): () => void {
    let portee: Scope | null = null;
    const lacher = (): void => {
        if (portee) app.keymap.popScope(portee);
        portee = null;
    };
    el.addEventListener('focusin', () => {
        if (portee) return;
        portee = Scope.echap(() => {
            if (surEchap()) return;
            const actif = document.activeElement;
            if (actif instanceof HTMLElement && el.contains(actif)) actif.blur();
        });
        app.keymap.pushScope(portee);
    });
    el.addEventListener('focusout', (e) => {
        if (!el.contains(e.relatedTarget as Node | null)) lacher();
    });
    return lacher;
}

/**
 * Le pied d'une carte ou d'un chat : la poubelle d'une réponse rouverte de la
 * marge (confirmée dans la carte), et la tête de chat qui en fait un chat.
 */
export class PiedSupprimer {

    readonly el = creer(null, 'div', 'agent-pied');
    readonly discuterEl: HTMLButtonElement | null = null;
    private readonly poubelleEl: HTMLButtonElement;
    private readonly confirmationEl = creer(null, 'div', 'agent-pied-confirmation');
    private readonly annulerEl: HTMLButtonElement;
    private poubelle = false;
    private discuter = false;

    constructor(onSupprimer: () => void, onDiscuter?: () => void) {
        this.el.hidden = true;
        this.poubelleEl = boutonIcone(this.el, 'trash-2', "Supprimer l'annotation",
            () => this.confirmer(true), 'agent-pied-bouton', 'agent-pied-poubelle');
        this.el.appendChild(this.confirmationEl);
        this.confirmationEl.setAttribute('role', 'group');
        this.confirmationEl.setAttribute('aria-label', "Supprimer l'annotation ?");
        creer(this.confirmationEl, 'span').textContent = "Supprimer l'annotation ?";
        const bouton = (texte: string, classe: string, onClick: () => void): HTMLButtonElement => {
            const b = creer(this.confirmationEl, 'button', classe);
            b.type = 'button';
            b.textContent = texte;
            b.addEventListener('click', onClick);
            return b;
        };
        this.annulerEl = bouton('Annuler', 'agent-pied-annuler', () => this.echap());
        bouton('Supprimer', 'agent-pied-supprimer', onSupprimer);
        if (onDiscuter) {
            this.discuterEl = boutonIcone(this.el, 'cat', 'Discuter de cette réponse',
                onDiscuter, 'agent-pied-bouton', 'agent-pied-discuter');
        }
        this.confirmer(false);
    }

    /** Échap pendant la confirmation renonce, comme « Annuler ». Rend `true` s'il a servi. */
    echap(): boolean {
        if (this.confirmationEl.hidden) return false;
        this.confirmer(false);
        this.poubelleEl.focus();
        return true;
    }

    montrer(visible: boolean): void {
        this.poubelle = visible;
        this.confirmer(false);
    }

    montrerDiscuter(visible: boolean): void {
        this.discuter = visible;
        this.confirmer(false);
    }

    private confirmer(oui: boolean): void {
        this.el.hidden = !this.poubelle && !(this.discuter && this.discuterEl);
        this.poubelleEl.hidden = oui || !this.poubelle;
        if (this.discuterEl) this.discuterEl.hidden = oui || !this.discuter;
        this.confirmationEl.hidden = !oui;
        // « Annuler » prend le focus : Entrée par réflexe ne supprime rien.
        if (oui) this.annulerEl.focus();
    }
}
