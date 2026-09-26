import { Component, setIcon, type App, type WidgetHandle } from 'fragment';
import { resorber } from './ActionAgent';
import { arc, boutonIcone } from './bouton';
import { proteger } from './clavier';
import { ressort } from './eclosion';
import type { Repere } from './repere';
import { Onde, auHasard, niveaux } from './onde';
import { parler, type ContexteQuestion, type ReponseOrale } from './repondre';
import type { Message } from './traces';

/**
 * L'étirement du rond en pilule : l'équivalent de `{ type: "spring", bounce: 0.16 }`
 * de Motion, le même que la rallonge (Skiper3).
 */
const RAIDEUR = 520;
const AMORTISSEMENT = 38;

/** Le contenu apparaît en cours d'étirement (Skiper3 : `delay: 0.25`), en fondu, flou et échelle. */
const RETARD_CONTENU = 250;
const APPARITION = 220;

/**
 * Le survol élargit la pilule sur un ressort très rebondi : l'équivalent de
 * `{ type: "spring", duration: 1, bounce: 0.6 }` de Motion (Skiper25).
 * Raideur (2π / 1 s)², amortissement 2 × (1 − 0,6) × √raideur.
 */
const RAIDEUR_SURVOL = (2 * Math.PI) ** 2;
const AMORTISSEMENT_SURVOL = 2 * (1 - 0.6) * Math.sqrt(RAIDEUR_SURVOL);

/**
 * Si la synthèse vocale ne démarre jamais (absente, ou muette), l'agent rend
 * quand même la parole : 90 ms par caractère, un débit de lecture ordinaire.
 */
const MS_PAR_CARACTERE = 90;

/**
 * Le lissage du spectre, appliqué à chaque relecture (toutes les 100 ms).
 * Celui du navigateur (0,8) laisse l'onde debout deux secondes après qu'on
 * s'est tu ; le ressort des traits lisse déjà le reste.
 */
const LISSAGE = 0.4;

/**
 * - `rond` : la barre vient de fondre dans le rond du micro ;
 * - `ecoute` : on parle, l'onde suit le micro ;
 * - `reflechit` : le tour est parti vers l'agent ;
 * - `repond` : l'agent parle, l'onde suit sa voix ;
 * - `refuse` : pas de micro (refusé, ou absent).
 */
type Etat = 'rond' | 'ecoute' | 'reflechit' | 'repond' | 'refuse';

/**
 * La discussion orale sur un passage : le micro de la barre.
 *
 * La barre se résorbe en rond au micro (le geste des outils), puis le rond
 * s'étire en pilule vers l'extérieur (Skiper3). Dedans, de gauche à droite :
 * une croix, l'onde à cinq traits (Skiper25), un point, un rond stop. On
 * parle, ■ envoie le tour à l'agent (`parler`, repondre.ts), qui répond à voix
 * haute ; puis la pilule écoute de nouveau. Un tour à la fois : le micro est
 * coupé pendant que l'agent parle, il ne s'entend pas lui-même.
 *
 * Comme la barre, le chat et les cartes, elle ne se ferme QU'À SA CROIX. Le
 * micro est rendu à la fermeture, et les tours passent au calque, qui en
 * fait écrire le bilan (ActionAgent.lancerBilan).
 *
 * La pilule est un widget du cœur, ancré au document à côté du trait
 * (Repere) : elle défile avec la note.
 */
export class VoixAgent extends Component {

    private readonly el: HTMLElement;
    private readonly contenuEl: HTMLElement;
    private readonly stopEl: HTMLButtonElement;
    private readonly messageEl: HTMLElement;
    private readonly onde = new Onde();

    /** Le numéro du lancement en cours : ce qui arrive d'un lancement fermé est ignoré. */
    private lancement = 0;
    /** Le numéro de la réponse en cours : la fin d'une voix coupée ne relance rien. */
    private parole = 0;
    private etat: Etat = 'rond';
    private zone: ContexteQuestion | null = null;
    private historique: Message[] = [];
    private minuterie = 0;

    // Le micro, ouvert du premier tour à la croix.
    private flux: MediaStream | null = null;
    private audio: AudioContext | null = null;
    private analyseur: AnalyserNode | null = null;
    private enregistreur: MediaRecorder | null = null;
    private morceaux: Blob[] = [];
    /** La voix de l'agent, quand le back en renvoie une. */
    private lecture: AudioBufferSourceNode | null = null;

