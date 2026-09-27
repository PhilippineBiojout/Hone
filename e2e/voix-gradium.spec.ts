import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'child_process';
import { existsSync, mkdtempSync, readFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { barre, PLUGIN, lancerInstallee, selectionnerInstallee, voix, type Harnais } from './hone-commun';

/**
 * La discussion orale de bout en bout, dans l'app installée (/Applications/Fragment.app) sur
 * une copie complète de fragment-notes : le micro joue une question dite par la voix Thomas
 * de macOS, Gradium l'entend, Hone répond par Codex (compte ChatGPT) et Gradium le dit.
 * La clé Gradium est celle du coffre (« Hone : clé Gradium… ») ; sans elle, le test est sauté.
 *
 * Le micro : `getUserMedia` rend la question décodée dans la page. Le faux micro de Chromium
 * (--use-file-for-fake-audio-capture) ne joue que du silence dans Electron.
 */

/** Une question dite par une voix de macOS, en WAV 48 kHz (base64). */
function question(voixMac: string, texte: string): string {
    const dossier = mkdtempSync(path.join(os.tmpdir(), 'hone-question-'));
    const brut = path.join(dossier, 'question.aiff');
    const wav = path.join(dossier, 'question.wav');
    execFileSync('/usr/bin/say', ['-v', voixMac, '-o', brut, texte]);
    execFileSync('/opt/homebrew/bin/ffmpeg', ['-loglevel', 'error', '-y', '-i', brut, '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', wav]);
    return readFileSync(wav).toString('base64');
}

/** La question, la voix Gradium attendue (gradium.ts, VOIX), et un mot qui dit la langue de la réponse. */
const CAS = [
    { langue: 'français', b64: question('Thomas', 'Bonjour. Qui es-tu, et comment tu t\'appelles ?'), voix: '6oIkS98REoVZ1dEw', mot: /je|suis|t'aide/i },
    { langue: 'anglais', b64: question('Samantha', 'Hello. Who are you, and what is your name?'), voix: '4SZHfMpw-p46Ywgs', mot: /\b(I|I'm|your|you)\b/ },
];

const message = (page: Page) => voix(page).locator('.agent-voix-message');

test.describe.configure({ timeout: 240_000 });

const donnees = path.join(PLUGIN, 'data.json');
const cle = existsSync(donnees) ? (JSON.parse(readFileSync(donnees, 'utf8')) as { gradiumCle?: string }).gradiumCle : '';
test.skip(!cle, 'pas de clé Gradium dans le coffre : commande « Hone : clé Gradium… »');

let h: Harnais;
test.beforeEach(async () => {
    h = await lancerInstallee({
        chemin: 'note-codex.md', ligne: 'Ligne 2',
        contenu: '# Test de la voix\n\nLigne 2 : la photosynthèse transforme la lumière en énergie chimique.',
    });
});
test.afterEach(async () => { await h?.electronApp.close(); });

for (const cas of CAS) test(`en ${cas.langue}, le micro part à Hone : Gradium entend, Codex répond dans la même langue, la voix de cette langue le dit`, async () => {
    const { page } = h;
    // Le micro joue la question, une fois. La synthèse du système est espionnée : elle ne doit pas servir.
    await page.evaluate((b64) => {
        const w = window as unknown as { __dits: string[]; __voix: string[] };
        w.__dits = [];
        // Les voix demandées à Gradium, lues dans les messages de mise en route du TTS.
        w.__voix = [];
        const envoyer = WebSocket.prototype.send;
        WebSocket.prototype.send = function (this: WebSocket, donnee) {
            try {
                const m = JSON.parse(String(donnee)) as { type?: string; voice_id?: string };
                if (m.type === 'setup' && m.voice_id) w.__voix.push(m.voice_id);
            } catch { /* audio, pas du JSON utile */ }
            return envoyer.call(this, donnee);
        };
        navigator.mediaDevices.getUserMedia = async () => {
            const ctx = new AudioContext();
            const octets = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
            const source = ctx.createBufferSource();
            source.buffer = await ctx.decodeAudioData(octets.buffer);
            const sortie = ctx.createMediaStreamDestination();
            source.connect(sortie);
            source.start();
            return sortie.stream;
        };
        const dire = speechSynthesis.speak.bind(speechSynthesis);
        speechSynthesis.speak = (u) => { w.__dits.push(u.text); dire(u); };
    }, cas.b64);
    await selectionnerInstallee(page, 'Ligne 2', 'la photosynthèse transforme la lumière en énergie chimique');
    await expect(barre(page)).toBeVisible();
    await barre(page).locator('[aria-label="Parler à Hone"]').click();
    await expect(voix(page)).toHaveAttribute('data-etat', 'ecoute', { timeout: 15_000 });
    // Personne ne clique : Gradium repère seul la fin de la question (trois secondes, puis le silence).
    await expect(voix(page)).toHaveAttribute('data-etat', 'reflechit', { timeout: 15_000 });
    await expect(voix(page)).toHaveAttribute('data-etat', 'repond', { timeout: 120_000 });

    const reponse = (await message(page).textContent()) ?? '';
    console.log('REPONSE ORALE', reponse);
    expect(reponse).not.toMatch(/factice|n'a pas pu/i);
    expect(reponse).toContain('Hone');
    expect(reponse).not.toMatch(/Codex|ChatGPT/);
    expect(reponse).toMatch(cas.mot);
    expect(await page.evaluate(() => (window as unknown as { __voix: string[] }).__voix)).toEqual([cas.voix]);
    // C'est la voix de Gradium qui parle, pas celle du système.
    expect(await page.evaluate(() => (window as unknown as { __dits: string[] }).__dits)).toEqual([]);
    await page.screenshot({ path: `test-results/hone-voix-gradium-${cas.langue}.png` });

    // Elle se tait d'elle-même, et la barre écoute de nouveau ; la croix raccroche.
    await expect(voix(page)).toHaveAttribute('data-etat', 'ecoute', { timeout: 60_000 });
    await voix(page).locator('.agent-voix-fermer').click();
    await expect(voix(page)).toHaveCount(0);
});
