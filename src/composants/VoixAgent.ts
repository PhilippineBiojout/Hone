import { sansMarkdown } from '../ui/texteLisible';
import { Component, type App, type WidgetHandle } from 'fragment';
import { ressort } from '../ui/animations';
import { Lueur, type LireNiveau } from '../ui/lueur';
import type { Appel } from '../cerveau/appel';
import type { Message } from '../pont/protocole';
import type { Repere } from '../positionnement/repere';
import { appeler, type ContexteQuestion } from '../pont/repondre';
import { boutonIcone, proteger } from '../ui/ui';

const LARGEUR = 500;                // la lumière, centrée : 500 px au plus
const LARGEUR_BEAM = 370;           // la largeur pour laquelle le préréglage `default` de voice-glow est réglé
const GOUTTIERE = 16;               // dans un panneau étroit, la barre garde 16 px de chaque côté
const MONTEE = 24;                  // elle monte de 24 px, jusqu'au bord bas du panneau
const RAIDEUR = 520;                // spring bounce 0.16 de Motion, celui de l'ancien étirement (Skiper3)
const AMORTISSEMENT = 38;
const RETARD_CONTENU = 120;
const APPARITION = 220;

/** arrivee : la barre monte, le micro se demande ; connexion : l'appel s'établit ; refuse : pas de micro. */
type Etat = 'arrivee' | 'connexion' | 'ecoute' | 'reflechit' | 'repond' | 'refuse';

const LIBELLES: Partial<Record<Etat, string>> = {
    repond: 'Couper la parole à Hone',
};

/** La ligne d'état ; en `repond`, c'est ce que dit Hone qui s'y écrit. */
const LIGNES: Partial<Record<Etat, string>> = {
    connexion: 'Connexion à Hone…',
    ecoute: 'Je vous écoute…',
    reflechit: 'Hone réfléchit…',
    refuse: 'Micro refusé',
};

/**
 * La discussion orale : rien qu'une lumière (voice-glow, libraries.dev/voice) qui
 * sort du bord bas du panneau quand on touche le micro, et suit la voix. C'est un
 * appel en direct (cerveau/appel.ts, Gradium et Codex) : la fin d'une phrase se repère seule. Deux
 * ronds centrés au-dessus : ■ coupe la parole à Hone quand il parle, × raccroche.
 * L'état se lit dans la lumière ; la ligne d'état ne sert qu'aux lecteurs d'écran,
 * sauf refus du micro ou erreur.
 */
export class VoixAgent extends Component {

    private readonly el = document.createElement('div');
    private readonly contenuEl: HTMLElement;
    private readonly stopEl: HTMLButtonElement;
    private readonly messageEl: HTMLElement;
    private readonly lacherClavier: () => void;
    /** Neuve à chaque ouverture, détruite à la fermeture : fermée, rien ne tourne. */
    private lueur: Lueur | null = null;
    /** Ce qui arrive d'un lancement fermé est ignoré. */
    private lancement = 0;
    private etat: Etat = 'arrivee';
    private zone: ContexteQuestion | null = null;
    private historique: Message[] = [];
    private flux: MediaStream | null = null;
    private appel: Appel | null = null;
    /** La dernière réplique de Hone : la ligne d'état la montre tant qu'il parle. */
    private dernierDit = '';
    private handle: WidgetHandle | null = null;
    /** Seule la croix demande un bilan. */
    private parCroix = false;

