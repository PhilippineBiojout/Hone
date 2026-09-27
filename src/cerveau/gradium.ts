import { niveaux, niveauVoix } from '../ui/onde';
import type { LireNiveau } from '../ui/lueur';

// L'oreille et la bouche de Hone : Gradium (docs.gradium.ai), un des sponsors du hackathon.
// Le STT transcrit le micro en direct et dit, par sa détection d'activité (VAD), quand une
// phrase est finie ; le TTS dit la réponse. Gradium n'a pas de cerveau : la réponse vient de
// Codex (appel.ts). Tout se fait depuis la page : une page ne peut pas poser d'en-tête sur une
// WebSocket, alors la clé s'échange d'abord contre un jeton court, passé en `?token=`.

const API = 'https://api.gradium.ai/api';
const WSS = 'wss://api.gradium.ai/api';
/** Apolline : « une voix française vive et attentive, qui va droit au but avec le sourire ». */
export const VOIX = '6oIkS98REoVZ1dEw';

const TAUX_MICRO = 24_000;      // le STT attend du PCM 16 bits mono à 24 kHz
const TAUX_VOIX = 48_000;       // le TTS rend du PCM 16 bits mono à 48 kHz
const MORCEAU = 2048;           // ~85 ms de micro par message (Gradium conseille 80 ms)
/** Fin de phrase : l'horizon le plus long de la VAD au-dessus de 0,5, trois pas de suite (80 ms chacun). */
export const SEUIL_SILENCE = 0.5;
export const PAS_DE_SILENCE = 3;
const LISSAGE = 0.4;

interface Jeton { token: string; expires_at: string }

let enCache: { cle: string; jeton: Jeton } | null = null;

/** Un jeton court contre la clé ; gardé tant qu'il lui reste une minute. */
export async function jeton(cle: string): Promise<string> {
    if (enCache?.cle === cle && Date.parse(enCache.jeton.expires_at) - Date.now() > 60_000) return enCache.jeton.token;
    const r = await fetch(`${API}/api-keys/token`, { headers: { 'x-api-key': cle } });
    if (r.status === 401 || r.status === 403) throw new Error('clé Gradium refusée (commande « Hone : clé Gradium… »).');
    if (!r.ok) throw new Error(`Gradium a répondu ${r.status}.`);
    const j = await r.json() as Jeton;
    enCache = { cle, jeton: j };
    return j.token;
}

function socket(chemin: string, token: string): WebSocket {
    const url = new URL(`${WSS}/${chemin}`);
    url.searchParams.set('token', token);
    return new WebSocket(url);
}

/** Des échantillons flottants (-1 à 1) en PCM 16 bits little-endian, en base64. */
export function pcm16Base64(echantillons: Float32Array): string {
    const octets = new Uint8Array(echantillons.length * 2);
    const vue = new DataView(octets.buffer);
    for (let i = 0; i < echantillons.length; i++) {
        const s = Math.max(-1, Math.min(1, echantillons[i]));
        vue.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    let binaire = '';
    for (let i = 0; i < octets.length; i += 0x8000) binaire += String.fromCharCode(...octets.subarray(i, i + 0x8000));
    return btoa(binaire);
}

/** Du PCM 16 bits little-endian en base64, en échantillons flottants. */
export function base64Pcm16(b64: string): Float32Array<ArrayBuffer> {
    const binaire = atob(b64);
    const n = Math.floor(binaire.length / 2);
    const sortie = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const v = binaire.charCodeAt(2 * i) | (binaire.charCodeAt(2 * i + 1) << 8);
        sortie[i] = (v >= 0x8000 ? v - 0x10000 : v) / 0x8000;
    }
    return sortie;
}

/**
 * Compte les pas de silence d'après les messages `step` : rend vrai quand la phrase est finie.
 * `vad` : les horizons de la VAD, le plus long en dernier.
 */
export function finDePhrase(): (vad: { inactivity_prob: number }[]) => boolean {
    let suite = 0;
    return (vad) => {
        const p = vad.at(-1)?.inactivity_prob ?? 0;
        suite = p > SEUIL_SILENCE ? suite + 1 : 0;
        return suite >= PAS_DE_SILENCE;
    };
}

export interface Oreille {
    /** Faux : le micro n'est plus envoyé (Hone réfléchit ou parle, sa voix ne doit pas s'entendre). */
    ouvrir(oui: boolean): void;
    fermer(): void;
}

/**
 * Le STT sur le micro : `surPhrase` reçoit chaque phrase finie ; `pret` quand Gradium écoute.
 */
