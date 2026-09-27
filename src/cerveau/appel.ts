import type { Message, Passage } from '../pont/protocole';
import { niveaux, niveauVoix } from '../ui/onde';
import type { LireNiveau } from '../ui/lueur';
import { dire, ecouter, jeton, type Parole } from './gradium';
import type { MoteurCodex } from './moteur-codex';

// La discussion orale en direct : Gradium écoute le micro et repère seul la fin d'une phrase,
// Codex (le compte ChatGPT, sans outils) répond, Gradium le dit. On parle à tour de rôle :
// pendant que Hone réfléchit ou parle, le micro n'est plus envoyé. Ce fichier ne connaît ni la
// lumière ni les boutons : il dit seulement où en est Hone, ce qui s'est dit, et ce qui a mal
// tourné (VoixAgent.ts en fait l'écran).

export interface EcouteursAppel {
    /** La connexion est établie : on peut parler. */
    pret(): void;
    /** Une phrase est finie : Hone réfléchit (vrai), ou a fini de réfléchir (faux). */
    reflechit(oui: boolean): void;
    /** Hone commence à parler (`niveau` lit sa voix, image par image), ou s'est tu (null). */
    honeParle(niveau: LireNiveau | null): void;
    /** Une réplique finie, transcrite. */
    replique(message: Message): void;
    erreur(message: string): void;
}

export interface Appel {
    /** Coupe la parole à Hone : sa voix se tait jusqu'à la fin de sa réplique. */
    couper(): void;
    raccrocher(): void;
}

const SEUIL = 0.04;          // au-dessus, la voix de Hone s'entend
const SILENCE_MS = 500;      // un silence plus long, et Hone s'est tu
const LISSAGE = 0.4;         // celui du navigateur (0,8) laisse la voix allumée deux secondes
const PERIODE_MS = 50;

/** Le niveau d'une voix, lu dans son analyseur. */
function lecteur(analyseur: AnalyserNode): LireNiveau {
    const spectre = new Uint8Array(analyseur.frequencyBinCount);
    const hzParCase = analyseur.context.sampleRate / analyseur.fftSize;
    analyseur.smoothingTimeConstant = LISSAGE;
    return () => {
        analyseur.getByteFrequencyData(spectre);
        return niveauVoix(niveaux(spectre, hzParCase));
    };
}

/**
 * Suit une voix : `parle(lire)` quand elle monte, `parle(null)` après un silence. Rend de quoi
 * arrêter. Le niveau se lit sur le flux, pas sur ce qu'on entend : une voix coupée se suit encore.
 */
function suivreVoix(flux: MediaStream, parle: (lire: LireNiveau | null) => void): () => void {
    const audio = new AudioContext();
    const analyseur = audio.createAnalyser();
    analyseur.fftSize = 1024;
    audio.createMediaStreamSource(flux).connect(analyseur);
    const lire = lecteur(analyseur);
    let enCours = false;
    let dernier = 0;
    const minuterie = window.setInterval(() => {
        const maintenant = performance.now();
        if (lire() > SEUIL) {
            dernier = maintenant;
            if (!enCours) {
                enCours = true;
                parle(lire);
            }
        } else if (enCours && maintenant - dernier > SILENCE_MS) {
            enCours = false;
            parle(null);
        }
    }, PERIODE_MS);
    return () => {
        window.clearInterval(minuterie);
        void audio.close();
    };
}

/** L'appel réel : Gradium pour l'oreille et la voix, Codex pour la réponse. */
export async function appelGradium(
    moteur: MoteurCodex, cle: string, micro: MediaStream, passage: Passage, historique: Message[], e: EcouteursAppel,
): Promise<Appel> {
    const fil = [...historique];
    let parole: Parole | null = null;
    let fini = false;
    const token = await jeton(cle);

    const repondre = async (phrase: string): Promise<void> => {
        oreille.ouvrir(false);
        e.replique({ auteur: 'moi', texte: phrase });
        e.reflechit(true);
        try {
            const { texte, langue } = await moteur.direOral(passage, fil, phrase);
            fil.push({ auteur: 'moi', texte: phrase }, { auteur: 'agent', texte });
            if (fini) return;
            e.reflechit(false);
            e.replique({ auteur: 'agent', texte });
            parole = dire(texte, langue, await jeton(cle), e.erreur);
            e.honeParle(parole.niveau);
            await parole.fin;
        } catch (err) {
            e.reflechit(false);
            if (!fini) e.erreur(err instanceof Error ? err.message : String(err));
        } finally {
            parole = null;
            if (!fini) {
                e.honeParle(null);
                oreille.ouvrir(true);
            }
        }
    };

    const oreille = ecouter(micro, token, {
        pret: () => { if (!fini) e.pret(); },
        surPhrase: (phrase) => { if (!fini) void repondre(phrase); },
        erreur: (message) => { if (!fini) e.erreur(message); },
    });
    return {
        couper: () => parole?.couper(),
        raccrocher: () => {
            fini = true;
            parole?.couper();
            oreille.fermer();
        },
    };
}

/**
 * L'appel factice (réglage `factice`, e2e) : une phrase au micro, puis un silence, font un tour ;
 * Hone répond par la synthèse du système. Même contrat que l'appel réel.
 */
export function appelFactice(micro: MediaStream, passage: Passage, historique: Message[], e: EcouteursAppel): Appel {
    let tour = historique.filter((m) => m.auteur === 'moi').length;
    let fini = false;
    const extrait = passage.texte.length > 40 ? `${passage.texte.slice(0, 40)}…` : passage.texte;
    const ondulation: LireNiveau = () => 0.5 + 0.3 * Math.sin(performance.now() / 120);
    let parleHone = false;
    const taire = (): void => {
        if (!parleHone) return;
        parleHone = false;
        occupe = false;
        window.speechSynthesis?.cancel();
        e.honeParle(null);
    };
    let occupe = false;
    const arreter = suivreVoix(micro, (lire) => {
        if (lire !== null || fini || occupe) return;
        occupe = true;
        tour++;
        e.replique({ auteur: 'moi', texte: `Transcription factice du tour ${tour}.` });
        e.reflechit(true);
        // Comme Codex, un temps pour réfléchir ; puis la synthèse du système parle.
        window.setTimeout(() => {
            if (fini) return;
            e.reflechit(false);
            const texte = `Réponse orale factice numéro ${tour}, sur le passage « ${extrait} ».`;
            e.replique({ auteur: 'agent', texte });
            parleHone = true;
            e.honeParle(ondulation);
            const enonce = new SpeechSynthesisUtterance(texte);
            enonce.lang = 'fr-FR';
            enonce.addEventListener('end', taire);
            enonce.addEventListener('error', taire);
            window.speechSynthesis.speak(enonce);
        }, 700);
    });
    queueMicrotask(() => { if (!fini) e.pret(); });
    return {
        couper: taire,
        raccrocher: () => {
            fini = true;
            arreter();
            taire();
        },
    };
}
