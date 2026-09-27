import { Component, type App } from 'fragment';
import { eclore } from '../ui/animations';
import { Fenetre, type Cadre } from '../positionnement/fenetre';
import type { Message, Outil } from '../pont/protocole';
import type { Repere } from '../positionnement/repere';
import { repondre, type ContexteQuestion } from '../pont/repondre';
import { sansMarkdown, titreDuChat } from '../ui/texteLisible';
import { boutonIcone, creer, PiedSupprimer, proteger } from '../ui/ui';

type SurFermeture = (messages: Message[], contexte: ContexteQuestion | null, cadre: Cadre | null, origine: Outil | null, bilan: string | null) => void;

/**
 * Le chat sur un passage, ouvert par la tête de chat de la barre. Il ne se
 * ferme qu'à sa croix : un clic à côté ne doit pas effacer une conversation.
 * Un widget du cœur (Fenetre), déplacé par son en-tête.
 */
export class BulleAgent extends Component {

    readonly dom = creer(null, 'div', 'agent-bulle');

    private readonly extraitEl: HTMLElement;
    /** Le sujet écrit par Hone ; tant qu'il manque, la tête montre le passage lisible. */
    private sujet: string | null = null;
    private readonly filEl: HTMLElement;
    private readonly champEl: HTMLTextAreaElement;
    private readonly envoyerEl: HTMLButtonElement;
    /** Seulement sur une discussion orale relue, qu'il reprend à voix haute. */
    private readonly microEl: HTMLButtonElement;
    private readonly pied: PiedSupprimer;
    private readonly fenetre: Fenetre;
    private readonly lacherClavier: () => void;

    private contexte: ContexteQuestion | null = null;
    private enAttente = false;
    /** Le numéro de l'ouverture : la réponse d'une conversation fermée entre-temps est ignorée. */
    private ouverture = 0;
    /** Rouverte seule (marge, carte devenue chat) : sans barre, elle sort de `depuis`. */
    private seule: { depuis: HTMLElement | DOMRect; cadre: Cadre | null } | null = null;
    /** L'outil dont la conversation continue la réponse. */
    private origine: Outil | null = null;
    /** Le bilan d'une discussion orale relue par écrit, en tête du fil. */
    private bilan: string | null = null;

    constructor(
        app: App,
        private readonly repere: Repere,
        private readonly barre: () => { dom: HTMLElement; chatEl: HTMLElement },
        private readonly onFermer: SurFermeture,
        onSupprimer: () => void,
        onMicro: () => void,
    ) {
        super();
        // Non modale : on peut continuer d'éditer la note.
        this.dom.setAttribute('role', 'dialog');
        this.dom.setAttribute('aria-label', "Question à Hone");

        const tete = creer(this.dom, 'div', 'agent-bulle-tete');
        this.extraitEl = creer(tete, 'div', 'agent-bulle-extrait');
        boutonIcone(tete, 'x', 'Fermer', () => this.fermer(), 'agent-bulle-fermer');

        this.filEl = creer(this.dom, 'div', 'agent-bulle-fil');
        this.filEl.setAttribute('aria-live', 'polite');

        const saisie = creer(this.dom, 'form', 'agent-bulle-saisie');
        saisie.addEventListener('submit', (e) => {
            e.preventDefault();
            void this.envoyer();
        });
        this.champEl = creer(saisie, 'textarea', 'agent-bulle-champ');
        this.champEl.rows = 1;
        this.champEl.placeholder = 'Poser une question sur ce passage';
        this.champEl.setAttribute('aria-label', 'Question');
        this.champEl.addEventListener('input', () => this.ajusterChamp());
        this.champEl.addEventListener('keydown', (e) => {
            // Entrée envoie, Maj+Entrée va à la ligne ; pas en pleine composition d'un accent.
            if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
            e.preventDefault();
            void this.envoyer();
        });
        this.microEl = boutonIcone(saisie, 'mic', 'Reprendre la discussion à voix haute', onMicro, 'agent-bulle-micro');
        this.microEl.hidden = true;
        this.envoyerEl = boutonIcone(saisie, 'arrow-up', 'Envoyer', null, 'agent-bulle-envoyer');

        this.pied = new PiedSupprimer(onSupprimer);
        this.dom.appendChild(this.pied.el);
        this.fenetre = new Fenetre(this.dom, tete, repere);
        this.lacherClavier = proteger(app, this.dom, () => this.pied.echap());
    }

