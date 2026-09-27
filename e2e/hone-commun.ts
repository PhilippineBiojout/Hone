import { expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import { cp, mkdtemp, mkdir, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

/**
 * Ce que les specs e2e de Hone partagent : lancer Fragment, et les gestes sur la note.
 *
 * Se lance depuis Fragment, qui porte Playwright : copier ce fichier ET les specs dans
 * `Fragment-main/app/e2e/` (préfixe `hone-`, ce fichier garde son nom), `npm run build`
 * dans le plugin, puis depuis `Fragment-main/app/` :
 *     npx playwright test e2e/hone-agent-voix.spec.ts --workers=1
 *
 * Deux façons de lancer :
 * - `lancer()` : l'app de dev (`Fragment-main`), un coffre neuf avec une note et le plugin
 *   copié, en factice : rien de réel n'est appelé ;
 * - `lancerInstallee()` : /Applications/Fragment.app sur une copie complète de fragment-notes,
 *   avec le vrai Codex.
 */

export const PLUGIN = process.env.HONE_PLUGIN ?? '/Users/philippinebiojout/Documents/IA/fragment-notes/.fragment/plugins/hone';
const COFFRE = '/Users/philippinebiojout/Documents/IA/fragment-notes';

export const LIGNES = Array.from({ length: 200 }, (_, i) =>
    i === 0 ? '# Document de test pour l\'agent' : `Ligne ${i} : la Révolution française commence en 1789.`,
).join('\n');

export interface Harnais {
    electronApp: ElectronApplication;
    page: Page;
    vault: string;
}

type Fenetre = Window & { app: any };

async function fenetreApp(electronApp: ElectronApplication, estLaBonne: (url: string) => boolean): Promise<Page> {
    const fin = Date.now() + 30_000;
    while (Date.now() < fin) {
        for (const w of electronApp.windows()) if (estLaBonne(w.url())) return w;
        await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error('fenêtre app introuvable');
}

export interface OptionsDev {
    /** Le texte de `note.md`. */
    note?: string;
    /** Le `data.json` du plugin ; `factice: true` d'office. */
    donnees?: Record<string, unknown>;
    /** Faux : on n'attend pas l'éditeur et on n'arme pas l'annotation (l'atelier attend sa commande). */
    editeur?: boolean;
}

/** L'app de dev sur un coffre neuf : `note.md`, le plugin copié, en factice. */
export async function lancer(o: OptionsDev = {}): Promise<Harnais> {
    const base = await mkdtemp(path.join(os.tmpdir(), 'hone-e2e-'));
    const vault = path.join(base, 'vault');
    const userData = path.join(base, 'userdata');
    const plugin = path.join(vault, '.fragment/plugins/hone');
    await mkdir(vault, { recursive: true });
    await mkdir(userData, { recursive: true });
    await writeFile(path.join(vault, 'note.md'), o.note ?? LIGNES, 'utf8');
    // Ni node_modules, ni les vraies données du plugin : la mémoire et les réglages restent chez elle.
    await cp(PLUGIN, plugin, { recursive: true,
        filter: (src) => !src.includes('node_modules') && !/[\\/](data\.json|memoire\.jsonl|\.env|couts\.jsonl)$/.test(src) });
    await writeFile(path.join(plugin, 'data.json'), JSON.stringify({ factice: true, ...o.donnees }), 'utf8');
    // Le cœur ne charge aucun plugin d'un coffre sans community-plugins.json (mode restreint).
    await writeFile(path.join(vault, '.fragment/community-plugins.json'), JSON.stringify(['hone']), 'utf8');
    await writeFile(path.join(userData, 'config.json'), JSON.stringify({ vaultRoot: vault }), 'utf8');

    const electronApp = await _electron.launch({
        args: ['.', `--user-data-dir=${userData}`],
        env: { ...process.env, NODE_ENV: 'development' } as Record<string, string>,
    });
    const page = await fenetreApp(electronApp, (url) => url.includes('localhost:5123'));
    if (o.editeur === false) return { electronApp, page, vault };

    await page.waitForFunction(() => {
        const leaves = (window as unknown as Fenetre).app?.workspace?.getLeavesOfType?.('markdown') ?? [];
        return leaves.length > 0 && !!leaves[0].view?.editor;
    }, undefined, { timeout: 30_000 });
    // Assez large pour la colonne, la barre et le chat côte à côte.
    await page.setViewportSize({ width: 1400, height: 800 });
    // Le calque d'annotation est désactivé d'office : on l'arme.
    await page.evaluate(() => (window as unknown as Fenetre).app.workspace.getLeavesOfType('markdown')[0].view.toggleLayer('annotation'));
    await page.waitForSelector('.annotation-surface', { state: 'attached' });
    return { electronApp, page, vault };
}

/** L'app installée sur une copie complète de fragment-notes, avec le vrai Codex ; `note` y est ajoutée et ouverte. */
export async function lancerInstallee(note?: { chemin: string; contenu: string; ligne: string }): Promise<Harnais> {
    const base = await mkdtemp(path.join(os.tmpdir(), 'hone-installee-'));
    const vault = path.join(base, 'vault');
    const userData = path.join(base, 'userdata');
    await mkdir(userData, { recursive: true });
    await cp(COFFRE, vault, { recursive: true, filter: (src) => !src.includes('node_modules') && !src.includes('/.git') });
    if (note) await writeFile(path.join(vault, note.chemin), note.contenu, 'utf8');
    await writeFile(path.join(userData, 'config.json'), JSON.stringify({ vaultRoot: vault }), 'utf8');
    const electronApp = await _electron.launch({
        executablePath: '/Applications/Fragment.app/Contents/MacOS/Fragment',
        args: [`--user-data-dir=${userData}`, `--vault-root=${vault}`],
        env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: process.env.HOME! } as Record<string, string>,
    });
    const page = await fenetreApp(electronApp, (url) => !url.startsWith('devtools'));
    await page.waitForFunction(() => !!(window as unknown as Fenetre).app?.workspace, undefined, { timeout: 30_000 });
    await page.setViewportSize({ width: 1400, height: 800 });
    // Hone branche Codex en fin de onload : sa commande dit que le plugin est prêt.
    await page.waitForFunction(() => !!(window as unknown as Fenetre).app.commands.findCommand('hone:open-codex-panel'), undefined, { timeout: 30_000 });
    if (note) {
        await page.waitForFunction((c) => !!(window as unknown as Fenetre).app.vault.getFileByPath(c), note.chemin, { timeout: 30_000 });
        await page.evaluate((c) => {
            const app = (window as unknown as Fenetre).app;
            return app.workspace.getLeaf('tab').openFile(app.vault.getFileByPath(c));
        }, note.chemin);
        await page.locator('.cm-line:visible', { hasText: note.ligne }).first().waitFor();
    }
    return { electronApp, page, vault };
}

// ═══ Les gestes ═══════════════════════════════════════════════════════════════

/** Le rectangle client de la première ligne rendue qui contient `texte`. */
export async function ligne(page: Page, texte: string) {
    const box = await page.locator('.cm-line', { hasText: texte }).first().boundingBox();
    if (!box) throw new Error(`ligne introuvable : ${texte}`);
    return box;
}

/** La boîte client d'un morceau de texte d'une ligne visible, mesurée par un Range DOM. */
export async function boiteDuMot(page: Page, ligneTexte: string, mot: string) {
    return page.evaluate(({ ligneTexte, mot }) => {
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
            const b = r.getBoundingClientRect();
            return { x: b.left, y: b.top, width: b.width, height: b.height };
        }
        throw new Error(`mot introuvable : ${mot}`);
    }, { ligneTexte, mot });
}

export async function armer(page: Page, outil: 'Crayon' | 'Surligneur'): Promise<void> {
    const item = page.locator(`.toolbar-item[aria-label="${outil}"]`);
    // Cliquer un outil déjà armé le désarme : on ne clique que s'il ne l'est pas.
    if (!(await item.evaluate((el) => el.classList.contains('is-active')))) await item.click();
}

/** Aucun outil d'annotation armé : le curseur de base. */
export async function desarmer(page: Page): Promise<void> {
    for (const outil of ['Crayon', 'Surligneur', 'Gomme']) {
        const item = page.locator(`.toolbar-item[aria-label="${outil}"]`);
        if (await item.count() && await item.first().evaluate((el) => el.classList.contains('is-active'))) await item.first().click();
    }
}

export async function trace(page: Page, points: { x: number; y: number }[]): Promise<void> {
    await page.mouse.move(points[0].x, points[0].y);
    await page.mouse.down();
    for (const p of points.slice(1)) await page.mouse.move(p.x, p.y);
    await page.mouse.up();
}

/** Surligne un mot d'une ligne, d'un bord à l'autre. */
export async function surligner(page: Page, ligneTexte: string, mot: string): Promise<void> {
    await armer(page, 'Surligneur');
    const b = await boiteDuMot(page, ligneTexte, mot);
    const y = b.y + b.height / 2;
    await trace(page, Array.from({ length: 8 }, (_, i) => ({ x: b.x + 2 + ((b.width - 4) * i) / 7, y })));
}

/** Entoure un mot d'une ellipse au crayon. */
export async function entourer(page: Page, ligneTexte: string, mot: string): Promise<void> {
    await armer(page, 'Crayon');
    const b = await boiteDuMot(page, ligneTexte, mot);
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    const pts = [];
    for (let a = 0; a <= Math.PI * 2 - 0.25; a += 0.2) pts.push({ x: cx + (b.width / 2 + 5) * Math.cos(a), y: cy + (b.height / 2 + 6) * Math.sin(a) });
    await trace(page, pts);
}

/** Glisse la souris d'un bord à l'autre d'un mot, comme pour le copier. */
export async function selectionner(page: Page, ligneTexte: string, mot: string): Promise<void> {
    await desarmer(page);
    const b = await boiteDuMot(page, ligneTexte, mot);
    const y = b.y + b.height / 2;
    await page.mouse.move(b.x + 1, y);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, y, { steps: 3 });
    await page.mouse.move(b.x + b.width - 1, y, { steps: 3 });
    await page.mouse.up();
}

