import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import { cp, mkdtemp, mkdir, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

/**
 * La bulle et un outil de la barre passent par Codex (compte ChatGPT, pas de clé API),
 * dans l'app installée (/Applications/Fragment.app) sur une copie complète de
 * fragment-notes. Appelle le vrai binaire codex : plus aucun « factice ».
 *
 * À copier dans Fragment-main/app/e2e/ sous le nom hone-bulle-codex.spec.ts :
 *     npx playwright test e2e/hone-bulle-codex.spec.ts --workers=1
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

async function fenetreApp(electronApp: ElectronApplication): Promise<Page> {
    const fin = Date.now() + 30_000;
    while (Date.now() < fin) {
        for (const w of electronApp.windows()) if (!w.url().startsWith('devtools')) return w;
        await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error('fenêtre app introuvable');
}

async function lancer(): Promise<Harnais> {
    const base = await mkdtemp(path.join(os.tmpdir(), 'hone-bulle-'));
    const vault = path.join(base, 'vault');
    const userData = path.join(base, 'userdata');
    await mkdir(userData, { recursive: true });
    await cp('/Users/philippinebiojout/Documents/IA/fragment-notes', vault, { recursive: true,
        filter: (src) => !src.includes('node_modules') && !src.includes('/.git') });
    await writeFile(path.join(vault, NOTE), CONTENU, 'utf8');
    await writeFile(path.join(userData, 'config.json'), JSON.stringify({ vaultRoot: vault }), 'utf8');
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
const bulle = (page: Page) => page.locator('.agent-bulle');
const carte = (page: Page) => page.locator('.agent-action-carte');

// Copier tout le coffre et lancer l'app prend plus que les 30 s par défaut ; Codex aussi.
test.describe.configure({ timeout: 240_000 });

let h: Harnais;
test.beforeEach(async () => { h = await lancer(); });
test.afterEach(async () => { await h?.electronApp.close(); });

test('la bulle répond par Codex, sur le passage sélectionné', async () => {
    const { page } = h;
    await selectionner(page, 'Ligne 2', 'la photosynthèse transforme la lumière en énergie chimique');
    await expect(barre(page)).toBeVisible();
    await page.click('.agent-barre [aria-label="Discuter avec Hone"]');
    await expect(bulle(page)).toBeVisible();

    await bulle(page).locator('.agent-bulle-champ').fill('Quel est le mot principal du passage sélectionné ? Réponds par ce seul mot.');
    await bulle(page).locator('.agent-bulle-champ').press('Enter');
    const reponse = bulle(page).locator('.agent-message.mod-agent').last();
    await expect(reponse).not.toHaveClass(/is-pending/, { timeout: 120_000 });
    await expect(reponse).not.toHaveClass(/is-error/);
    await expect(reponse).not.toContainText('factice');
    // Codex n'a que le texte recopié dans la demande pour savoir ce qui est entouré.
    await expect(reponse).toContainText(/photosynth/i);
    await page.screenshot({ path: 'test-results/hone-bulle-codex.png' });

    // Deuxième question : la conversation voyage avec elle.
    await bulle(page).locator('.agent-bulle-champ').fill('Répète exactement le mot que tu viens de donner.');
    await bulle(page).locator('.agent-bulle-champ').press('Enter');
    const suite = bulle(page).locator('.agent-message.mod-agent').last();
    await expect(suite).not.toHaveClass(/is-pending/, { timeout: 120_000 });
    await expect(suite).toContainText(/photosynth/i);
});

test('Traduire traduit le passage entouré, par Codex', async () => {
    const { page } = h;
    await selectionner(page, 'Ligne 4', 'la Révolution française commence en 1789');
    await expect(barre(page)).toBeVisible();
    await barre(page).locator('[aria-label="Plus d\'outils"]').click();
    await barre(page).locator('[aria-label="Traduire"]').click();
    await expect(carte(page)).toBeVisible({ timeout: 10_000 });
    const corps = carte(page).locator('.agent-action-corps');
    await expect(corps).toContainText(/Revolution/i, { timeout: 120_000 });
    await expect(corps).toContainText('1789');
    await expect(corps).not.toContainText('factice');
    console.log('TRADUCTION', await corps.textContent());
    await page.waitForTimeout(600); // la fin de l'éclosion de la carte, pour la capture
    await page.screenshot({ path: 'test-results/hone-traduire-codex.png' });
});
