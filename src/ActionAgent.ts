import { Component, setIcon, type App, type WidgetHandle } from 'fragment';
import { eclore, resorber } from './animations';
import { Fenetre, type Cadre } from './fenetre';
import { nettoyerSvg } from './nettoyerSvg';
import type { Message } from './protocole';
import type { Repere } from './repere';
import { agir, resumerOral, type ContexteQuestion, type Outil, type ReponseOutil } from './repondre';
import { arc, boutonIcone, OUTILS, PiedSupprimer, proteger } from './ui';

/** Ce que montre la carte : la réponse d'un outil, ou le bilan d'une discussion orale. */
export type Resultat =
    | ({ type: 'outil'; outil: Outil } & ReponseOutil)
    | { type: 'oral'; messages: Message[]; texte: string };

const BILAN = { icone: 'mic', libelle: 'Bilan' };

/**
 * Un outil lancé sur un passage : la barre se résorbe en un rond qui tourne,
 * puis le rond s'ouvre en carte. Sert aussi au bilan d'une discussion orale.
 */
export class ActionAgent extends Component {

    private readonly cercleEl = document.createElement('div');
    private readonly carteEl = document.createElement('div');
    private readonly iconeCercleEl: HTMLElement;
    private readonly iconeCarteEl: HTMLElement;
    private readonly titreEl: HTMLElement;
    private readonly sourceEl: HTMLElement;
    private readonly corpsEl: HTMLElement;
    private readonly pied: PiedSupprimer;
    private readonly fenetre: Fenetre;
    private readonly lacherClavier: () => void;
    private rond: WidgetHandle | null = null;
    /** Une réponse d'un lancement fermé est ignorée. */
    private lancement = 0;
    private cadreFerme: Cadre | null = null;
    private montre: Resultat | null = null;

    constructor(
        app: App,
        private readonly repere: Repere,
        private readonly onFermer: () => void,
        onSupprimer: () => void,
        onDiscuter: () => void,
    ) {
        super();
        this.cercleEl.classList.add('agent-action-cercle');
        this.cercleEl.setAttribute('role', 'status');
        this.iconeCercleEl = span(this.cercleEl, 'agent-action-icone');
        arc(this.cercleEl);

        this.carteEl.classList.add('agent-action-carte');
        this.carteEl.setAttribute('role', 'dialog');
        const tete = this.carteEl.appendChild(document.createElement('div'));
        tete.classList.add('agent-action-tete');
        this.iconeCarteEl = span(tete, 'agent-action-icone');
        this.titreEl = span(tete, 'agent-action-titre');
        this.sourceEl = span(tete, 'agent-action-source');
        this.sourceEl.title = 'Réponse tirée du web';
        this.sourceEl.setAttribute('aria-label', 'Réponse tirée du web');
        setIcon(this.sourceEl, 'globe');
        this.sourceEl.hidden = true;
        boutonIcone(tete, 'x', 'Fermer', () => this.fermer(), 'agent-bulle-fermer');

        this.corpsEl = this.carteEl.appendChild(document.createElement('div'));
        this.corpsEl.classList.add('agent-action-corps');
        this.corpsEl.setAttribute('aria-live', 'polite');

        this.pied = new PiedSupprimer(onSupprimer, onDiscuter);
        this.carteEl.appendChild(this.pied.el);
        this.fenetre = new Fenetre(this.carteEl, tete, repere);
        this.lacherClavier = proteger(app, this.carteEl, () => this.pied.echap());
    }

    estOuverte(): boolean {
        return this._loaded;
    }

    /** La réponse montrée, ou null (l'agent réfléchit encore, ou a échoué). */
    resultat(): Resultat | null {
        return this.montre;
    }

    /** La boîte de la tête de chat du pied, à lire avant de fermer : le chat en sort. */
    boutonDiscuter(): DOMRect {
        return this.pied.discuterEl?.getBoundingClientRect() ?? this.carteEl.getBoundingClientRect();
    }

    cadre(): Cadre | null {
        return this.fenetre.estMontee() ? this.fenetre.cadre() : this.cadreFerme;
    }

