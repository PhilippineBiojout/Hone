import { Component, type App, type WidgetHandle } from 'fragment';
import { ressort } from '../ui/animations';
import { niveaux, niveauVoix } from '../ui/onde';
import { Lueur, ondulation, type LireNiveau } from '../ui/lueur';
import type { Message } from '../pont/protocole';
import type { Repere } from '../positionnement/repere';
import { parler, type ContexteQuestion, type ReponseOrale } from '../pont/repondre';
import { boutonIcone, proteger } from '../ui/ui';

const LARGEUR = 500;                // la lumière, centrée : 500 px au plus
const LARGEUR_BEAM = 370;           // la largeur pour laquelle le préréglage `default` de voice-glow est réglé
const GOUTTIERE = 16;               // dans un panneau étroit, la barre garde 16 px de chaque côté
const MONTEE = 24;                  // elle monte de 24 px, jusqu'au bord bas du panneau
const RAIDEUR = 520;                // spring bounce 0.16 de Motion, celui de l'ancien étirement (Skiper3)
const AMORTISSEMENT = 38;
const RETARD_CONTENU = 120;
const APPARITION = 220;
const MS_PAR_CARACTERE = 90;        // si la synthèse vocale ne démarre jamais, la parole revient quand même
const LISSAGE = 0.4;                // celui du navigateur (0,8) laisse la voix de Hone allumée deux secondes

/** arrivee : la barre monte, le micro se demande ; refuse : pas de micro. */
type Etat = 'arrivee' | 'ecoute' | 'reflechit' | 'repond' | 'refuse';

const LIBELLES: Partial<Record<Etat, string>> = {
    ecoute: 'Finir de parler',
    reflechit: 'Hone réfléchit',
    repond: "Couper la parole à Hone",
};

/** La ligne d'état ; en `repond`, c'est ce que dit Hone qui s'y écrit. */
const LIGNES: Partial<Record<Etat, string>> = {
    ecoute: 'Je vous écoute…',
    reflechit: 'Hone réfléchit…',
    refuse: 'Micro refusé',
};