    constructor(
        app: App,
        private readonly repere: Repere,
        private readonly onFermer: (historique: Message[], boite: DOMRect, parCroix: boolean) => void,
    ) {
        super();
        // `hone-voix` en plus : l'ancien plugin `agent` style aussi `.agent-voix` (styles.css).
        this.el.classList.add('agent-voix', 'hone-voix');
        this.el.setAttribute('role', 'group');
        this.el.setAttribute('aria-label', 'Discussion orale');

        this.contenuEl = this.el.appendChild(document.createElement('div'));
        this.contenuEl.classList.add('agent-voix-contenu');
        this.messageEl = this.contenuEl.appendChild(document.createElement('span'));
        this.messageEl.classList.add('agent-voix-message');
        this.messageEl.setAttribute('role', 'status');

        const actions = this.contenuEl.appendChild(document.createElement('div'));
        actions.classList.add('agent-voix-actions');
        // Couper la parole à Hone, quand il parle.
        this.stopEl = boutonIcone(actions, 'square', '', () => this.appel?.couper(), 'agent-voix-stop');
        boutonIcone(actions, 'x', 'Fermer', () => {
            this.parCroix = true;
            this.fermer();
        }, 'agent-voix-fermer');

        this.lacherClavier = proteger(app, this.el);
        this.poserEtat('arrivee');
    }

    estOuverte(): boolean {
        return this._loaded;
    }

    /** `historique` : une discussion reprise. */
    lancer(zone: ContexteQuestion, _depuis: DOMRect, historique: Message[] = []): void {
        const lancement = ++this.lancement;
        const estCourant = (): boolean => this._loaded && this.lancement === lancement;
        this.zone = { ...zone };
        this.historique = [...historique];
        this.poserEtat('arrivee');

        // Sous le contenu : la lueur se peint derrière le texte et les boutons. Une
        // ancienne encore là (lancer sans fermer) ne doit pas tourner dans le vide.
        this.lueur?.detruire();
        this.lueur?.el.remove();
        this.lueur = new Lueur(this.echelle());
        this.el.prepend(this.lueur.el);
        this.load();
        this.handle = this.repere.monter(this.el, (el) => this.placer(el));
        // Le WidgetLayer pose pointer-events:auto en style sur chaque widget ; la lumière laisse
        // passer les clics vers le texte, seuls les deux ronds les prennent (styles.css).
        this.el.style.pointerEvents = 'none';
        const suivrePanneau = new ResizeObserver(() => {
            const a = this.placer(this.el);
            this.lueur?.redimensionner(this.echelle());
            if (a) this.handle?.setAnchor(a);
        });
        suivrePanneau.observe(this.repere.pane);
        this.register(() => suivrePanneau.disconnect());

        // Le navigateur demande le micro pendant que la barre monte.
        const micro = this.ouvrirMicro(estCourant);
        this.monter();
        void micro.then((ok) => {
            if (!estCourant()) return;
            if (!ok) return this.poserEtat('refuse');
            this.poserEtat('connexion');
            void this.appeler(estCourant);
        });
    }

    /** L'appel : la lumière suit le micro quand on parle, la voix de Hone quand il répond. */
    private async appeler(estCourant: () => boolean): Promise<void> {
        const flux = this.flux!;
        const ecouter = (): void => {
            this.poserEtat('ecoute');
            this.lueur?.suivre({ flux });
        };
        try {
            const appel = await appeler(flux, this.zone!, this.historique, {
                pret: () => { if (estCourant() && this.etat === 'connexion') ecouter(); },
                reflechit: (oui) => {
                    if (!estCourant()) return;
                    if (oui) this.poserEtat('reflechit');
                    else if (this.etat === 'reflechit') ecouter();
                },
                honeParle: (niveau: LireNiveau | null) => {
                    if (!estCourant()) return;
                    if (niveau === null) return ecouter();
                    this.poserEtat('repond');
                    this.lueur?.suivre({ niveau });
                },
                replique: (message) => {
                    if (!estCourant()) return;
                    this.historique.push(message);
                    // Ce que dit Hone s'écrit sur la ligne d'état, pour les lecteurs d'écran.
                    if (message.auteur === 'agent') this.dernierDit = this.messageEl.textContent = sansMarkdown(message.texte);
                },
                erreur: (message) => { if (estCourant()) this.montrerErreur(message); },
            });
            if (!estCourant()) return appel.raccrocher();
            this.appel = appel;
        } catch (err: unknown) {
            if (estCourant()) this.montrerErreur(err instanceof Error ? err.message : String(err));
        }
    }

