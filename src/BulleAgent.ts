import { Component, type App } from 'fragment';
import { boutonIcone } from './bouton';
import { proteger } from './clavier';
import { eclore } from './eclosion';
import { Fenetre, type Cadre } from './fenetre';
import type { Repere } from './repere';
import { repondre, type ContexteQuestion, type Outil } from './repondre';
import { PiedSupprimer } from './supprimer';
import type { Message } from './traces';

/**
 * La bulle de conversation, ouverte par la tête de chat de la barre (BarreAgent)
 * et posée à sa droite, alignée sur le bouton.
 *
 * ★ POURQUOI elle ne se ferme QU'À LA CROIX : c'est l'inverse exact du menu
 *   (core/Menu.ts), et c'est voulu. Un menu est une question à laquelle on
 *   répond d'un clic ; la bulle porte une conversation. La perdre sur un clic
 *   à côté, fait par erreur, efface ce qu'on a écrit et ce que l'agent a
 *   répondu. Donc : ni clic extérieur, ni perte de focus, ni Échap. Seule la
 *   croix ferme, et le démontage de la vue.
 *
 * ★ COMMENT elle suit le texte : c'est un widget du cœur (fenetre.ts), ancré
 *   au document à côté de la barre, ou du trait quand elle est seule. Elle
 *   défile avec la note sans un écouteur ; on la déplace par son en-tête.
 *
 * ★ POURQUOI extends Component : ouvrir() est load(), fermer() est unload(),
 *   comme le menu.
 */
export class BulleAgent extends Component {

    /** La racine, montée dans le pane à l'ouverture, retirée à la fermeture. */
    readonly dom: HTMLElement;

    private readonly extraitEl: HTMLElement;
    private readonly filEl: HTMLElement;
    private readonly champEl: HTMLTextAreaElement;
    private readonly envoyerEl: HTMLButtonElement;
    /** Le micro de la saisie : seulement sur une discussion orale, qu'il reprend. */
    private readonly microEl: HTMLButtonElement;
    private readonly pied: PiedSupprimer;
    /** Le widget du cœur qui porte la bulle (fenetre.ts). */
    private readonly fenetre: Fenetre;

    /** La zone sur laquelle porte la conversation, `null` bulle fermée. */
    private contexte: ContexteQuestion | null = null;
    private enAttente = false;

    /**
     * Le numéro de l'ouverture en cours. Une réponse ne sait pas annuler sa
     * requête : fermée puis rouverte pendant l'attente, la bulle recevrait la
     * réponse de l'ANCIENNE conversation. Chaque réponse compare donc le numéro
     * de son ouverture à celui-ci avant de toucher à quoi que ce soit.
     */
    private ouverture = 0;

    private readonly repere: Repere;
    /** La barre et sa tête de chat : la bulle se pose à côté, alignée sur le bouton. */
    private readonly barre: () => { dom: HTMLElement; chatEl: HTMLElement };
    /**
     * Une conversation rouverte depuis la marge (voir rouvrir()) : la bulle se
     * tient seule contre le trait, sans la barre, et sort de `depuis`. null
     * pour une bulle ouverte par la tête de chat de la barre.
     */
    private seule: { depuis: HTMLElement | DOMRect; cadre: Cadre | null } | null = null;
    /** L'outil dont la conversation continue la réponse, null pour un chat né de la barre. */
    private origine: Outil | null = null;
    /**
     * Le bilan d'une discussion orale relue par écrit, null sinon. Posé en
     * tête du fil, et rendu au calque à la fermeture : la trace reste orale.
     */
    private bilan: string | null = null;
    /**
     * Prévenu à chaque fermeture, avec la conversation et son passage tels
     * qu'ils étaient : le calque en garde une trace dans la marge (traces.ts).
     */
    private readonly onFermer: (messages: Message[], contexte: ContexteQuestion | null, cadre: Cadre | null, origine: Outil | null, bilan: string | null) => void;

    /** Retire la portée clavier (clavier.ts), au démontage. */
    private readonly lacherClavier: () => void;