    private readonly repere: Repere;
    private handle: WidgetHandle | null = null;
    /**
     * Prévenu à la fermeture, avec les tours de la discussion et la boîte
     * CLIENT de la pilule juste avant son retrait : le bilan en sort.
     * `parCroix` : faux quand le calque la ferme (une autre trace rouverte,
     * un autre document, la vue démontée).
     */
    private readonly onFermer: (historique: Message[], boite: DOMRect, parCroix: boolean) => void;
    /** Fermée par sa croix : seul ce geste demande un bilan. */
    private parCroix = false;

    /** Retire la portée clavier (clavier.ts), au démontage. */
    private readonly lacherClavier: () => void;

    constructor(
        app: App,
        repere: Repere,
        onFermer: (historique: Message[], boite: DOMRect, parCroix: boolean) => void,
    ) {
        super();
        this.repere = repere;
        this.onFermer = onFermer;

        this.el = document.createElement('div');
        this.el.classList.add('agent-voix');
        this.el.setAttribute('role', 'group');
        this.el.setAttribute('aria-label', 'Discussion orale');

        // Le micro du rond : le premier enfant, qui fait le petit pop de resorber().
        const microEl = this.el.appendChild(document.createElement('span'));
        microEl.classList.add('agent-voix-micro');
        setIcon(microEl, 'mic');

        this.contenuEl = this.el.appendChild(document.createElement('div'));
        this.contenuEl.classList.add('agent-voix-contenu');

        boutonIcone(this.contenuEl, 'x', 'Fermer', () => {
            this.parCroix = true;
            this.fermer();
        }, 'agent-voix-fermer');

        this.contenuEl.appendChild(this.onde.el);

        this.messageEl = this.contenuEl.appendChild(document.createElement('span'));
        this.messageEl.classList.add('agent-voix-message');
        this.messageEl.setAttribute('role', 'status');

        const pointEl = this.contenuEl.appendChild(document.createElement('span'));
        pointEl.classList.add('agent-voix-point');

        this.stopEl = this.contenuEl.appendChild(document.createElement('button'));
        this.stopEl.type = 'button';
        this.stopEl.classList.add('agent-voix-stop');
        this.stopEl.appendChild(document.createElement('span')).classList.add('agent-voix-carre');
        // L'arc qui tourne des outils : l'agent réfléchit.
        arc(this.stopEl);
        this.stopEl.addEventListener('click', () => this.surStop());

        this.lacherClavier = proteger(app, this.el);
        this.poserEtat('rond');
    }

    estOuverte(): boolean {
        return this._loaded;
    }

    /**
     * Ouvre la discussion sur `zone`. `depuis` est la boîte CLIENT de ce qui
     * fond dans le rond (la barre, ou le chat d'une discussion reprise), juste
     * avant son retrait. `historique` : les tours d'une discussion qu'on reprend.
     */
    lancer(zone: ContexteQuestion, depuis: DOMRect, historique: Message[] = []): void {
        this.lancement++;
        const lancement = this.lancement;
        const estCourant = (): boolean => this._loaded && this.lancement === lancement;
        this.zone = { ...zone };
        this.historique = [...historique];
        this.poserEtat('rond');

        this.el.style.opacity = '0';
        this.load();
        // Le rond à la place de la barre : à côté du trait, centré sur lui.
        this.handle = this.repere.monter(this.el, (el) => this.repere.aCote(el));

        // Le navigateur demande le micro pendant que la barre fond.
        const micro = this.ouvrirMicro(estCourant);
        const resorption = resorber(depuis, this.el);
        this.register(() => resorption.annuler());
        void resorption.fini.then(async () => {
            const ok = await micro;
            if (estCourant()) this.etirer(ok);
        });
    }

    fermer(): void {
        this.unload();
    }

    onunload(): void {
        this.lacherClavier();
        const historique = this.historique;
        const boite = this.el.getBoundingClientRect();
        const parCroix = this.parCroix;
        this.parCroix = false;
        this.historique = [];
        this.lancement++;
        this.couperVoix();
        this.onde.repos();
        if (this.enregistreur && this.enregistreur.state !== 'inactive') this.enregistreur.stop();
        for (const piste of this.flux?.getTracks() ?? []) piste.stop();
        void this.audio?.close();
        this.flux = null;
        this.audio = null;
        this.analyseur = null;
        this.enregistreur = null;
        this.morceaux = [];
        this.zone = null;
        this.handle?.remove();
        this.handle = null;
        this.el.remove();
        // Réutilisée d'un passage à l'autre : elle renaîtra ronde.
        this.el.style.opacity = '';
        this.el.style.transition = '';
        this.el.classList.remove('est-posee');
        this.poserEtat('rond');
        this.onFermer(historique, boite, parCroix);
    }

