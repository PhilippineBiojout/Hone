import { Component, setIcon, type App, type WidgetHandle } from 'fragment';
import { arc, boutonIcone } from './bouton';
import { proteger } from './clavier';
import { eclore, ressort, type Eclosion } from './eclosion';
import { Fenetre, type Cadre } from './fenetre';
import type { Repere } from './repere';
import { nettoyerSvg } from './nettoyerSvg';
import { agir, resumerOral, type ContexteQuestion, type Outil, type ReponseOutil } from './repondre';
import { PiedSupprimer } from './supprimer';
import type { Message } from './traces';

/** Les cinq outils : leur icône Lucide et leur nom, dans l'ordre de la barre. */
export const OUTILS: Record<Outil, { icone: string; libelle: string }> = {
    definir: { icone: 'book-a', libelle: 'Définir' },
    visualiser: { icone: 'chart-network', libelle: 'Visualiser' },
    aider: { icone: 'lightbulb', libelle: 'Aider' },
    traduire: { icone: 'languages', libelle: 'Traduire' },
    resumer: { icone: 'list', libelle: 'Résumer' },
};

/**
 * Ce que montre la carte : la réponse d'un outil, ou le bilan d'une discussion
 * orale avec les tours dont il est tiré.
 */
export type Resultat =
    | ({ type: 'outil'; outil: Outil } & ReponseOutil)
    | { type: 'oral'; messages: Message[]; texte: string };

/** Le rond et la carte du bilan d'une discussion orale. */
const BILAN = { icone: 'mic', libelle: 'Bilan' };

/** Le ressort de la résorption : le même, vif, que la rallonge. */
const RAIDEUR = 700;
const AMORTISSEMENT = 48;

/**
 * Un outil lancé sur un passage.
 *
 * Deux temps. D'abord la barre entière se résorbe en un gros rond qui porte
 * l'icône de l'outil, cerclé d'un arc qui tourne : l'agent réfléchit. Puis,
 * la réponse arrivée, le rond s'ouvre en carte (la goutte d'eclosion.ts,
 * comme le chat) : l'icône, le nom de l'outil, une croix, la réponse.
 *
 * Sert aussi au bilan d'une discussion orale (lancerBilan) : la pilule se
 * résorbe dans le rond du micro, et la carte porte le bilan écrit.
 *
 * Comme la barre et la bulle, elle ne se ferme QU'À LA CROIX de la carte.
 * Pendant l'attente, il n'y a rien à fermer : tout a fondu dans le rond.
 *
 * Le rond et la carte sont des widgets du cœur, ancrés au document à côté du
 * trait (Repere) : ils défilent avec la note. La carte se déplace et
 * s'agrandit (fenetre.ts), le rond ne bouge pas.
 */
export class ActionAgent extends Component {

    private readonly cercleEl: HTMLElement;
    private readonly carteEl: HTMLElement;
    private readonly iconeCercleEl: HTMLElement;
    private readonly iconeCarteEl: HTMLElement;
    private readonly titreEl: HTMLElement;
    /** Le petit globe : la réponse vient du web. */
    private readonly sourceEl: HTMLElement;
    private readonly corpsEl: HTMLElement;
    private readonly pied: PiedSupprimer;
    /** La carte en widget du cœur (fenetre.ts). */
    private readonly fenetre: Fenetre;
    /** Le rond en widget du cœur, le temps que l'agent réfléchit. */
    private rond: WidgetHandle | null = null;

    /** Le numéro du lancement en cours : une réponse d'un lancement fermé est ignorée. */
    private lancement = 0;
    /** Le cadre de la carte, relevé juste avant son retrait : le calque le lit à la fermeture. */
    private cadreFerme: Cadre | null = null;
    /** Ce que montre la carte, lu par le calque à la fermeture. */
    private montre: Resultat | null = null;

    private readonly repere: Repere;
    private readonly onFermer: () => void;

    /** Retire la portée clavier (clavier.ts), au démontage. */
    private readonly lacherClavier: () => void;