    constructor(
        app: App,
        repere: Repere,
        barre: () => { dom: HTMLElement; chatEl: HTMLElement },
        onFermer: (messages: Message[], contexte: ContexteQuestion | null, cadre: Cadre | null, origine: Outil | null, bilan: string | null) => void,
        onSupprimer: () => void,
        onMicro: () => void,
    ) {
        super();
        this.repere = repere;
        this.barre = barre;
        this.onFermer = onFermer;

        this.dom = document.createElement('div');
        this.dom.classList.add('agent-bulle');
        // Non modale : on peut continuer d'éditer la note pendant qu'elle est ouverte.
        this.dom.setAttribute('role', 'dialog');
        this.dom.setAttribute('aria-label', "Question à l'agent");

        // ── L'en-tête : la zone citée, et la croix ──
        const tete = this.dom.appendChild(document.createElement('div'));
        tete.classList.add('agent-bulle-tete');

        this.extraitEl = tete.appendChild(document.createElement('div'));
        this.extraitEl.classList.add('agent-bulle-extrait');

        boutonIcone(tete, 'x', 'Fermer', () => this.fermer(), 'agent-bulle-fermer');

        // ── Le fil : vide tant qu'on n'a rien demandé, masqué en CSS ──
        this.filEl = this.dom.appendChild(document.createElement('div'));
        this.filEl.classList.add('agent-bulle-fil');
        // Les réponses arrivent après coup : un lecteur d'écran doit les annoncer.
        this.filEl.setAttribute('aria-live', 'polite');

        // ── La saisie ──
        const saisie = this.dom.appendChild(document.createElement('form'));
        saisie.classList.add('agent-bulle-saisie');
        saisie.addEventListener('submit', (e) => {
            e.preventDefault();
            void this.envoyer();
        });

        this.champEl = saisie.appendChild(document.createElement('textarea'));
        this.champEl.classList.add('agent-bulle-champ');
        this.champEl.rows = 1;
        this.champEl.placeholder = 'Poser une question sur ce passage';
        this.champEl.setAttribute('aria-label', 'Question');
        this.champEl.addEventListener('input', () => this.ajusterChamp());
        this.champEl.addEventListener('keydown', (e) => {
            // Entrée envoie, Maj+Entrée va à la ligne. isComposing : ne pas
            // envoyer en pleine saisie d'un accent composé.
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
                e.preventDefault();
                void this.envoyer();
            }
        });

        this.microEl = boutonIcone(saisie, 'mic', 'Reprendre la discussion à voix haute', () => onMicro(), 'agent-bulle-micro');
        this.microEl.hidden = true;

        this.envoyerEl = boutonIcone(saisie, 'arrow-up', 'Envoyer', null, 'agent-bulle-envoyer');

        // La poubelle, seulement sur une conversation rouverte depuis la marge.
        this.pied = new PiedSupprimer(onSupprimer);
        this.dom.appendChild(this.pied.el);

        // Attrapée par l'en-tête, elle se déplace ; par un bord, elle
        // s'agrandit. Son cadre est un écart au TRAIT, pas à la barre : il
        // vaut aussi pour la bulle rouverte seule, sans barre.
        this.fenetre = new Fenetre(this.dom, tete, repere);

