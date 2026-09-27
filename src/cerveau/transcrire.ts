import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { ErreurAgent } from './moteur';

// L'oreille de la discussion orale. Le compte ChatGPT n'a aucun modèle qui écoute (Codex
// ne prend que texte et images, et sa voix en direct exige une clé API) : le micro est
// donc transcrit ici, sur la machine, par whisper.cpp, puis la question part à Hone en
// texte comme celles du chat. Rien ne quitte la machine avant d'être du texte.
//
// Installation : `brew install whisper.cpp ffmpeg`, et le modèle dans ~/.hone/whisper/
// (ggml-small.bin, sur huggingface.co/ggerganov/whisper.cpp). Lancée depuis le Finder,
// l'app n'a pas Homebrew dans son PATH : on cherche les binaires par leur chemin.

const DOSSIERS = ['/opt/homebrew/bin', '/usr/local/bin'];
const MODELE = join(homedir(), '.hone', 'whisper', 'ggml-small.bin');
const DELAI = 60_000;

function binaire(nom: string): string {
    const trouve = DOSSIERS.map((d) => join(d, nom)).find((c) => existsSync(c));
    if (!trouve) throw new ErreurAgent(`Micro pas branché : ${nom} introuvable (brew install whisper.cpp ffmpeg).`);
    return trouve;
}

function lancer(fichier: string, args: string[]): Promise<string> {
    return new Promise((resoudre, rejeter) => {
        execFile(fichier, args, { timeout: DELAI, maxBuffer: 4 * 1024 * 1024 }, (err, sortie) => {
            if (err) rejeter(err);
            else resoudre(String(sortie));
        });
    });
}

/** Ce qui a été dit dans l'enregistrement du micro (webm/opus de MediaRecorder), en français. */
export async function transcrire(audio: Blob): Promise<string> {
    if (!existsSync(MODELE)) throw new ErreurAgent(`Micro pas branché : modèle Whisper absent (${MODELE}).`);
    const ffmpeg = binaire('ffmpeg');
    const whisper = binaire('whisper-cli');
    const dossier = await mkdtemp(join(tmpdir(), 'hone-voix-'));
    try {
        const brut = join(dossier, 'micro.webm');
        const wav = join(dossier, 'micro.wav');
        await writeFile(brut, Buffer.from(await audio.arrayBuffer()));
        // Whisper lit du WAV 16 kHz mono, pas l'opus du navigateur.
        await lancer(ffmpeg, ['-loglevel', 'error', '-y', '-i', brut, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav]);
        const texte = (await lancer(whisper, ['-m', MODELE, '-l', 'fr', '-nt', '-np', '-f', wav])).replace(/\s+/g, ' ').trim();
        // Sur du silence, Whisper écrit « ... » ou « [Musique] » : sans un mot hors crochets, rien n'a été dit.
        return /\p{L}/u.test(texte.replace(/\[[^\]]*\]|\([^)]*\)/g, '')) ? texte : '';
    } finally {
        void rm(dossier, { recursive: true, force: true });
    }
}