/** Dans l'app installée, les coordonnées brutes de page.mouse ne sélectionnent rien ; les clics
 *  de locator, si : clic au début, puis Maj-clic à la fin (le pointerup déclenche la barre). */
export async function selectionnerInstallee(page: Page, ligneTexte: string, mot: string): Promise<void> {
    await desarmer(page);
    const b = await boiteDuMot(page, ligneTexte, mot);
    const l = page.locator('.cm-line:visible', { hasText: ligneTexte }).first();
    const box = (await l.boundingBox())!;
    const y = b.y + b.height / 2 - box.y;
    await l.click({ position: { x: b.x - box.x + 1, y } });
    await l.click({ position: { x: b.x + b.width - box.x - 1, y }, modifiers: ['Shift'] });
}

/** Tire de (x0, y0) de (dx, dy), en plusieurs pas. */
export async function tirer(page: Page, x0: number, y0: number, dx: number, dy: number): Promise<void> {
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move(x0 + dx / 2, y0 + dy / 2, { steps: 3 });
    await page.mouse.move(x0 + dx, y0 + dy, { steps: 3 });
    await page.mouse.up();
}

/** Traîne la barre d'annotation par sa poignée, son coin haut gauche en (x, y). */
export async function deplacerBarreAnnotation(page: Page, x: number, y: number): Promise<void> {
    const tb = (await page.locator('.toolbar').first().boundingBox())!;
    const poignee = (await page.locator('.toolbar .toolbar-handle').first().boundingBox())!;
    const px = poignee.x + poignee.width / 2;
    const py = poignee.y + poignee.height / 2;
    await page.mouse.move(px, py);
    await page.mouse.down();
    await page.mouse.move(px + 10, py + 10, { steps: 2 });
    await page.mouse.move(x + (px - tb.x), y + (py - tb.y), { steps: 4 });
    await page.mouse.up();
}