        // Ce qu'on tape dans la bulle ne doit pas atteindre les raccourcis de
        // l'app (Cmd+Z annulerait un trait d'annotation au lieu d'un mot).
        this.lacherClavier = proteger(app, this.dom, () => this.pied.echap());
    }

    // ── L'état, vu de l'extérieur ─────────────────────────────────────────

    estOuverte(): boolean {
        return this._loaded;
    }

    /**
     * La conversation, sans la réponse qu'on attend encore : c'est ce que
     * l'historique de la marge garde et rouvre.
     */
    conversation(): Message[] {
        return [...this.filEl.children]
            .filter((el) => el.classList.contains('agent-message') && !el.classList.contains('is-pending'))
            .map((el) => ({
                auteur: el.classList.contains('mod-moi') ? 'moi' : 'agent',
                texte: el.textContent ?? '',
            }));
    }

    /**
     * Rouvre une conversation gardée dans la marge, SANS la barre : la bulle se
     * pose à droite du trait, comme la carte d'un outil, et sort
     * de l'icône cliquée (`depuis`). On relit une discussion, on n'en lance pas
     * une autre : les outils de la barre n'ont rien à y faire.
     *
     * Sert aussi à la carte d'un outil qui devient un chat : `depuis` est alors
     * la boîte de sa tête de chat, déjà retirée, et `outil` son outil. La
     * poubelle n'y est que si la carte venait de la marge.
     *
     * `bilan` : une discussion orale relue par écrit. Le bilan ouvre le fil,
     * les tours transcrits suivent, et un micro à côté d'Envoyer la reprend à
     * voix haute (le calque, `onMicro`).
     */
    rouvrir(
        contexte: ContexteQuestion, messages: Message[], depuis: HTMLElement | DOMRect,
        cadre: Cadre | null, options: { outil?: Outil; bilan?: string; poubelle: boolean },
    ): void {
        this.fermer();
        // Là où on l'avait laissée, à la taille qu'on lui avait donnée.
        this.seule = { depuis, cadre };
        this.origine = options.outil ?? null;
        this.bilan = options.bilan ?? null;
        this.ouvrir(contexte);
        this.filEl.replaceChildren();
        if (this.bilan !== null) this.ajouterBilan(this.bilan);
        this.microEl.hidden = this.bilan === null;
        for (const m of messages) this.ajouterMessage(m.auteur, m.texte);
        // Une discussion orale se relit depuis son bilan, pas depuis la fin.
        if (this.bilan !== null) this.filEl.scrollTop = 0;
        this.pied.montrer(options.poubelle);
    }

    /** Le bilan d'une discussion orale relue par écrit, null pour un chat ordinaire. */
    bilanOral(): string | null {
        return this.bilan;
    }

    /** La boîte CLIENT de la bulle, à lire avant de la fermer : le rond du micro en sort. */
    boite(): DOMRect {
        return this.dom.getBoundingClientRect();
    }

    /** Ouverte seule, depuis la marge : sa croix ferme tout, il n'y a pas de barre. */
    estSeule(): boolean {
        return this._loaded && this.seule !== null;
    }

    /** La zone suivie : lue par le calque pour ancrer et surligner. */
    zone(): ContexteQuestion | null {
        return this.contexte;
    }

    // ── Ouvrir, suivre, fermer ────────────────────────────────────────────

    /**
     * Ouvre la bulle sur une zone, ou la déplace sur une nouvelle si elle est
     * déjà ouverte. Le champ prend le focus : on vient de cliquer sur la tête
     * de chat, c'est pour poser une question.
     */
    ouvrir(contexte: ContexteQuestion): void {
        this.contexte = contexte;
        this.extraitEl.textContent = contexte.texte.replace(/\s+/g, ' ').trim();
        this.extraitEl.title = contexte.texte;

        if (!this._loaded) {
            this.ouverture++;
            // Invisible le temps d'être posée : l'éclosion part de sa place FINALE.
            this.dom.style.opacity = '0';
            this.load();
            this.poser();
            // La bulle sort du bouton tête de chat, ou de l'icône (eclosion.ts).
            // Fermée pendant l'animation : `Component` l'annule à l'unload.
            const eclosion = eclore(this.seule?.depuis ?? this.barre().chatEl, this.dom);
            this.register(() => eclosion.annuler());
        }
        // preventScroll : le champ est déjà à l'écran, à côté de la barre.
        this.champEl.focus({ preventScroll: true });
    }

    /**
     * Le texte a été édité : la zone a de nouvelles bornes, et peut-être un
     * nouveau contenu (une frappe DANS le passage). La question suivante doit
     * partir avec le texte qu'on voit surligné, pas avec celui d'avant.
     */
    deplacerZone(from: number, to: number, texte: string): void {
        if (!this.contexte) return;
        this.contexte = { ...this.contexte, from, to, texte };
        this.extraitEl.textContent = texte.replace(/\s+/g, ' ').trim();
        this.extraitEl.title = texte;
    }

    fermer(): void {
        this.unload();
    }

    onunload(): void {
        this.lacherClavier();
        const messages = this.conversation();
        const contexte = this.contexte;
        const cadre = this.fenetre.cadre();
        const origine = this.origine;
        const bilan = this.bilan;
        this.origine = null;
        this.bilan = null;
        this.microEl.hidden = true;
        this.dom.style.opacity = '';
        this.fenetre.retirer();
        this.filEl.replaceChildren();
        this.champEl.value = '';
        // Pas ajusterChamp() : détaché du DOM, scrollHeight vaut 0 et le champ
        // rouvrirait écrasé. On rend la main au CSS.
        this.champEl.style.height = '';
        this.contexte = null;
        this.pied.montrer(false);
        this.enAttente = false;
        this.seule = null;
        this.envoyerEl.disabled = false;
        this.onFermer(messages, contexte, cadre, origine, bilan);
    }

    /**
     * La première place : le cadre gardé d'une conversation rouverte, sinon à
     * côté de la barre, alignée sur la tête de chat, à 8 px de son bord ;
     * seule, à 12 px du trait, sur son haut, comme la carte d'un outil.
     */
    private poser(): void {
        const seule = this.seule;
        this.fenetre.monter(seule?.cadre ?? null, (el) => {
            const trait = this.repere.boiteTrait();
            if (seule) return this.repere.aCote(el, { haut: trait?.top ?? 'centre', evites: [trait] });
            const { dom, chatEl } = this.barre();
            const barre = this.repere.boiteDe(dom);
            const chat = this.repere.boiteDe(chatEl);
            return this.repere.aCote(el, { ref: barre, haut: chat?.top ?? 'centre', ecart: 8, evites: [trait, barre] });
        });
    }

    // ── La conversation ───────────────────────────────────────────────────

    private async envoyer(): Promise<void> {
        const question = this.champEl.value.trim();
        const contexte = this.contexte;
        if (!question || !contexte || this.enAttente) return;

        // Lue avant la question : c'est ce qui la précède.
        const historique = this.conversation();
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
                recu += morceau;
                reponseEl.textContent = recu;
                this.filEl.scrollTop = this.filEl.scrollHeight;
            });
            // Fermée pendant l'attente (et peut-être rouverte ailleurs) : cette
            // réponse n'appartient plus à la conversation affichée.
            if (!estCourante()) return;
            reponseEl.textContent = reponse;
        } catch (err) {
            if (!estCourante()) return;
            reponseEl.textContent = `L'agent n'a pas pu répondre : ${err instanceof Error ? err.message : String(err)}`;
            reponseEl.classList.add('is-error');
        } finally {
            // Même garde : sinon l'ancienne réponse débloquerait l'envoi pendant
            // que la question de la NOUVELLE conversation attend encore.
            if (estCourante()) {
                reponseEl.classList.remove('is-pending');
                this.enAttente = false;
                this.envoyerEl.disabled = false;
            }
        }
        if (!estCourante()) return;
        this.filEl.scrollTop = this.filEl.scrollHeight;
    }

    /** Le bilan d'une discussion orale, en tête du fil : pas un message, conversation() l'ignore. */
    private ajouterBilan(texte: string): void {
        const el = this.filEl.appendChild(document.createElement('div'));
        el.classList.add('agent-bilan');
        const titre = el.appendChild(document.createElement('div'));
        titre.classList.add('agent-bilan-titre');
        titre.textContent = 'Bilan';
        el.appendChild(document.createElement('div')).textContent = texte;
    }

    private ajouterMessage(auteur: 'moi' | 'agent', texte: string): HTMLElement {
        const el = this.filEl.appendChild(document.createElement('div'));
        el.classList.add('agent-message', `mod-${auteur}`);
        el.textContent = texte;
        this.filEl.scrollTop = this.filEl.scrollHeight;
        return el;
    }

    /** Le champ grandit avec le texte, jusqu'au plafond fixé en CSS. */
    private ajusterChamp(): void {
        // scrollHeight compte le padding mais pas la bordure : en border-box
        // (agent.css), on rajoute la bordure, sinon le champ grandit d'un cran
        // à chaque envoi.
        this.champEl.style.height = 'auto';
        const bordure = this.champEl.offsetHeight - this.champEl.clientHeight;
        this.champEl.style.height = `${this.champEl.scrollHeight + bordure}px`;
    }
}