    constructor(
        app: App,
        repere: Repere,
        onFermer: () => void,
        onSupprimer: () => void,
        onDiscuter: () => void,
    ) {
        super();
        this.repere = repere;
        this.onFermer = onFermer;

        // ── Le rond, pendant que l'agent réfléchit ──
        this.cercleEl = document.createElement('div');
        this.cercleEl.classList.add('agent-action-cercle');
        this.cercleEl.setAttribute('role', 'status');
        this.iconeCercleEl = this.cercleEl.appendChild(document.createElement('span'));
        this.iconeCercleEl.classList.add('agent-action-icone');
        arc(this.cercleEl);

        // ── La carte, la réponse arrivée ──
        this.carteEl = document.createElement('div');
        this.carteEl.classList.add('agent-action-carte');
        this.carteEl.setAttribute('role', 'dialog');

        const tete = this.carteEl.appendChild(document.createElement('div'));
        tete.classList.add('agent-action-tete');
        this.iconeCarteEl = tete.appendChild(document.createElement('span'));
        this.iconeCarteEl.classList.add('agent-action-icone');
        this.titreEl = tete.appendChild(document.createElement('span'));
        this.titreEl.classList.add('agent-action-titre');
        this.sourceEl = tete.appendChild(document.createElement('span'));
        this.sourceEl.classList.add('agent-action-source');
        this.sourceEl.title = 'Réponse tirée du web';
        this.sourceEl.setAttribute('aria-label', 'Réponse tirée du web');
        setIcon(this.sourceEl, 'globe');
        this.sourceEl.hidden = true;
        boutonIcone(tete, 'x', 'Fermer', () => this.fermer(), 'agent-bulle-fermer');

        this.corpsEl = this.carteEl.appendChild(document.createElement('div'));
        this.corpsEl.classList.add('agent-action-corps');
        this.corpsEl.setAttribute('aria-live', 'polite');

        // La tête de chat sur toute réponse arrivée, la poubelle seulement sur
        // une réponse rouverte depuis la marge.
        this.pied = new PiedSupprimer(onSupprimer, onDiscuter);
        this.carteEl.appendChild(this.pied.el);

        this.fenetre = new Fenetre(this.carteEl, tete, repere);

        this.lacherClavier = proteger(app, this.carteEl, () => this.pied.echap());
    }

    estOuverte(): boolean {
        return this._loaded;
    }

    /** La réponse que la carte montre, ou null (l'agent réfléchit encore, ou a échoué). */
    resultat(): Resultat | null {
        return this.montre;
    }

    /**
     * La boîte client de la tête de chat du pied, à lire AVANT de fermer la
     * carte : le chat qui la remplace sort de là (eclosion.ts).
     */
    boutonDiscuter(): DOMRect {
        return this.pied.discuterEl?.getBoundingClientRect() ?? this.carteEl.getBoundingClientRect();
    }

    /** Où la carte a été posée et à quelle taille, null si on n'y a pas touché. */
    cadre(): Cadre | null {
        return this.fenetre.estMontee() ? this.fenetre.cadre() : this.cadreFerme;
    }

    /**
     * Lance `outil` sur le passage. `depuis` est la boîte CLIENT de la barre,
     * juste avant qu'elle ne soit retirée : le rond en sort.
     */
    lancer(outil: Outil, contexte: ContexteQuestion, depuis: DOMRect, precedents: ReponseOutil[] = []): void {
        this.attendre(OUTILS[outil], depuis, agir(outil, contexte, precedents),
            (reponse) => ({ type: 'outil', outil, ...reponse }));
    }

    /**
     * Le bilan d'une discussion orale : `depuis` est la boîte CLIENT de la
     * pilule, juste avant son retrait. Le rond du micro en sort.
     */
    lancerBilan(contexte: ContexteQuestion, messages: Message[], depuis: DOMRect): void {
        // Sans bilan, la discussion reste gardée : on ne perd pas ce qui s'est dit.
        this.attendre(BILAN, depuis, resumerOral(messages, contexte).then((texte) => ({ texte })),
            ({ texte }) => ({ type: 'oral', messages, texte }), 'Bilan indisponible.');
    }