    estOuverte(): boolean {
        return this._loaded;
    }

    /** La conversation, sans la réponse encore attendue ni les erreurs (qui ne se renvoient pas au modèle). */
    conversation(): Message[] {
        return [...this.filEl.querySelectorAll('.agent-message:not(.is-pending):not(.is-error)')].map((el) => ({
            auteur: el.classList.contains('mod-moi') ? 'moi' : 'agent',
            texte: el.textContent ?? '',
        }));
    }

    /**
     * Rouvre une conversation SANS la barre, à droite du trait, sortie de
     * `depuis` (une icône de la marge, ou la tête de chat d'une carte). `bilan` :
     * une discussion orale relue, le bilan en tête et un micro pour la reprendre.
     */
    rouvrir(
        contexte: ContexteQuestion, messages: Message[], depuis: HTMLElement | DOMRect,
        cadre: Cadre | null, options: { outil?: Outil; bilan?: string; poubelle: boolean },
    ): void {
        this.fermer();
        this.seule = { depuis, cadre };
        this.origine = options.outil ?? null;
        this.bilan = options.bilan ?? null;
        this.ouvrir(contexte);
        this.filEl.replaceChildren();
        if (this.bilan !== null) {
            const el = creer(this.filEl, 'div', 'agent-bilan');
            creer(el, 'div', 'agent-bilan-titre').textContent = 'Bilan';
            creer(el, 'div').textContent = this.bilan;
        }
        this.microEl.hidden = this.bilan === null;
        for (const m of messages) this.ajouterMessage(m.auteur, m.texte);
        // Une discussion orale se relit depuis son bilan.
        if (this.bilan !== null) this.filEl.scrollTop = 0;
        this.pied.montrer(options.poubelle);
    }

    bilanOral(): string | null {
        return this.bilan;
    }

    /** La boîte client, à lire avant de fermer : le rond du micro en sort. */
    boite(): DOMRect {
        return this.dom.getBoundingClientRect();
    }

    estSeule(): boolean {
        return this._loaded && this.seule !== null;
    }

    zone(): ContexteQuestion | null {
        return this.contexte;
    }

    /** Ouvre la bulle sur un passage (ou l'y déplace), le champ prend le focus. */
    ouvrir(contexte: ContexteQuestion): void {
        // Un autre passage : son sujet viendra par titrer().
        if (this.contexte?.texte !== contexte.texte) this.sujet = null;
        this.poserContexte(contexte);
        if (!this._loaded) {
            this.ouverture++;
            // Invisible le temps d'être posée : l'éclosion part de sa place finale.
            this.dom.style.opacity = '0';
            this.load();
            const seule = this.seule;
            this.fenetre.monter(seule?.cadre ?? null, (el) => {
                const trait = this.repere.boiteTrait();
                if (seule) return this.repere.aCote(el, { haut: trait?.top ?? 'centre', evites: [trait] });
                // La barre est au-dessus du passage : le chat se pose à côté des deux, calé sur son haut.
                const barre = this.repere.boiteDe(this.barre().dom);
                const ref = trait && barre ? {
                    left: Math.min(trait.left, barre.left), top: Math.min(trait.top, barre.top),
                    right: Math.max(trait.right, barre.right), bottom: Math.max(trait.bottom, barre.bottom),
                } : trait ?? barre;
                return this.repere.aCote(el, { ref, haut: ref?.top ?? 'centre', evites: [trait, barre] });
            });
            const eclosion = eclore(seule?.depuis ?? this.barre().chatEl, this.dom);
            this.register(() => eclosion.annuler());
        }
        this.champEl.focus({ preventScroll: true });
    }