export function ecouter(
    micro: MediaStream, token: string,
    e: { pret(): void; surPhrase(texte: string): void; erreur(message: string): void },
): Oreille {
    const ws = socket('speech/asr', token);
    const audio = new AudioContext({ sampleRate: TAUX_MICRO });
    const source = audio.createMediaStreamSource(micro);
    // ScriptProcessor plutôt qu'AudioWorklet : pas de module à charger, rien que la CSP puisse bloquer.
    const processeur = audio.createScriptProcessor(MORCEAU, 1, 1);
    let ouverte = true;
    let pret = false;
    let texte = '';
    let flush = 0;
    let attendFlush = false;
    const fin = finDePhrase();

    processeur.onaudioprocess = (ev) => {
        if (!pret || !ouverte || ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({ type: 'audio', audio: pcm16Base64(ev.inputBuffer.getChannelData(0)) }));
    };
    source.connect(processeur);
    // Un ScriptProcessor ne tourne que branché ; sa sortie reste muette (on n'écrit rien dedans).
    processeur.connect(audio.destination);

    ws.addEventListener('open', () => {
        ws.send(JSON.stringify({ type: 'setup', model_name: 'default', input_format: 'pcm', json_config: { language: 'fr' } }));
    });
    ws.addEventListener('message', (ev) => {
        const m = JSON.parse(String(ev.data)) as { type: string; text?: string; vad?: { inactivity_prob: number }[]; message?: string };
        switch (m.type) {
            case 'ready':
                pret = true;
                e.pret();
                break;
            case 'text':
                texte = `${texte} ${m.text ?? ''}`.trim();
                break;
            case 'step':
                if (ouverte && !attendFlush && texte && m.vad && fin(m.vad)) {
                    attendFlush = true;
                    ws.send(JSON.stringify({ type: 'send_flush', flush_id: ++flush }));
                }
                break;
            case 'flushed': {
                attendFlush = false;
                const phrase = texte;
                texte = '';
                if (phrase) e.surPhrase(phrase);
                break;
            }
            case 'error':
                e.erreur(m.message ?? 'Gradium n\'a pas pu écouter.');
                break;
        }
    });
    ws.addEventListener('error', () => e.erreur('La connexion à Gradium a échoué.'));

    return {
        ouvrir: (oui) => {
            ouverte = oui;
            // Ce qui s'est dit pendant que Hone parlait ne compte pas.
            if (oui) texte = '';
        },
        fermer: () => {
            ouverte = false;
            processeur.disconnect();
            source.disconnect();
            void audio.close();
            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'end_of_stream' }));
            ws.close();
        },
    };
}

export interface Parole {
    /** La voix de Hone, lue image par image (pour la lumière). */
    niveau: LireNiveau;
    /** Se résout quand tout est dit, ou coupé. */
    fin: Promise<void>;
    couper(): void;
}

/** Le TTS : dit `texte` avec la voix d'Apolline, morceau par morceau dès qu'ils arrivent. */
export function dire(texte: string, token: string, erreur: (message: string) => void): Parole {
    const ws = socket('speech/tts', token);
    const audio = new AudioContext({ sampleRate: TAUX_VOIX });
    const analyseur = audio.createAnalyser();
    analyseur.fftSize = 1024;
    analyseur.smoothingTimeConstant = LISSAGE;
    analyseur.connect(audio.destination);
    const spectre = new Uint8Array(analyseur.frequencyBinCount);
    const hzParCase = TAUX_VOIX / analyseur.fftSize;

    const sources: AudioBufferSourceNode[] = [];
    let debutSuivant = 0;
    let recu = false;
    let finie = false;
    let terminer = (): void => {};
    const fin = new Promise<void>((r) => { terminer = r; });
    const clore = (): void => {
        if (finie) return;
        finie = true;
        ws.close();
        void audio.close();
        terminer();
    };
    /** Tout est reçu : on finit quand le dernier morceau a fini de jouer. */
    const finirApresLecture = (): void => {
        const reste = Math.max(0, debutSuivant - audio.currentTime);
        window.setTimeout(clore, reste * 1000 + 50);
    };

    ws.addEventListener('open', () => {
        ws.send(JSON.stringify({ type: 'setup', voice_id: VOIX, model_name: 'default', output_format: 'pcm' }));
    });
    ws.addEventListener('message', (ev) => {
        const m = JSON.parse(String(ev.data)) as { type: string; audio?: string; message?: string };
        switch (m.type) {
            case 'ready':
                ws.send(JSON.stringify({ type: 'text', text: texte }));
                ws.send(JSON.stringify({ type: 'end_of_stream' }));
                break;
            case 'audio': {
                if (finie || !m.audio) break;
                recu = true;
                const echantillons = base64Pcm16(m.audio);
                const tampon = audio.createBuffer(1, echantillons.length, TAUX_VOIX);
                tampon.copyToChannel(echantillons, 0);
                const s = audio.createBufferSource();
                s.buffer = tampon;
                s.connect(analyseur);
                debutSuivant = Math.max(debutSuivant, audio.currentTime + 0.05);
                s.start(debutSuivant);
                debutSuivant += tampon.duration;
                sources.push(s);
                break;
            }
            case 'end_of_stream':
                finirApresLecture();
                break;
            case 'error':
                erreur(m.message ?? 'Gradium n\'a pas pu parler.');
                clore();
                break;
        }
    });
    ws.addEventListener('error', () => {
        erreur('La connexion à Gradium a échoué.');
        clore();
    });
    ws.addEventListener('close', () => { if (!recu) clore(); });

    return {
        niveau: () => {
            if (finie) return 0;
            analyseur.getByteFrequencyData(spectre);
            return niveauVoix(niveaux(spectre, hzParCase));
        },
        fin,
        couper: () => {
            for (const s of sources) {
                try { s.stop(); } catch { /* pas encore partie */ }
            }
            clore();
        },
    };
}