    // ── Le micro ────────────────────────────────────────────────────────────

    /** Vrai si le micro est ouvert. Refusé, absent ou lancement fermé : faux. */
    private async ouvrirMicro(estCourant: () => boolean): Promise<boolean> {
        let flux: MediaStream;
        try {
            flux = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        }
        catch {
            return false;
        }
        if (!estCourant()) {
            for (const piste of flux.getTracks()) piste.stop();
            return false;
        }
        this.flux = flux;
        this.audio = new AudioContext();
        this.analyseur = this.audio.createAnalyser();
        this.analyseur.fftSize = 1024;
        // Pas de sortie : on s'entendrait dans le haut-parleur.
        this.audio.createMediaStreamSource(flux).connect(this.analyseur);
        this.enregistreur = new MediaRecorder(flux);
        this.enregistreur.addEventListener('dataavailable', (e) => {
            if (e.data.size > 0) this.morceaux.push(e.data);
        });
        return true;
    }

    /** Les niveaux de l'onde, lus dans le spectre de `analyseur`. */
    private lecteur(analyseur: AnalyserNode): () => number[] {
        const spectre = new Uint8Array(analyseur.frequencyBinCount);
        const hzParCase = analyseur.context.sampleRate / analyseur.fftSize;
        analyseur.smoothingTimeConstant = LISSAGE;
        return () => {
            analyseur.getByteFrequencyData(spectre);
            return niveaux(spectre, hzParCase);
        };
    }

    // ── Les tours de parole ─────────────────────────────────────────────────

    private ecouter(): void {
        if (!this.enregistreur || !this.analyseur) return;
        this.poserEtat('ecoute');
        this.morceaux = [];
        if (this.enregistreur.state === 'inactive') this.enregistreur.start();
        void this.audio?.resume();
        this.onde.suivre(this.lecteur(this.analyseur));
    }

    private surStop(): void {
        if (this.etat === 'ecoute') void this.finirTour();
        // Pendant que l'agent parle, ■ lui coupe la parole.
        else if (this.etat === 'repond') {
            this.couperVoix();
            this.ecouter();
        }
    }

    /** ■ : le tour part à l'agent, qui répond à voix haute. */
    private async finirTour(): Promise<void> {
        const lancement = this.lancement;
        const estCourant = (): boolean => this._loaded && this.lancement === lancement;
        this.poserEtat('reflechit');
        this.onde.repos();
        const enregistrement = await this.arreterEnregistrement();
        if (!estCourant() || !this.zone) return;
        let reponse: ReponseOrale;
        try {
            reponse = await parler(enregistrement, this.zone, this.historique);
        }
        catch (err: unknown) {
            if (!estCourant()) return;
            this.messageEl.textContent = `L'agent n'a pas pu répondre : ${err instanceof Error ? err.message : String(err)}`;
            this.ecouter();
            return;
        }
        if (!estCourant()) return;
        this.historique.push(
            { auteur: 'moi', texte: reponse.transcription ?? '(message vocal)' },
            { auteur: 'agent', texte: reponse.texte },
        );
        this.dire(reponse);
    }

    private arreterEnregistrement(): Promise<Blob> {
        const enregistreur = this.enregistreur;
        if (!enregistreur || enregistreur.state === 'inactive') return Promise.resolve(new Blob(this.morceaux));
        return new Promise((resoudre) => {
            // Le dernier morceau arrive avant `stop`.
            enregistreur.addEventListener('stop', () => {
                resoudre(new Blob(this.morceaux, { type: enregistreur.mimeType }));
            }, { once: true });
            enregistreur.stop();
        });
    }

    /** L'agent parle : sa vraie voix si le back en renvoie une, la synthèse du système sinon. */
    private dire(reponse: ReponseOrale): void {
        this.parole++;
        const parole = this.parole;
        const fin = (): void => {
            if (this._loaded && this.parole === parole && this.etat === 'repond') this.ecouter();
        };
        this.poserEtat('repond');
        this.messageEl.textContent = '';

        const audio = this.audio;
        if (reponse.audio && audio) {
            audio.decodeAudioData(reponse.audio.slice(0))
                .then((tampon) => {
                    if (this.parole !== parole || this.etat !== 'repond') return;
                    const source = audio.createBufferSource();
                    source.buffer = tampon;
                    const analyseur = audio.createAnalyser();
                    analyseur.fftSize = 1024;
                    source.connect(analyseur);
                    analyseur.connect(audio.destination);
                    source.addEventListener('ended', fin);
                    this.lecture = source;
                    source.start();
                    this.onde.suivre(this.lecteur(analyseur));
                })
                // Illisible : la synthèse du système, si cette réponse est encore la bonne.
                .catch(() => {
                    if (this._loaded && this.parole === parole && this.etat === 'repond') this.direTexte(reponse.texte, fin);
                });
            return;
        }
        this.direTexte(reponse.texte, fin);
    }

