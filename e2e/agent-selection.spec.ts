import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import { cp, mkdtemp, mkdir, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';


/**
 * Le second déclencheur : surligner du texte avec le curseur de base, sans
 * outil d'annotation, fait apparaître la même barre qu'un trait.
 *
 * Se lance comme agent-widget.spec.ts, dont le harnais est recopié :
 *     npx playwright test e2e/agent-selection.spec.ts --workers=1
 */

const NB_LIGNES = 200;
const CONTENU = Array.from({ length: NB_LIGNES }, (_, i) =>
    i === 0
        ? '# Document de test pour l\'agent'
        : `Ligne ${i} : la Révolution française commence en 1789.`,
).join('\n');

interface Harnais {
    electronApp: ElectronApplication;
    page: Page;
}

async function fenetreApp(electronApp: ElectronApplication): Promise<Page> {
    const fin = Date.now() + 30_000;
    while (Date.now() < fin) {
        for (const w of electronApp.windows()) {
            if (w.url().includes('localhost:5123')) return w;
        }
        await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error('fenêtre app introuvable');
}

async function lancer(): Promise<Harnais> {
    const base = await mkdtemp(path.join(os.tmpdir(), 'prom-agent-'));
    const vault = path.join(base, 'vault');
    const userData = path.join(base, 'userdata');

    await mkdir(vault, { recursive: true });
    await mkdir(userData, { recursive: true });
    await writeFile(path.join(vault, 'note.md'), CONTENU, 'utf8');
    await cp('/Users/philippinebiojout/Documents/IA/fragment-notes/.fragment/plugins/hone', path.join(vault, '.fragment/plugins/hone'), { recursive: true, // Ni node_modules, ni le .env (la clé ne sort pas du plugin : sans lui, l'agent répond en factice), ni le journal des coûts.
        filter: (src) => !src.includes('node_modules') && !/[\\/](\.env|couts\.jsonl)$/.test(src) });
    await writeFile(path.join(userData, 'config.json'), JSON.stringify({ vaultRoot: vault }), 'utf8');

    const electronApp = await _electron.launch({
        args: ['.', `--user-data-dir=${userData}`],
        env: { ...process.env, NODE_ENV: 'development' } as Record<string, string>,
    });

    const page = await fenetreApp(electronApp);
    await page.waitForFunction(
        () => {
            const w = window as unknown as { app?: any };
            const leaves = w.app?.workspace?.getLeavesOfType?.('markdown') ?? [];
            return leaves.length > 0 && !!leaves[0].view?.editor;
        },
        undefined,
        { timeout: 30_000 },
    );
    // Assez large pour la colonne, la barre et le chat côte à côte.
    await page.setViewportSize({ width: 1400, height: 800 });

    // Le calque d'annotation est désactivé d'office : on l'arme.
    await page.evaluate(() => {
        const w = window as unknown as { app: any };
        w.app.workspace.getLeavesOfType('markdown')[0].view.toggleLayer('annotation');
    });
    await page.waitForSelector('.annotation-surface', { state: 'attached' });
    return { electronApp, page };
}

/** Le rectangle CLIENT de la première ligne rendue qui contient `texte`. */
async function ligne(page: Page, texte: string) {
    const loc = page.locator('.cm-line', { hasText: texte }).first();
    const box = await loc.boundingBox();
    if (!box) throw new Error(`ligne introuvable : ${texte}`);
    return box;
}

/**
 * La boîte CLIENT d'un morceau de texte d'une ligne, mesurée par un Range DOM :
 * c'est ce qu'on veut entourer ou surligner, au pixel près.
 */
async function boiteDuMot(page: Page, ligneTexte: string, mot: string) {
    return page.evaluate(({ ligneTexte, mot }) => {
        const el = [...document.querySelectorAll('.cm-line')].find((l) => l.textContent?.includes(ligneTexte))!;
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

async function armer(page: Page, outil: 'Crayon' | 'Surligneur'): Promise<void> {
    const item = page.locator(`.toolbar-item[aria-label="${outil}"]`);
    // Cliquer un outil déjà armé le désarme : on ne clique que s'il ne l'est pas.
    if (!(await item.evaluate((el) => el.classList.contains('is-active')))) await item.click();
}

async function trace(page: Page, points: { x: number; y: number }[]): Promise<void> {
    await page.mouse.move(points[0].x, points[0].y);
    await page.mouse.down();
    for (const p of points.slice(1)) await page.mouse.move(p.x, p.y);
    await page.mouse.up();
}

/** Surligne un mot d'une ligne, d'un bord à l'autre. */
async function surligner(page: Page, ligneTexte: string, mot: string): Promise<void> {
    await armer(page, 'Surligneur');
    const b = await boiteDuMot(page, ligneTexte, mot);
    const y = b.y + b.height / 2;
    const pts = Array.from({ length: 8 }, (_, i) => ({ x: b.x + 2 + ((b.width - 4) * i) / 7, y }));
    await trace(page, pts);
}

/** Entoure un mot d'une ellipse au crayon. */
async function entourer(page: Page, ligneTexte: string, mot: string): Promise<void> {
    await armer(page, 'Crayon');
    const b = await boiteDuMot(page, ligneTexte, mot);
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    const rx = b.width / 2 + 5;
    const ry = b.height / 2 + 6;
    const pts = [];
    for (let a = 0; a <= Math.PI * 2 - 0.25; a += 0.2) pts.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
    await trace(page, pts);
}

const barre = (page: Page) => page.locator('.agent-barre');
const bulle = (page: Page) => page.locator('.agent-bulle');

/** Le texte que l'agent a compris du trait : celui sous le surlignage de zone. */
async function texteCompris(page: Page): Promise<string> {
    return page.evaluate(() => {
        const w = window as unknown as { app: any };
        const ed = w.app.workspace.getLeavesOfType('markdown')[0].view.editor;
        const zones = [...document.querySelectorAll('.agent-zone')].map((e) => e.getBoundingClientRect());
        if (zones.length === 0) return '';
        const z = zones[0];
        const from = ed.posAtCoords(z.left + 1, z.top + z.height / 2);
        const to = ed.posAtCoords(z.right - 1, z.top + z.height / 2);
        return ed.cm.state.doc.sliceString(from, to);
    });
}

async function ouvrirChat(page: Page): Promise<void> {
    await page.click('.agent-barre [aria-label="Discuter avec Hone"]');
    await expect(bulle(page)).toBeVisible();
}


const plus = (page: Page) => page.locator('.agent-barre [aria-label="Plus d\'outils"]');
const carte = (page: Page) => page.locator('.agent-action-carte');
const traces = (page: Page) => page.locator('.agent-trace');
/** Les icônes à l'écran : celle dont la réponse est rouverte garde sa place, invisible. */
const tracesVisibles = (page: Page) => page.locator('.agent-trace:not(.is-ouverte)');

/** Lance un outil de la barre sur le passage, attend sa carte et la ferme. */
async function outilPuisFermer(page: Page, libelle: string): Promise<string> {
    if (!['Définir', 'Visualiser'].includes(libelle)) await plus(page).click();
    await barre(page).locator(`[aria-label="${libelle}"]`).click();
    await expect(carte(page)).toBeVisible({ timeout: 4_000 });
    const texte = (await carte(page).locator('.agent-action-corps').textContent()) ?? '';
    await carte(page).locator('[aria-label="Fermer"]').click();
    await expect(carte(page)).toHaveCount(0);
    return texte;
}

/** Le bord gauche de la colonne de texte, en coordonnées client. */
async function bordGaucheTexte(page: Page): Promise<number> {
    return page.evaluate(() => {
        const w = window as unknown as { app: any };
        return w.app.workspace.getLeavesOfType('markdown')[0].view.editor.contentEl.getBoundingClientRect().left;
    });
}

/** Traîne la barre d'annotation par sa poignée, son coin haut gauche en (x, y). */
async function deplacerBarreAnnotation(page: Page, x: number, y: number): Promise<void> {
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

/** L'aire commune de deux boîtes, 0 si elles ne se touchent pas. */
function aire(a: { x: number; y: number; width: number; height: number }, b: typeof a): number {
    const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    const hh = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    return w > 0 && hh > 0 ? w * hh : 0;
}

let h: Harnais;

test.beforeEach(async () => {
    h = await lancer();
});

test.afterEach(async () => {
    await h.electronApp.close();
});

// ═══ La sélection à la souris ═══════════════════════════════════════════════

/** Aucun outil d'annotation armé : le curseur de base. */
async function desarmer(page: Page): Promise<void> {
    for (const outil of ['Crayon', 'Surligneur', 'Gomme']) {
        const item = page.locator(`.toolbar-item[aria-label="${outil}"]`);
        if (await item.count() && await item.evaluate((el) => el.classList.contains('is-active'))) await item.click();
    }
}

/** Glisse la souris d'un bord à l'autre d'un mot, comme pour le copier. */
async function selectionner(page: Page, ligneTexte: string, mot: string): Promise<void> {
    await desarmer(page);
    const b = await boiteDuMot(page, ligneTexte, mot);
    const y = b.y + b.height / 2;
    await page.mouse.move(b.x + 1, y);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, y, { steps: 3 });
    await page.mouse.move(b.x + b.width - 1, y, { steps: 3 });
    await page.mouse.up();
}

const nbTraits = (page: Page) => page.evaluate(() => {
    const w = window as unknown as { app: any };
    return w.app.plugins.plugins.get('annotation').source.strokes('note.md').length as number;
});

test('sélectionner à la souris fait apparaître la barre, sur le passage sélectionné', async () => {
    const { page } = h;
    await selectionner(page, 'Ligne 3 :', 'Révolution française');
    await expect(barre(page)).toBeVisible();
    // Le surlignage est dessiné par l'éditeur à la frame suivante.
    await expect.poll(async () => (await texteCompris(page)).trim()).toBe('Révolution française');
    // Pas d'encre : la sélection n'est pas un trait d'annotation.
    expect(await nbTraits(page)).toBe(0);

    // La barre, horizontale, se tient au-dessus du passage, centrée sur lui.
    const mot = await boiteDuMot(page, 'Ligne 3 :', 'Révolution française');
    const b = (await barre(page).boundingBox())!;
    expect(b.width).toBeGreaterThan(b.height);
    expect(b.y + b.height).toBeLessThanOrEqual(mot.y + 1);
    expect(Math.abs(b.x + b.width / 2 - (mot.x + mot.width / 2))).toBeLessThan(2);
});

test('en haut du document, la barre reste dans le pane sans couvrir le passage', async () => {
    const { page } = h;
    await selectionner(page, 'Ligne 1 :', 'Révolution française');
    await expect(barre(page)).toBeVisible();
    const mot = await boiteDuMot(page, 'Ligne 1 :', 'Révolution française');
    const b = (await barre(page).boundingBox())!;
    const pane = (await page.locator('.view-content:has(.agent-barre)').boundingBox())!;
    expect(b.y).toBeGreaterThanOrEqual(pane.y);
    expect(b.y + b.height <= mot.y + 1 || b.y >= mot.y + mot.height - 1).toBe(true);
});

test('« … » élargit la barre vers la droite, sans la faire sortir du pane', async () => {
    const { page } = h;
    await selectionner(page, 'Ligne 3 :', 'Révolution française');
    await expect(barre(page)).toBeVisible();
    const avant = (await barre(page).boundingBox())!;
    await plus(page).click();
    await expect(plus(page)).toBeHidden();
    await expect(barre(page).locator('[aria-label="Résumer"]')).toBeVisible();
    await expect.poll(async () => (await barre(page).boundingBox())!.width).toBeGreaterThan(avant.width + 60);
    const apres = (await barre(page).boundingBox())!;
    const pane = (await page.locator('.view-content:has(.agent-barre)').boundingBox())!;
    expect(apres.height).toBeCloseTo(avant.height, 0);
    expect(apres.x + apres.width).toBeLessThanOrEqual(pane.x + pane.width);
    expect(apres.x).toBeGreaterThanOrEqual(pane.x);
});

test('la barre n\'a pas de croix : un clic à côté la ferme, un clic sur la barre d\'annotation non', async () => {
    const { page } = h;
    await selectionner(page, 'Ligne 3 :', 'Révolution française');
    await expect(barre(page)).toBeVisible();
    await expect(barre(page).locator('[aria-label="Fermer"]')).toHaveCount(0);

    // Une couleur de la barre d'annotation : la barre de l'agent reste.
    await page.locator('.toolbar:not(.agent-barre) .toolbar-item').first().click();
    await expect(barre(page)).toBeVisible();

    const mot = await boiteDuMot(page, 'Ligne 12 :', 'commence');
    await page.mouse.click(mot.x + 2, mot.y + mot.height / 2);
    await expect(barre(page)).toHaveCount(0);
});

test('chat ouvert, un clic à côté ne ferme ni la barre ni le chat', async () => {
    const { page } = h;
    await selectionner(page, 'Ligne 3 :', 'Révolution française');
    await ouvrirChat(page);
    const mot = await boiteDuMot(page, 'Ligne 12 :', 'commence');
    await page.mouse.click(mot.x + 2, mot.y + mot.height / 2);
    await expect(barre(page)).toBeVisible();
    await expect(bulle(page)).toBeVisible();
});

test('un simple clic dans le texte ne montre rien', async () => {
    const { page } = h;
    await desarmer(page);
    const b = await boiteDuMot(page, 'Ligne 3 :', 'Révolution');
    await page.mouse.click(b.x + 5, b.y + b.height / 2);
    await page.waitForTimeout(200);
    await expect(barre(page)).toHaveCount(0);
});

test('une sélection au clavier ne montre rien', async () => {
    const { page } = h;
    await desarmer(page);
    const b = await boiteDuMot(page, 'Ligne 3 :', 'Révolution');
    await page.mouse.click(b.x + 1, b.y + b.height / 2);
    for (let i = 0; i < 6; i++) await page.keyboard.press('Shift+ArrowRight');
    await page.waitForTimeout(200);
    await expect(barre(page)).toHaveCount(0);
});

test('la barre d\'une sélection ouvre le chat, qui laisse sa trace ; la poubelle n\'efface aucun trait', async () => {
    const { page } = h;
    // Un vrai trait ailleurs : la poubelle ne doit pas le toucher.
    await surligner(page, 'Ligne 8 :', 'commence');
    await page.keyboard.press('Escape');
    await expect(barre(page)).toHaveCount(0);
    expect(await nbTraits(page)).toBe(1);

    await selectionner(page, 'Ligne 3 :', 'Révolution française');
    await expect(barre(page)).toBeVisible();
    // Le surlignage est dessiné par l'éditeur à la frame suivante.
    await expect.poll(async () => (await texteCompris(page)).trim()).toBe('Révolution française');
    await ouvrirChat(page);
    await bulle(page).locator('.agent-bulle-champ').fill('Qu\'est-ce que c\'est ?');
    await page.keyboard.press('Enter');
    await expect(bulle(page).locator('.agent-message:not(.is-pending)')).toHaveCount(2, { timeout: 4_000 });
    await bulle(page).locator('[aria-label="Fermer"]').first().click();
    await expect(bulle(page)).toHaveCount(0);
    await expect(traces(page)).toHaveCount(1);

    // Rouverte depuis la marge puis supprimée : le trait de la ligne 8 reste.
    await traces(page).first().click();
    await expect(bulle(page)).toBeVisible();
    await bulle(page).locator('[aria-label="Supprimer l\'annotation"]').click();
    await bulle(page).locator('.agent-pied-supprimer').click();
    await expect(traces(page)).toHaveCount(0);
    expect(await nbTraits(page)).toBe(1);
});
