import { test, expect, type Page } from '@playwright/test';
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { barre, lancerInstallee, selectionnerInstallee, voix, type Harnais } from './hone-commun';

/**
 * La discussion orale de bout en bout, dans l'app installée (/Applications/Fragment.app) sur
 * une copie complète de fragment-notes : le micro joue une question dite par la voix Thomas
 * de macOS, whisper.cpp la transcrit sur la machine, Hone répond par Codex (compte ChatGPT).
 * Il faut whisper.cpp, ffmpeg et ~/.hone/whisper/ggml-small.bin.
 *
 * Le micro : `getUserMedia` rend la question décodée dans la page. Le faux micro de Chromium
 * (--use-file-for-fake-audio-capture) ne joue que du silence dans Electron.
 */

/** La question, dite par la voix Thomas de macOS, en WAV 48 kHz (base64). */
function question(): string {
    const dossier = mkdtempSync(path.join(os.tmpdir(), 'hone-question-'));
    const brut = path.join(dossier, 'question.aiff');
    const wav = path.join(dossier, 'question.wav');
    execFileSync('/usr/bin/say', ['-v', 'Thomas', '-o', brut, 'Bonjour. Qui es-tu, et comment tu t\'appelles ?']);
    execFileSync('/opt/homebrew/bin/ffmpeg', ['-loglevel', 'error', '-y', '-i', brut, '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', wav]);
    return readFileSync(wav).toString('base64');
}
const questionB64 = question();

const message = (page: Page) => voix(page).locator('.agent-voix-message');

test.describe.configure({ timeout: 240_000 });

let h: Harnais;
test.beforeEach(async () => {
    h = await lancerInstallee({
        chemin: 'note-codex.md', ligne: 'Ligne 2',
        contenu: '# Test de la voix\n\nLigne 2 : la photosynthèse transforme la lumière en énergie chimique.',
    });
});
test.afterEach(async () => { await h?.electronApp.close(); });

test('le micro part à Hone : transcrit sur la machine, réponse par Codex, et il se présente comme Hone', async () => {
    const { page } = h;
    // Le micro joue la question, une fois ; ce que la synthèse dit est gardé, et la vraie voix parle.
    await page.evaluate((b64) => {
        const w = window as unknown as { __dits: string[] };
        w.__dits = [];
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
    }, questionB64);
    await selectionnerInstallee(page, 'Ligne 2', 'la photosynthèse transforme la lumière en énergie chimique');
    await expect(barre(page)).toBeVisible();
    await barre(page).locator('[aria-label="Parler à Hone"]').click();
    await expect(voix(page)).toHaveAttribute('data-etat', 'ecoute', { timeout: 10_000 });
    await page.waitForTimeout(4_500); // la question dure trois secondes
    await voix(page).locator('.agent-voix-stop').click();
    await expect(voix(page)).toHaveAttribute('data-etat', 'reflechit');
    await expect(voix(page)).toHaveAttribute('data-etat', 'repond', { timeout: 120_000 });

    const reponse = (await message(page).textContent()) ?? '';
    console.log('REPONSE ORALE', reponse);
    expect(reponse).not.toMatch(/factice|n'a pas pu/i);
    expect(reponse).toContain('Hone');
    expect(reponse).not.toMatch(/Codex|ChatGPT/);
    const dits = await page.evaluate(() => (window as unknown as { __dits: string[] }).__dits);
    expect(dits).toEqual([reponse]);
    await page.screenshot({ path: 'test-results/hone-voix-codex.png' });

    // La croix : le bilan de la discussion, par Codex, reprend la transcription.
    await voix(page).locator('.agent-voix-fermer').click();
    await expect(voix(page)).toHaveCount(0);
});
