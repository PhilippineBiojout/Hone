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

test('le micro part à Hone : Gradium entend, Codex répond, Gradium le dit, et il se présente comme Hone', async () => {
    const { page } = h;
    // Le micro joue la question, une fois. La synthèse du système est espionnée : elle ne doit pas servir.
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
    await expect(voix(page)).toHaveAttribute('data-etat', 'ecoute', { timeout: 15_000 });
    // Personne ne clique : Gradium repère seul la fin de la question (trois secondes, puis le silence).
    await expect(voix(page)).toHaveAttribute('data-etat', 'reflechit', { timeout: 15_000 });
    await expect(voix(page)).toHaveAttribute('data-etat', 'repond', { timeout: 120_000 });

    const reponse = (await message(page).textContent()) ?? '';
    console.log('REPONSE ORALE', reponse);
    expect(reponse).not.toMatch(/factice|n'a pas pu/i);
    expect(reponse).toContain('Hone');
    expect(reponse).not.toMatch(/Codex|ChatGPT/);
    // C'est la voix de Gradium qui parle, pas celle du système.
    expect(await page.evaluate(() => (window as unknown as { __dits: string[] }).__dits)).toEqual([]);
    await page.screenshot({ path: 'test-results/hone-voix-gradium.png' });

    // Elle se tait d'elle-même, et la barre écoute de nouveau ; la croix raccroche.
    await expect(voix(page)).toHaveAttribute('data-etat', 'ecoute', { timeout: 60_000 });
    await voix(page).locator('.agent-voix-fermer').click();
    await expect(voix(page)).toHaveCount(0);
});
