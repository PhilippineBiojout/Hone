import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import { execFileSync } from 'child_process';
import { cp, mkdtemp, mkdir, readFile, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

/**
 * La discussion orale de bout en bout, dans l'app installée (/Applications/Fragment.app) sur
 * une copie complète de fragment-notes : le micro joue une question dite par la voix Thomas
 * de macOS, whisper.cpp la transcrit sur la machine, Hone répond par Codex (compte ChatGPT).
 * Il faut whisper.cpp, ffmpeg et ~/.hone/whisper/ggml-small.bin.
 *
 * Le micro : `getUserMedia` rend la question décodée dans la page. Le faux micro de Chromium
 * (--use-file-for-fake-audio-capture) ne joue que du silence dans Electron.
 *
 * À copier dans Fragment-main/app/e2e/ sous le nom hone-voix-codex.spec.ts :
 *     npx playwright test e2e/hone-voix-codex.spec.ts --workers=1
 */

const NOTE = 'note-codex.md';
const CONTENU = [
    '# Test de la bulle Codex',
    '',
    'Ligne 2 : la photosynthèse transforme la lumière en énergie chimique.',
    '',
    'Ligne 4 : la Révolution française commence en 1789.',
].join('\n');

interface Harnais { electronApp: ElectronApplication; page: Page }

let questionB64 = '';

async function fenetreApp(electronApp: ElectronApplication): Promise<Page> {
    const fin = Date.now() + 30_000;
    while (Date.now() < fin) {
        for (const w of electronApp.windows()) if (!w.url().startsWith('devtools')) return w;
        await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error('fenêtre app introuvable');
}

async function lancer(): Promise<Harnais> {
    const base = await mkdtemp(path.join(os.tmpdir(), 'hone-voix-'));
    const vault = path.join(base, 'vault');
    const userData = path.join(base, 'userdata');
    await mkdir(userData, { recursive: true });
    await cp('/Users/philippinebiojout/Documents/IA/fragment-notes', vault, { recursive: true,
        filter: (src) => !src.includes('node_modules') && !src.includes('/.git') });
    await writeFile(path.join(vault, NOTE), CONTENU, 'utf8');
    await writeFile(path.join(userData, 'config.json'), JSON.stringify({ vaultRoot: vault }), 'utf8');
    // La question, dite une fois puis du silence : le faux micro de Chromium boucle sur son fichier.
    const brut = path.join(base, 'question.aiff');
    const question = path.join(base, 'question.wav');
    execFileSync('/usr/bin/say', ['-v', 'Thomas', '-o', brut, 'Bonjour. Qui es-tu, et comment tu t\'appelles ?']);
    execFileSync('/opt/homebrew/bin/ffmpeg', ['-loglevel', 'error', '-y', '-i', brut, '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', question]);
    questionB64 = (await readFile(question)).toString('base64');
    const electronApp = await _electron.launch({
        executablePath: '/Applications/Fragment.app/Contents/MacOS/Fragment',
        args: [`--user-data-dir=${userData}`, `--vault-root=${vault}`],
        env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: process.env.HOME! } as Record<string, string>,
    });
    const page = await fenetreApp(electronApp);
    await page.waitForFunction(() => !!(window as any).app?.workspace, undefined, { timeout: 30_000 });
    await page.setViewportSize({ width: 1400, height: 800 });
    await page.waitForFunction(() => !!(window as any).app.commands.findCommand('hone:open-codex-panel'), undefined, { timeout: 30_000 });
    await page.waitForFunction((note) => !!(window as any).app.vault.getFileByPath(note), NOTE, { timeout: 30_000 });
    await page.evaluate((note) => {
        const app = (window as any).app;
        return app.workspace.getLeaf('tab').openFile(app.vault.getFileByPath(note));
    }, NOTE);
    await page.locator('.cm-line:visible', { hasText: 'Ligne 2' }).first().waitFor();
    return { electronApp, page };
}

async function desarmer(page: Page): Promise<void> {
    for (const outil of ['Crayon', 'Surligneur', 'Gomme']) {
        const item = page.locator(`.toolbar-item[aria-label="${outil}"]`);
        if (await item.count() && await item.first().evaluate((el) => el.classList.contains('is-active'))) await item.first().click();
    }
}

/** Glisse la souris d'un bord à l'autre d'un morceau de ligne. */
async function selectionner(page: Page, ligneTexte: string, mot: string): Promise<void> {
    await desarmer(page);
    const b = await page.evaluate(({ ligneTexte, mot }) => {
        // Le coffre copié a d'autres onglets : on ne cherche que dans les lignes visibles.
        const el = [...document.querySelectorAll('.cm-line')]
            .find((l) => l.textContent?.includes(ligneTexte) && (l as HTMLElement).getBoundingClientRect().width > 0)!;
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            const i = n.textContent!.indexOf(mot);
            if (i < 0) continue;
            const r = document.createRange();
            r.setStart(n, i);
            r.setEnd(n, i + mot.length);
            const x = r.getBoundingClientRect();
            return { x: x.left, y: x.top, width: x.width, height: x.height };
        }
        throw new Error(`mot introuvable : ${mot}`);
    }, { ligneTexte, mot });
    // Dans l'app installée, les coordonnées brutes de page.mouse ne sélectionnent rien ;
    // les clics de locator, si : clic au début, puis Maj-clic à la fin (le pointerup déclenche la barre).
    const ligne = page.locator('.cm-line:visible', { hasText: ligneTexte }).first();
    const l = (await ligne.boundingBox())!;
    const y = b.y + b.height / 2 - l.y;
    await ligne.click({ position: { x: b.x - l.x + 1, y } });
    await ligne.click({ position: { x: b.x + b.width - l.x - 1, y }, modifiers: ['Shift'] });
}

const barre = (page: Page) => page.locator('.agent-barre');
const voix = (page: Page) => page.locator('.agent-voix');
const message = (page: Page) => voix(page).locator('.agent-voix-message');

// Copier tout le coffre et lancer l'app prend plus que les 30 s par défaut ; Codex aussi.
test.describe.configure({ timeout: 240_000 });

let h: Harnais;
test.beforeEach(async () => { h = await lancer(); });
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
    await selectionner(page, 'Ligne 2', 'la photosynthèse transforme la lumière en énergie chimique');
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