    private montrerErreur(message: string): void {
        this.messageEl.textContent = `Hone n'a pas pu répondre : ${message}`;
        this.messageEl.classList.add('est-visible');
    }

    fermer(): void {
        this.unload();
    }

    onunload(): void {
        this.lacherClavier();
        const { historique, parCroix } = this;
        const boite = this.el.getBoundingClientRect();
        this.parCroix = false;
        this.historique = [];
        this.lancement++;
        this.appel?.raccrocher();
        this.appel = null;
        this.lueur?.detruire();
        this.lueur?.el.remove();
        this.lueur = null;
        for (const piste of this.flux?.getTracks() ?? []) piste.stop();
        this.flux = this.zone = null;
        this.handle?.remove();
        this.handle = null;
        this.el.remove();
        this.el.classList.remove('est-posee');
        this.poserEtat('arrivee');
        this.onFermer(historique, boite, parCroix);
    }

    /** Centrée en bas du panneau ; dans un panneau étroit, elle rétrécit plutôt que déborder. */
    private placer(el: HTMLElement) {
        el.style.width = `${this.largeur()}px`;
        // Collée au bord : la lumière sort du bas du panneau.
        return this.repere.enBas(el, 0);
    }

    private largeur(): number {
        return Math.max(0, Math.min(LARGEUR, this.repere.paneClient().width - 2 * GOUTTIERE));
    }

    /** voice-glow est réglé pour 370 px : on grandit tout l'effet d'autant. */
    private echelle(): number {
        return Math.max(0.5, this.largeur() / LARGEUR_BEAM);
    }

    /** Vrai si le micro est ouvert ; refusé, absent ou lancement fermé : faux. */
    private async ouvrirMicro(estCourant: () => boolean): Promise<boolean> {
        let flux: MediaStream;
        try {
            flux = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        } catch {
            return false;
        }
        if (!estCourant()) {
            for (const piste of flux.getTracks()) piste.stop();
            return false;
        }
        this.flux = flux;
        return true;
    }

    private poserEtat(etat: Etat): void {
        this.etat = etat;
        this.el.dataset.etat = etat;
        const libelle = LIBELLES[etat] ?? '';
        this.stopEl.setAttribute('aria-label', libelle);
        this.stopEl.title = libelle;
        this.stopEl.disabled = etat !== 'repond';
        this.messageEl.textContent = etat === 'repond' ? this.dernierDit : LIGNES[etat] ?? '';
        // Sans boîte, la ligne ne se montre que pour ce que la lumière ne sait pas dire.
        this.messageEl.classList.toggle('est-visible', etat === 'refuse');
        // Le faisceau balaie pendant la connexion et pendant que Hone réfléchit.
        this.lueur?.reflechir(etat === 'connexion' || etat === 'reflechit');
        if (etat !== 'ecoute' && etat !== 'repond') this.lueur?.suivre(null);
    }

    /** La barre monte du bas sur un ressort, puis le contenu arrive en fondu, flou et échelle (Skiper3). */
    private monter(): void {
        const lancement = this.lancement;
        const poser = (): void => this.el.classList.add('est-posee');
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return poser();

        const { easing, duree } = ressort(RAIDEUR, AMORTISSEMENT);
        // `translate` et pas `transform` : le WidgetLayer pose la barre par left/top, on ne s'y mêle pas.
        const montee = this.el.animate([
            { translate: `0 ${MONTEE}px` },
            { translate: '0 0' },
        ], { duration: duree, easing });
        const fondu = this.el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: APPARITION, easing: 'ease-out' });
        const contenu = this.contenuEl.animate([
            { opacity: 0, filter: 'blur(4px)', scale: '0.96' },
            { opacity: 1, filter: 'blur(0px)', scale: '1' },
        ], { duration: APPARITION, delay: RETARD_CONTENU, easing: 'ease-out', fill: 'backwards' });
        this.register(() => { montee.cancel(); fondu.cancel(); contenu.cancel(); });
        void montee.finished.then(() => {
            if (this._loaded && this.lancement === lancement) poser();
        }).catch(() => {});
    }
}