    /** `depuis` : la boîte client de la barre, juste avant son retrait. */
    lancer(outil: Outil, contexte: ContexteQuestion, depuis: DOMRect, precedents: ReponseOutil[] = []): void {
        this.attendre(OUTILS[outil], depuis, agir(outil, contexte, precedents),
            (reponse) => ({ type: 'outil', outil, ...reponse }));
    }

    /** Le bilan d'une discussion orale ; `depuis` : la boîte de la pilule. */
    lancerBilan(contexte: ContexteQuestion, messages: Message[], depuis: DOMRect): void {
        this.attendre(BILAN, depuis, resumerOral(messages, contexte).then((texte) => ({ texte })),
            ({ texte }) => ({ type: 'oral', messages, texte }), 'Bilan indisponible.');
    }

    /** Avec `texteSiErreur`, une réponse en attente ou en erreur est gardée avec ce texte. */
    private attendre(
        aspect: { icone: string; libelle: string }, depuis: DOMRect, reponse: Promise<ReponseOutil>,
        resultat: (reponse: ReponseOutil) => Resultat, texteSiErreur?: string,
    ): void {
        this.cercleEl.setAttribute('aria-label', `${aspect.libelle} : l'agent réfléchit`);
        this.preparer(aspect);
        const garder = (): void => {
            if (texteSiErreur !== undefined) this.montre = resultat({ texte: texteSiErreur });
        };
        garder();
        const lancement = ++this.lancement;
        const estCourant = (): boolean => this._loaded && this.lancement === lancement;

        this.cercleEl.style.opacity = '0';
        this.load();
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
                if (!estCourant()) return;
                garder();
                this.ouvrirCarte({ texte: `L'agent n'a pas pu répondre : ${err instanceof Error ? err.message : String(err)}` }, true);
            });
    }

    /** Rouvre une réponse reçue (icône de la marge) : pas de rond, la carte sort de l'icône. */
    montrer(outil: Outil, reponse: ReponseOutil, depuis: HTMLElement, cadre: Cadre | null): void {
        this.preparer(OUTILS[outil]);
        this.pied.montrer(true);
        this.pied.montrerDiscuter(true);
        this.montre = { type: 'outil', outil, ...reponse };
        this.afficher(reponse);
        this.lancement++;
        this.carteEl.style.opacity = '0';
        this.load();
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

    /** Le dessin de Visualiser, toujours nettoyé, sinon le texte. */
    private afficher(reponse: ReponseOutil): void {
        this.corpsEl.textContent = '';
        this.sourceEl.hidden = reponse.source !== 'web';
        this.corpsEl.classList.toggle('is-stop', reponse.stop === true);
        if (reponse.svg === undefined) {
            this.corpsEl.classList.remove('is-visuel');
            this.corpsEl.textContent = reponse.texte;
            return;
        }
        const svg = nettoyerSvg(reponse.svg);
        this.corpsEl.classList.toggle('is-visuel', svg !== null);
        if (!svg) {
            this.corpsEl.textContent = 'Le dessin reçu n\'a pas pu être affiché.';
            return;
        }
        svg.setAttribute('aria-label', 'Visuel du passage');
        this.corpsEl.appendChild(svg);
    }

    onunload(): void {
        this.lacherClavier();
        this.cadreFerme = this.fenetre.estMontee() ? this.fenetre.cadre() : null;
        this.retirerRond();
        this.fenetre.retirer();
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

    private ouvrirCarte(reponse: ReponseOutil, erreur: boolean): void {
        this.afficher(reponse);
        this.corpsEl.classList.toggle('is-error', erreur);
        this.pied.montrerDiscuter(!erreur);
        this.carteEl.style.opacity = '0';
        const lancement = this.lancement;
        const rond = this.repere.boiteDe(this.cercleEl);
        this.fenetre.monter(null, (el) => this.repere.aCote(el, {
            haut: rond?.top ?? 'centre',
            evites: [this.repere.boiteTrait()],
        }));
        this.cercleEl.classList.add('is-fini');
        const eclosion = eclore(this.cercleEl, this.carteEl);
        this.register(() => eclosion.annuler());
        void eclosion.fini.then(() => {
            if (this._loaded && this.lancement === lancement) this.retirerRond();
        });
    }
}

function span(parent: HTMLElement, classe: string): HTMLElement {
    const el = parent.appendChild(document.createElement('span'));
    el.classList.add(classe);
    return el;
}