// ═══ Ce qu'on regarde ═════════════════════════════════════════════════════════

export const barre = (page: Page) => page.locator('.agent-barre');
export const plus = (page: Page) => page.locator('.agent-barre [aria-label="Plus d\'outils"]');
export const bulle = (page: Page) => page.locator('.agent-bulle');
export const carte = (page: Page) => page.locator('.agent-action-carte');
export const voix = (page: Page) => page.locator('.agent-voix');
export const traces = (page: Page) => page.locator('.agent-trace');
/** Les icônes à l'écran : celle dont la réponse est rouverte garde sa place, invisible. */
export const tracesVisibles = (page: Page) => page.locator('.agent-trace:not(.is-ouverte)');

export const nbTraits = (page: Page) => page.evaluate(() =>
    (window as unknown as Fenetre).app.plugins.plugins.get('annotation').source.strokes('note.md').length as number);

/** Le texte que l'agent a compris du trait : celui sous le surlignage de zone. */
export async function texteCompris(page: Page): Promise<string> {
    return page.evaluate(() => {
        const ed = (window as unknown as Fenetre).app.workspace.getLeavesOfType('markdown')[0].view.editor;
        const z = document.querySelector('.agent-zone')?.getBoundingClientRect();
        if (!z) return '';
        const from = ed.posAtCoords(z.left + 1, z.top + z.height / 2);
        const to = ed.posAtCoords(z.right - 1, z.top + z.height / 2);
        return ed.cm.state.doc.sliceString(from, to);
    });
}

