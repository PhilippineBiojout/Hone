import { Component, setIcon, type App, type WidgetHandle } from 'fragment';
import { resorber, ressort } from '../ui/animations';
import { Onde, auHasard, niveaux } from '../ui/onde';
import type { Message } from '../pont/protocole';
import type { Repere } from '../positionnement/repere';
import { parler, type ContexteQuestion, type ReponseOrale } from '../pont/repondre';
import { arc, boutonIcone, proteger } from '../ui/ui';

const RAIDEUR = 520;                // l'étirement en pilule : spring bounce 0.16 de Motion (Skiper3)
const AMORTISSEMENT = 38;
const RETARD_CONTENU = 250;         // Skiper3 : delay 0.25
const APPARITION = 220;
const RAIDEUR_SURVOL = (2 * Math.PI) ** 2;   // survol : spring duration 1, bounce 0.6 (Skiper25)
const AMORTISSEMENT_SURVOL = 2 * (1 - 0.6) * Math.sqrt(RAIDEUR_SURVOL);
const MS_PAR_CARACTERE = 90;        // si la synthèse vocale ne démarre jamais, la parole revient quand même
const LISSAGE = 0.4;                // celui du navigateur (0,8) laisse l'onde debout deux secondes

/** rond : la barre vient d'y fondre ; refuse : pas de micro. */
type Etat = 'rond' | 'ecoute' | 'reflechit' | 'repond' | 'refuse';

const LIBELLES: Partial<Record<Etat, string>> = {
    ecoute: 'Finir de parler',
    reflechit: "L'agent réfléchit",
    repond: "Couper la parole à Hone",
};

/**
 * La discussion orale : la barre se résorbe en rond, qui s'étire en pilule
 * (croix, onde, point, stop). ■ envoie le tour, l'agent répond à voix haute.
 */
export class VoixAgent extends Component {

    private readonly el = document.createElement('div');
    private readonly contenuEl: HTMLElement;
    private readonly stopEl: HTMLButtonElement;
    private readonly messageEl: HTMLElement;
    private readonly onde = new Onde();
    private readonly lacherClavier: () => void;
    /** Ce qui arrive d'un lancement fermé est ignoré. */
    private lancement = 0;
    /** La fin d'une voix coupée ne relance rien. */
    private parole = 0;
    private etat: Etat = 'rond';
    private zone: ContexteQuestion | null = null;
    private historique: Message[] = [];
    private minuterie = 0;
    private flux: MediaStream | null = null;
    private audio: AudioContext | null = null;
    private analyseur: AnalyserNode | null = null;
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
        this.el.classList.add('agent-voix');
        this.el.setAttribute('role', 'group');
        this.el.setAttribute('aria-label', 'Discussion orale');

        // Premier enfant : c'est lui qui fait le petit pop de resorber().
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
        this.contenuEl.appendChild(document.createElement('span')).classList.add('agent-voix-point');

        this.stopEl = this.contenuEl.appendChild(document.createElement('button'));
        this.stopEl.type = 'button';
        this.stopEl.classList.add('agent-voix-stop');
        this.stopEl.appendChild(document.createElement('span')).classList.add('agent-voix-carre');
        arc(this.stopEl);
        this.stopEl.addEventListener('click', () => this.surStop());

        this.lacherClavier = proteger(app, this.el);
        this.poserEtat('rond');
    }

    estOuverte(): boolean {
        return this._loaded;
    }

    /** `depuis` : la boîte client de ce qui fond dans le rond ; `historique` : une discussion reprise. */
    lancer(zone: ContexteQuestion, depuis: DOMRect, historique: Message[] = []): void {
        const lancement = ++this.lancement;
        const estCourant = (): boolean => this._loaded && this.lancement === lancement;
        this.zone = { ...zone };
        this.historique = [...historique];
        this.poserEtat('rond');

        this.el.style.opacity = '0';
        this.load();
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
        const { historique, parCroix } = this;
        const boite = this.el.getBoundingClientRect();
        this.parCroix = false;
        this.historique = [];
        this.lancement++;
        this.couperVoix();
        this.onde.repos();
        if (this.enregistreur && this.enregistreur.state !== 'inactive') this.enregistreur.stop();
        for (const piste of this.flux?.getTracks() ?? []) piste.stop();
        void this.audio?.close();
        this.flux = this.audio = this.analyseur = this.enregistreur = this.zone = null;
        this.morceaux = [];
        this.handle?.remove();
        this.handle = null;
        this.el.remove();
        this.el.style.opacity = '';
        this.el.style.transition = '';
        this.el.classList.remove('est-posee');
        this.poserEtat('rond');
        this.onFermer(historique, boite, parCroix);
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

    private lecteur(analyseur: AnalyserNode): () => number[] {
        const spectre = new Uint8Array(analyseur.frequencyBinCount);
        const hzParCase = analyseur.context.sampleRate / analyseur.fftSize;
        analyseur.smoothingTimeConstant = LISSAGE;
        return () => {
            analyseur.getByteFrequencyData(spectre);
            return niveaux(spectre, hzParCase);
        };
    }

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
        else if (this.etat === 'repond') {
            this.couperVoix();
            this.ecouter();
        }
    }

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
        } catch (err: unknown) {
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
        this.messageEl.textContent = '';
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
                this.onde.suivre(this.lecteur(analyseur));
            })
            .catch(() => {
                if (this._loaded && courante()) this.direTexte(reponse.texte, fin);
            });
    }

    /** La synthèse du système : on n'entend pas sa sortie, l'onde tourne au hasard. */
    private direTexte(texte: string, fin: () => void): void {
        this.onde.suivre(auHasard);
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
        if (etat === 'refuse') this.messageEl.textContent = 'Micro refusé';
        else if (etat === 'rond') this.messageEl.textContent = '';
    }

    /** Le rond s'étire en pilule, posée à sa taille finale : le bord côté passage ne bouge pas. */
    private etirer(micro: boolean): void {
        const rond = this.el.getBoundingClientRect();
        this.poserEtat(micro ? 'ecoute' : 'refuse');
        if (micro) this.ecouter();
        const lancement = this.lancement;
        const a = this.handle ? this.repere.aCote(this.el) : null;
        if (a) this.handle?.setAnchor(a);
        const poser = (): void => {
            this.el.classList.add('est-posee');
            const { easing, duree } = ressort(RAIDEUR_SURVOL, AMORTISSEMENT_SURVOL);
            this.el.style.transition = `width ${duree}ms ${easing}`;
        };
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return poser();

        // Translation client → repère du parent, comme eclore().
        const pilule = this.el.getBoundingClientRect();
        const dx = parseFloat(this.el.style.left || '0') - pilule.left;
        const dy = parseFloat(this.el.style.top || '0') - pilule.top;
        const { easing, duree } = ressort(RAIDEUR, AMORTISSEMENT);
        const etirement = this.el.animate([
            { left: `${rond.left + dx}px`, top: `${rond.top + dy}px`, width: `${rond.width}px` },
            { left: `${pilule.left + dx}px`, top: `${pilule.top + dy}px`, width: `${pilule.width}px` },
        ], { duration: duree, easing });
        const contenu = this.contenuEl.animate([
            { opacity: 0, filter: 'blur(4px)', scale: '0.5' },
            { opacity: 1, filter: 'blur(0px)', scale: '1' },
        ], { duration: APPARITION, delay: RETARD_CONTENU, easing: 'ease-out', fill: 'backwards' });
        this.register(() => { etirement.cancel(); contenu.cancel(); });
        void etirement.finished.then(() => {
            if (this._loaded && this.lancement === lancement) poser();
        }).catch(() => {});
    }
}