    /** Le texte a été édité : la question suivante part avec le passage tel qu'on le voit. */
    deplacerZone(from: number, to: number, texte: string): void {
        if (this.contexte) this.poserContexte({ ...this.contexte, from, to, texte });
    }

    fermer(): void {
        this.unload();
    }

    onunload(): void {
        this.lacherClavier();
        const fermee = [this.conversation(), this.contexte, this.fenetre.cadre(), this.origine, this.bilan] as const;
        this.origine = null;
        this.bilan = null;
        this.contexte = null;
        this.seule = null;
        this.enAttente = false;
        this.microEl.hidden = true;
        this.dom.style.opacity = '';
        this.fenetre.retirer();
        this.filEl.replaceChildren();
        this.champEl.value = '';
        // Pas ajusterChamp() : détaché, scrollHeight vaut 0 et le champ rouvrirait écrasé.
        this.champEl.style.height = '';
        this.pied.montrer(false);
        this.envoyerEl.disabled = false;
        this.onFermer(...fermee);
    }

    private poserContexte(contexte: ContexteQuestion): void {
        this.contexte = contexte;
        this.extraitEl.textContent = titreDuChat(this.sujet, contexte.texte);
        this.extraitEl.title = sansMarkdown(contexte.texte);
        this.extraitEl.classList.toggle('is-sujet', this.sujet !== null);
    }

    /** Le sujet du passage est arrivé : « Question sur … » remplace le passage, par un fondu. */
    titrer(sujet: string | null): void {
        if (sujet === this.sujet) return;
        this.sujet = sujet;
        if (!this.contexte) return;
        this.poserContexte(this.contexte);
        this.extraitEl.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' });
    }

    private async envoyer(): Promise<void> {
        const question = this.champEl.value.trim();
        const contexte = this.contexte;
        if (!question || !contexte || this.enAttente) return;
        const historique = this.conversation();
        // Une erreur ne sert qu'au moment où elle arrive : la question suivante l'efface.
        this.filEl.querySelectorAll('.agent-message.is-error').forEach((el) => el.remove());
        this.ajouterMessage('moi', question);
        this.champEl.value = '';
        this.ajusterChamp();

        const ouverture = this.ouverture;
        const estCourante = (): boolean => this._loaded && this.ouverture === ouverture;
        this.enAttente = true;
        this.envoyerEl.disabled = true;
        const reponseEl = this.ajouterMessage('agent', '…');
        reponseEl.classList.add('is-pending');
        try {
            // Le chat s'écrit en direct : les points de l'attente s'effacent au premier morceau.
            let recu = '';
            const reponse = await repondre(question, contexte, historique, (morceau) => {
                if (!estCourante()) return;
                reponseEl.textContent = recu += morceau;
                this.filEl.scrollTop = this.filEl.scrollHeight;
            });
            if (estCourante()) reponseEl.textContent = reponse;
        } catch (err) {
            if (estCourante()) {
                reponseEl.textContent = `L'agent n'a pas pu répondre : ${err instanceof Error ? err.message : String(err)}`;
                reponseEl.classList.add('is-error');
            }
        }
        // Fermée pendant l'attente : cette réponse n'appartient plus à la conversation affichée.
        if (!estCourante()) return;
        reponseEl.classList.remove('is-pending');
        this.enAttente = false;
        this.envoyerEl.disabled = false;
        this.filEl.scrollTop = this.filEl.scrollHeight;
    }

    private ajouterMessage(auteur: 'moi' | 'agent', texte: string): HTMLElement {
        const el = creer(this.filEl, 'div', 'agent-message', `mod-${auteur}`);
        el.textContent = texte;
        this.filEl.scrollTop = this.filEl.scrollHeight;
        return el;
    }

    /** Le champ grandit avec le texte, jusqu'au plafond du CSS. */
    private ajusterChamp(): void {
        // scrollHeight compte le padding mais pas la bordure (border-box) : on la rajoute.
        this.champEl.style.height = 'auto';
        const bordure = this.champEl.offsetHeight - this.champEl.clientHeight;
        this.champEl.style.height = `${this.champEl.scrollHeight + bordure}px`;
    }
}