    /**
     * La synthèse vocale du système : on n'entend pas sa sortie, l'onde
     * tourne au hasard comme dans Skiper25.
     */
    private direTexte(texte: string, fin: () => void): void {
        this.onde.suivre(auHasard);
        // Sans synthèse, ou si elle ne démarre jamais : la parole revient quand même.
        this.minuterie = window.setTimeout(fin, Math.max(2000, texte.length * MS_PAR_CARACTERE));
        if (!('speechSynthesis' in window)) return;
        const enonce = new SpeechSynthesisUtterance(texte);
        enonce.lang = 'fr-FR';
        enonce.addEventListener('start', () => window.clearTimeout(this.minuterie));
        enonce.addEventListener('end', fin);
        enonce.addEventListener('error', fin);
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(enonce);
    }

    /** Fait taire l'agent, quelle que soit sa voix. */
    private couperVoix(): void {
        this.parole++;
        window.clearTimeout(this.minuterie);
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
        try {
            this.lecture?.stop();
        }
        catch {
            // Pas encore démarrée : rien à arrêter.
        }
        this.lecture = null;
    }

    // ── L'aspect ────────────────────────────────────────────────────────────

    private poserEtat(etat: Etat): void {
        this.etat = etat;
        this.el.dataset.etat = etat;
        const libelles: Partial<Record<Etat, string>> = {
            ecoute: 'Finir de parler',
            reflechit: "L'agent réfléchit",
            repond: "Couper la parole à l'agent",
        };
        const libelle = libelles[etat] ?? '';
        this.stopEl.setAttribute('aria-label', libelle);
        this.stopEl.title = libelle;
        this.stopEl.disabled = etat !== 'ecoute' && etat !== 'repond';
        if (etat === 'refuse') this.messageEl.textContent = 'Micro refusé';
        else if (etat === 'rond') this.messageEl.textContent = '';
    }

    /**
     * Le rond s'étire en pilule. La pilule prend sa taille finale et sa place
     * (à droite du passage, ou à gauche si la droite est prise), puis on
     * anime sa boîte depuis celle du rond : le bord côté passage ne bouge pas.
     */
    private etirer(micro: boolean): void {
        const rond = this.el.getBoundingClientRect();
        this.poserEtat(micro ? 'ecoute' : 'refuse');
        if (micro) this.ecouter();
        const lancement = this.lancement;
        // La pilule prend sa place à sa taille finale : à gauche du passage,
        // elle s'étire vers la gauche, son bord côté passage ne bouge pas.
        if (this.handle) {
            const a = this.repere.aCote(this.el);
            if (a) this.handle.setAnchor(a);
        }
        const poser = (): void => {
            this.el.classList.add('est-posee');
            const { easing, duree } = ressort(RAIDEUR_SURVOL, AMORTISSEMENT_SURVOL);
            this.el.style.transition = `width ${duree}ms ${easing}`;
        };
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            poser();
            return;
        }

        // Même translation client → repère du parent qu'eclosion.ts.
        const pilule = this.el.getBoundingClientRect();
        const dx = parseFloat(this.el.style.left || '0') - pilule.left;
        const dy = parseFloat(this.el.style.top || '0') - pilule.top;
        const { easing, duree } = ressort(RAIDEUR, AMORTISSEMENT);
        const etirement = this.el.animate(
            [
                { left: `${rond.left + dx}px`, top: `${rond.top + dy}px`, width: `${rond.width}px` },
                { left: `${pilule.left + dx}px`, top: `${pilule.top + dy}px`, width: `${pilule.width}px` },
            ],
            { duration: duree, easing },
        );
        const contenu = this.contenuEl.animate(
            [
                { opacity: 0, filter: 'blur(4px)', scale: '0.5' },
                { opacity: 1, filter: 'blur(0px)', scale: '1' },
            ],
            { duration: APPARITION, delay: RETARD_CONTENU, easing: 'ease-out', fill: 'backwards' },
        );
        this.register(() => { etirement.cancel(); contenu.cancel(); });
        void etirement.finished.then(() => {
            if (this._loaded && this.lancement === lancement) poser();
        }).catch(() => {});
    }
}