/**
 * La discussion orale : rien qu'une lumière (voice-glow, libraries.dev/voice) qui
 * sort du bord bas du panneau quand on touche le micro, et suit la voix. Deux ronds
 * centrés au-dessus : arrêter de parler (finir son tour, ou couper Hone) et fermer.
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
    /** La fin d'une voix coupée ne relance rien. */
    private parole = 0;
    private etat: Etat = 'arrivee';
    private zone: ContexteQuestion | null = null;
    private historique: Message[] = [];
    private minuterie = 0;
    private flux: MediaStream | null = null;
    private audio: AudioContext | null = null;
    private enregistreur: MediaRecorder | null = null;
    private morceaux: Blob[] = [];
    private lecture: AudioBufferSourceNode | null = null;
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
        // Arrêter de parler : finir son tour en écoute, couper Hone quand il parle.
        this.stopEl = boutonIcone(actions, 'square', '', () => this.surStop(), 'agent-voix-stop');
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
            this.poserEtat(ok ? 'ecoute' : 'refuse');
            if (ok) this.ecouter();
        });
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
        this.couperVoix();
        this.lueur?.detruire();
        this.lueur?.el.remove();
        this.lueur = null;
        if (this.enregistreur && this.enregistreur.state !== 'inactive') this.enregistreur.stop();
        for (const piste of this.flux?.getTracks() ?? []) piste.stop();
        void this.audio?.close();
        this.flux = this.audio = this.enregistreur = this.zone = null;
        this.morceaux = [];
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
        // Le nôtre sert à lire la voix de Hone ; voice-glow écoute le micro dans le sien.
        this.audio = new AudioContext();
        this.enregistreur = new MediaRecorder(flux);
        this.enregistreur.addEventListener('dataavailable', (e) => {
            if (e.data.size > 0) this.morceaux.push(e.data);
        });
        return true;
    }

    /** Le niveau d'une voix qu'on joue, lu dans son analyseur, image par image. */
    private lecteur(analyseur: AnalyserNode): LireNiveau {
        const spectre = new Uint8Array(analyseur.frequencyBinCount);
        const hzParCase = analyseur.context.sampleRate / analyseur.fftSize;
        analyseur.smoothingTimeConstant = LISSAGE;
        return () => {
            analyseur.getByteFrequencyData(spectre);
            return niveauVoix(niveaux(spectre, hzParCase));
        };
    }

    private ecouter(): void {
        if (!this.enregistreur || !this.flux) return;
        this.poserEtat('ecoute');
        this.morceaux = [];
        if (this.enregistreur.state === 'inactive') this.enregistreur.start();
        void this.audio?.resume();
        this.lueur?.suivre({ flux: this.flux });
    }

    private surStop(): void {
        if (this.etat === 'ecoute') void this.finirTour();
        else if (this.etat === 'repond') {
            this.couperVoix();
            this.ecouter();
        }
    }

    private async finirTour(): Promise<void> {
        const lancement = this.lancement;
        const estCourant = (): boolean => this._loaded && this.lancement === lancement;
        this.poserEtat('reflechit');
        const enregistrement = await this.arreterEnregistrement();
        if (!estCourant() || !this.zone) return;
        let reponse: ReponseOrale;
        try {
            reponse = await parler(enregistrement, this.zone, this.historique);
        } catch (err: unknown) {
            if (!estCourant()) return;
            this.ecouter();
            // Après ecouter() : la ligne d'état l'aurait effacée.
            this.messageEl.textContent = `Hone n'a pas pu répondre : ${err instanceof Error ? err.message : String(err)}`;
            this.messageEl.classList.add('est-visible');
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
            enregistreur.addEventListener('stop', () => resoudre(new Blob(this.morceaux, { type: enregistreur.mimeType })), { once: true });
            enregistreur.stop();
        });
    }

    /** Sa vraie voix si le back en renvoie une, la synthèse du système sinon. */
    private dire(reponse: ReponseOrale): void {
        const parole = ++this.parole;
        const courante = (): boolean => this.parole === parole && this.etat === 'repond';
        const fin = (): void => {
            if (this._loaded && courante()) this.ecouter();
        };
        this.poserEtat('repond');
        this.messageEl.textContent = reponse.texte;
        const audio = this.audio;
        if (!reponse.audio || !audio) return this.direTexte(reponse.texte, fin);
        audio.decodeAudioData(reponse.audio.slice(0))
            .then((tampon) => {
                if (!courante()) return;
                const source = audio.createBufferSource();
                source.buffer = tampon;
                const analyseur = audio.createAnalyser();
                analyseur.fftSize = 1024;
                source.connect(analyseur);
                analyseur.connect(audio.destination);
                source.addEventListener('ended', fin);
                this.lecture = source;
                source.start();
                this.lueur?.suivre({ niveau: this.lecteur(analyseur) });
            })
            .catch(() => {
                if (this._loaded && courante()) this.direTexte(reponse.texte, fin);
            });
    }

    /** La synthèse du système : on n'entend pas sa sortie, la lueur ondule comme une phrase. */
    private direTexte(texte: string, fin: () => void): void {
        this.lueur?.suivre({ niveau: () => ondulation() });
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

    private couperVoix(): void {
        this.parole++;
        window.clearTimeout(this.minuterie);
        if ('speechSynthesis' in window) window.speechSynthesis.cancel();
        try {
            this.lecture?.stop();
        } catch {
            // Pas encore démarrée.
        }
        this.lecture = null;
    }

    private poserEtat(etat: Etat): void {
        this.etat = etat;
        this.el.dataset.etat = etat;
        const libelle = LIBELLES[etat] ?? '';
        this.stopEl.setAttribute('aria-label', libelle);
        this.stopEl.title = libelle;
        this.stopEl.disabled = etat !== 'ecoute' && etat !== 'repond';
        this.messageEl.textContent = LIGNES[etat] ?? '';
        // Sans boîte, la ligne ne se montre que pour ce que la lumière ne sait pas dire.
        this.messageEl.classList.toggle('est-visible', etat === 'refuse');
        this.lueur?.reflechir(etat === 'reflechit');
        if (etat === 'reflechit' || etat === 'refuse' || etat === 'arrivee') this.lueur?.suivre(null);
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