    /** Le rond tourne pendant `reponse`, puis s'ouvre en carte. */
    private attendre(
        aspect: { icone: string; libelle: string }, depuis: DOMRect,
        reponse: Promise<ReponseOutil>, resultat: (reponse: ReponseOutil) => Resultat,
        /**
         * Sans lui, une réponse en attente ou en erreur ne laisse rien ; avec
         * lui, elle est gardée avec ce texte.
         */
        texteSiErreur?: string,
    ): void {
        this.cercleEl.setAttribute('aria-label', `${aspect.libelle} : l'agent réfléchit`);
        this.preparer(aspect);
        // Gardée dès maintenant : fermée pendant que le rond tourne, la
        // discussion laisse quand même sa trace.
        if (texteSiErreur !== undefined) this.montre = resultat({ texte: texteSiErreur });

        this.lancement++;
        const lancement = this.lancement;
        const estCourant = (): boolean => this._loaded && this.lancement === lancement;

        this.cercleEl.style.opacity = '0';
        this.load();
        // Le rond à la place de la barre : à côté du trait, centré sur lui.
        this.rond = this.repere.monter(this.cercleEl, (el) => this.repere.aCote(el));
        const resorption = resorber(depuis, this.cercleEl);
        this.register(() => resorption.annuler());

        reponse
            .then((recue) => {
                if (!estCourant()) return;
                this.montre = resultat(recue);
                this.ouvrirCarte(recue, false);
            })
            .catch((err: unknown) => {
                if (estCourant()) {
                    if (texteSiErreur !== undefined) this.montre = resultat({ texte: texteSiErreur });
                    this.ouvrirCarte({ texte: `L'agent n'a pas pu répondre : ${err instanceof Error ? err.message : String(err)}` }, true);
                }
            });
    }

    /**
     * Rouvre une réponse déjà reçue (une icône de l'historique, traces.ts) :
     * pas de rond, la carte sort directement de l'icône.
     */
    montrer(outil: Outil, reponse: ReponseOutil, depuis: HTMLElement, cadre: Cadre | null): void {
        this.preparer(OUTILS[outil]);
        this.pied.montrer(true);
        this.pied.montrerDiscuter(true);
        this.montre = { type: 'outil', outil, ...reponse };
        this.afficher(reponse);
        this.lancement++;
        this.carteEl.style.opacity = '0';
        this.load();
        // Là où on l'avait laissée, sinon à côté du trait, sur son haut.
        this.fenetre.monter(cadre, (el) => {
            const trait = this.repere.boiteTrait();
            return this.repere.aCote(el, { haut: trait?.top ?? 'centre', evites: [trait] });
        });
        const eclosion = eclore(depuis, this.carteEl);
        this.register(() => eclosion.annuler());
    }

    fermer(): void {
        this.unload();
    }

    /** L'icône et le nom (de l'outil, ou du bilan) sur le rond et la carte, le corps vidé. */
    private preparer({ icone, libelle }: { icone: string; libelle: string }): void {
        setIcon(this.iconeCercleEl, icone);
        setIcon(this.iconeCarteEl, icone);
        this.titreEl.textContent = libelle;
        this.carteEl.setAttribute('aria-label', libelle);
        this.corpsEl.textContent = '';
        this.corpsEl.classList.remove('is-error', 'is-visuel', 'is-stop');
        this.sourceEl.hidden = true;
        this.pied.montrer(false);
        this.pied.montrerDiscuter(false);
        this.montre = null;
    }

    /**
     * Le corps de la carte : le dessin de Visualiser (toujours nettoyé, jamais
     * inséré tel que le modèle l'a écrit), sinon le texte. Le globe si la
     * réponse vient du web.
     */
    private afficher(reponse: ReponseOutil): void {
        this.corpsEl.textContent = '';
        this.sourceEl.hidden = reponse.source !== 'web';
        this.corpsEl.classList.toggle('is-stop', reponse.stop === true);
        if (reponse.svg !== undefined) {
            const svg = nettoyerSvg(reponse.svg);
            this.corpsEl.classList.toggle('is-visuel', svg !== null);
            if (svg) {
                svg.setAttribute('aria-label', `Visuel du passage`);
                this.corpsEl.appendChild(svg);
                return;
            }
            this.corpsEl.textContent = 'Le dessin reçu n\'a pas pu être affiché.';
            return;
        }
        this.corpsEl.classList.remove('is-visuel');
        this.corpsEl.textContent = reponse.texte;
    }