/** Le bord gauche de la colonne de texte, en coordonnées client. */
export async function bordGaucheTexte(page: Page): Promise<number> {
    return page.evaluate(() =>
        (window as unknown as Fenetre).app.workspace.getLeavesOfType('markdown')[0].view.editor.contentEl.getBoundingClientRect().left);
}

/** L'aire commune de deux boîtes, 0 si elles ne se touchent pas. */
export function aire(a: { x: number; y: number; width: number; height: number }, b: typeof a): number {
    const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    return w > 0 && h > 0 ? w * h : 0;
}

// ═══ Les pièces de Hone ═══════════════════════════════════════════════════════

export async function ouvrirChat(page: Page): Promise<void> {
    await page.click('.agent-barre [aria-label="Discuter avec Hone"]');
    await expect(bulle(page)).toBeVisible();
}

/** Lance un outil de la barre et attend que sa carte soit posée (fin de l'éclosion). */
export async function carteOuverte(page: Page, libelle = 'Traduire'): Promise<void> {
    if (!['Définir', 'Visualiser'].includes(libelle)) await plus(page).click();
    await barre(page).locator(`[aria-label="${libelle}"]`).click();
    await expect(carte(page)).toBeVisible({ timeout: 4_000 });
    await expect.poll(() => carte(page).evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    await page.waitForTimeout(300);
}

/** Lance un outil de la barre, attend sa carte et la ferme ; rend le texte de la réponse. */
export async function outilPuisFermer(page: Page, libelle: string): Promise<string> {
    if (!['Définir', 'Visualiser'].includes(libelle)) await plus(page).click();
    await barre(page).locator(`[aria-label="${libelle}"]`).click();
    await expect(carte(page)).toBeVisible({ timeout: 4_000 });
    const texte = (await carte(page).locator('.agent-action-corps').textContent()) ?? '';
    await carte(page).locator('[aria-label="Fermer"]').click();
    await expect(carte(page)).toHaveCount(0);
    return texte;
}