    onunload(): void {
        this.lacherClavier();
        this.cadreFerme = this.fenetre.estMontee() ? this.fenetre.cadre() : null;
        this.retirerRond();
        this.fenetre.retirer();
        // Le rond et la carte sont réutilisés d'un lancement à l'autre : le
        // prochain rond doit renaître avec son arc qui tourne.
        this.cercleEl.classList.remove('is-fini');
        this.cercleEl.style.opacity = '';
        this.carteEl.style.opacity = '';
        this.onFermer();
    }

    private retirerRond(): void {
        this.rond?.remove();
        this.rond = null;
        this.cercleEl.remove();
    }

    /** Le rond s'ouvre en carte : la goutte du chat (eclosion.ts), depuis le rond. */
    private ouvrirCarte(reponse: ReponseOutil, erreur: boolean): void {
        this.afficher(reponse);
        this.corpsEl.classList.toggle('is-error', erreur);
        // Une erreur n'est pas une réponse dont on discute.
        this.pied.montrerDiscuter(!erreur);
        this.carteEl.style.opacity = '0';
        const lancement = this.lancement;
        // La carte garde le haut du rond, dont elle sort.
        const rond = this.repere.boiteDe(this.cercleEl);
        this.fenetre.monter(null, (el) => this.repere.aCote(el, {
            haut: rond?.top ?? 'centre',
            evites: [this.repere.boiteTrait()],
        }));
        // Le rond s'arrête de tourner : la réponse est là.
        this.cercleEl.classList.add('is-fini');
        const eclosion: Eclosion = eclore(this.cercleEl, this.carteEl);
        this.register(() => eclosion.annuler());
        void eclosion.fini.then(() => {
            if (this._loaded && this.lancement === lancement) this.retirerRond();
        });
    }
}

/**
 * La barre se résorbe en rond : une forme au fond et au filet de la barre
 * part de sa boîte et se pose sur le rond, avec le ressort vif. Le rond
 * apparaît alors, d'un coup (même teinte, l'échange ne se voit pas).
 * Repris par le micro (VoixAgent), dont le rond s'étire ensuite en pilule :
 * `fini` est résolue quand le rond est montré.
 */
export function resorber(depuis: DOMRect, cercle: HTMLElement): { fini: Promise<void>; annuler(): void } {
    const montrer = (): void => { cercle.style.opacity = ''; };
    const parent = cercle.parentElement;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !parent) {
        montrer();
        return { fini: Promise.resolve(), annuler: () => {} };
    }

    // Même translation client → repère du parent qu'eclosion.ts.
    const rc = cercle.getBoundingClientRect();
    const dx = parseFloat(cercle.style.left || '0') - rc.left;
    const dy = parseFloat(cercle.style.top || '0') - rc.top;

    const forme = document.createElement('div');
    forme.classList.add('agent-action-forme');
    parent.appendChild(forme);

    const { easing, duree } = ressort(RAIDEUR, AMORTISSEMENT);
    const anim = forme.animate(
        [
            { left: `${depuis.left + dx}px`, top: `${depuis.top + dy}px`, width: `${depuis.width}px`, height: `${depuis.height}px`, borderRadius: '10px' },
            { left: `${rc.left + dx}px`, top: `${rc.top + dy}px`, width: `${rc.width}px`, height: `${rc.height}px`, borderRadius: `${rc.width / 2}px` },
        ],
        { duration: duree, easing, fill: 'both' },
    );

    let annule = false;
    const fini = anim.finished
        .then(() => {
            if (annule) return;
            forme.remove();
            montrer();
            // L'icône sort du rond d'un petit pop, comme les outils de la rallonge.
            cercle.firstElementChild?.animate(
                [{ opacity: 0, scale: '0.5' }, { opacity: 1, scale: '1' }],
                { duration: 140, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1.2)' },
            );
        })
        .catch(() => {});

    return {
        fini,
        annuler: () => {
            annule = true;
            anim.cancel();
            forme.remove();
            montrer();
        },
    };
}
