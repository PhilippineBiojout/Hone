import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import { cp, mkdtemp, mkdir, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

/**
 * Le chat et les cartes d'outil en widget (src/widget.ts) : déplacer par
 * l'en-tête, agrandir par les bords et les coins, rester posé dans le texte.
 *
 * Se lance depuis Fragment, qui porte Playwright : copier ce fichier dans
 * `Fragment/app/e2e/`, `npm run build` ici, puis depuis `Fragment/app/` :
 *     npx playwright test e2e/agent-widget.spec.ts --workers=1
 * `lancer()` copie ce dossier de plugin dans le vault temporaire.
 *
 * Harnais recopié de l'ancien agent-traces.spec.ts, dont la description suit.
 *
 * L'historique de l'agent dans la marge (traces.ts) : une carte d'outil ou une
 * conversation qu'on ferme laisse une icône dans la marge droite, à la hauteur
 * du passage. Un clic dessus rouvre ce que l'agent avait répondu.
 *
 * Même harnais que agent-bulle.spec.ts, recopié : les specs ne partagent rien.
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
    // Hone passe par Codex : en factice, ces tests n'appellent rien de réel.
    await writeFile(path.join(vault, '.fragment/plugins/hone/data.json'), JSON.stringify({ factice: true }), 'utf8');
    // Le cœur ne charge aucun plugin d'un coffre sans community-plugins.json (mode restreint).
    await writeFile(path.join(vault, '.fragment/community-plugins.json'), JSON.stringify(['hone']), 'utf8');
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

// ═══ Le chat et les cartes en widget (widget.ts) ═══════════════════════════

/** Tire de (x0, y0) de (dx, dy), en plusieurs pas. */
async function tirer(page: Page, x0: number, y0: number, dx: number, dy: number): Promise<void> {
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move(x0 + dx / 2, y0 + dy / 2, { steps: 3 });
    await page.mouse.move(x0 + dx, y0 + dy, { steps: 3 });
    await page.mouse.up();
}

async function carteOuverte(page: Page, libelle = 'Traduire'): Promise<void> {
    if (!['Définir', 'Visualiser'].includes(libelle)) await plus(page).click();
    await barre(page).locator(`[aria-label="${libelle}"]`).click();
    await expect(carte(page)).toBeVisible({ timeout: 4_000 });
    await expect.poll(() => carte(page).evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    await page.waitForTimeout(300);
}

/** Tire la carte par son titre. */
async function deplacerCarte(page: Page, dx: number, dy: number): Promise<void> {
    const t = (await carte(page).locator('.agent-action-titre').boundingBox())!;
    await tirer(page, t.x + 10, t.y + t.height / 2, dx, dy);
}

test('une carte se déplace par son en-tête, et défile ensuite avec le texte', async () => {
    const { page } = h;
    await surligner(page, 'Ligne 3 :', 'Révolution française');
    await carteOuverte(page);
    const avant = (await carte(page).boundingBox())!;
    await deplacerCarte(page, -120, 160);
    const apres = (await carte(page).boundingBox())!;
    expect(Math.abs(apres.x - (avant.x - 120))).toBeLessThan(1.5);
    expect(Math.abs(apres.y - (avant.y + 160))).toBeLessThan(1.5);
    // Rien d'autre n'a bougé : même taille, carte toujours ouverte.
    expect(Math.abs(apres.width - avant.width)).toBeLessThan(1.5);

    // On fait défiler la note : la carte suit le texte, pas l'écran.
    const l0 = await ligne(page, 'Ligne 3 :');
    await page.mouse.move(l0.x + 40, l0.y + 300);
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(300);
    const l1 = await ligne(page, 'Ligne 3 :');
    const defile = (await carte(page).boundingBox())!;
    expect(l0.y - l1.y).toBeGreaterThan(50);
    expect(Math.abs((defile.y - apres.y) - (l1.y - l0.y))).toBeLessThan(1.5);
});

test('un clic sur la croix ferme toujours, il ne déplace rien', async () => {
    const { page } = h;
    await surligner(page, 'Ligne 3 :', 'Révolution française');
    await carteOuverte(page);
    await carte(page).locator('[aria-label="Fermer"]').click();
    await expect(carte(page)).toHaveCount(0);
});

test('les bords et les coins montrent une double flèche', async () => {
    const { page } = h;
    await surligner(page, 'Ligne 3 :', 'Révolution française');
    await carteOuverte(page);
    const curseurs = await carte(page).evaluate((el) => Object.fromEntries(
        [...el.querySelectorAll('.agent-widget-bord')].map((b) => [
            [...b.classList].find((c) => c.startsWith('mod-')), getComputedStyle(b).cursor,
        ])));
    expect(curseurs).toEqual({
        'mod-n': 'ns-resize', 'mod-s': 'ns-resize', 'mod-e': 'ew-resize', 'mod-w': 'ew-resize',
        'mod-ne': 'nesw-resize', 'mod-sw': 'nesw-resize', 'mod-nw': 'nwse-resize', 'mod-se': 'nwse-resize',
    });
    // Le coin est bien sous le pointeur au coin de la carte (pas masqué par le contenu).
    const b = (await carte(page).boundingBox())!;
    const sous = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.className ?? '', { x: b.x + b.width - 1, y: b.y + b.height - 1 });
    expect(sous).toContain('mod-se');
});

test('tirer le coin bas droit agrandit, le haut gauche ne bouge pas', async () => {
    const { page } = h;
    await surligner(page, 'Ligne 3 :', 'Révolution française');
    await carteOuverte(page);
    const a = (await carte(page).boundingBox())!;
    await tirer(page, a.x + a.width - 2, a.y + a.height - 2, 80, 120);
    const b = (await carte(page).boundingBox())!;
    expect(Math.abs(b.x - a.x)).toBeLessThan(1.5);
    expect(Math.abs(b.y - a.y)).toBeLessThan(1.5);
    expect(Math.abs(b.width - (a.width + 80))).toBeLessThan(1.5);
    expect(Math.abs(b.height - (a.height + 120))).toBeLessThan(1.5);
});

test('tirer le bord gauche ou le haut agrandit vers l\'extérieur, le bord opposé reste', async () => {
    const { page } = h;
    await surligner(page, 'Ligne 12 :', 'Révolution française');
    await carteOuverte(page);
    const a = (await carte(page).boundingBox())!;
    await tirer(page, a.x + 1, a.y + a.height / 2, -60, 0);
    await tirer(page, a.x - 60 + a.width / 2, a.y + 1, 0, -50);
    const b = (await carte(page).boundingBox())!;
    expect(Math.abs(b.x + b.width - (a.x + a.width))).toBeLessThan(1.5);
    expect(Math.abs(b.y + b.height - (a.y + a.height))).toBeLessThan(1.5);
    expect(Math.abs(b.width - (a.width + 60))).toBeLessThan(1.5);
    expect(Math.abs(b.height - (a.height + 50))).toBeLessThan(1.5);
});

test('rapetissée, la carte garde une taille minimale et sa réponse défile', async () => {
    const { page } = h;
    await surligner(page, 'Ligne 3 :', 'Révolution française');
    await carteOuverte(page);
    const a = (await carte(page).boundingBox())!;
    await tirer(page, a.x + a.width - 2, a.y + a.height - 2, -400, -400);
    const b = (await carte(page).boundingBox())!;
    expect(Math.round(b.width)).toBe(220);
    // Jamais plus haute qu'à l'ouverture : le minimum ne grandit pas une carte courte.
    expect(Math.round(b.height)).toBe(Math.round(Math.min(120, a.height)));
    const corps = await carte(page).locator('.agent-action-corps').evaluate((el) => getComputedStyle(el).overflowY);
    expect(corps).toBe('auto');
    // La croix reste dans la carte.
    const x = (await carte(page).locator('[aria-label="Fermer"]').boundingBox())!;
    expect(x.x + x.width).toBeLessThanOrEqual(b.x + b.width);
});

test('rouverte depuis la marge, la carte revient où on l\'a posée, à sa taille', async () => {
    const { page } = h;
    await surligner(page, 'Ligne 3 :', 'Révolution française');
    await carteOuverte(page);
    await deplacerCarte(page, -100, 140);
    const m = (await carte(page).boundingBox())!;
    await tirer(page, m.x + m.width - 2, m.y + m.height - 2, 40, 60);
    const posee = (await carte(page).boundingBox())!;
    await carte(page).locator('[aria-label="Fermer"]').click();

    await traces(page).click();
    await expect.poll(() => carte(page).evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    await page.waitForTimeout(300);
    const revenue = (await carte(page).boundingBox())!;
    for (const k of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(revenue[k] - posee[k])).toBeLessThan(1.5);
    await carte(page).locator('[aria-label="Fermer"]').click();

    // Un nouvel outil sur un autre passage repart de la place automatique.
    await surligner(page, 'Ligne 20 :', 'commence');
    await carteOuverte(page, 'Définir');
    const neuve = (await carte(page).boundingBox())!;
    expect(Math.round(neuve.width)).toBe(Math.round(posee.width - 40));
});

test('le chat se déplace et s\'agrandit, garde sa saisie en bas, et revient à sa place rouvert', async () => {
    const { page } = h;
    await surligner(page, 'Ligne 5 :', 'commence');
    await ouvrirChat(page);
    await page.locator('.agent-bulle-champ').fill('Pourquoi 1789 ?');
    await page.keyboard.press('Enter');
    await expect(page.locator('.agent-message.mod-agent')).toContainText('Réponse factice', { timeout: 5_000 });

    const e = (await page.locator('.agent-bulle-extrait').boundingBox())!;
    await tirer(page, e.x + 20, e.y + e.height / 2, -200, 40);
    const d = (await bulle(page).boundingBox())!;
    await tirer(page, d.x + d.width - 2, d.y + d.height - 2, 60, 100);
    const posee = (await bulle(page).boundingBox())!;
    expect(Math.abs(posee.height - (d.height + 100))).toBeLessThan(1.5);
    // La saisie reste collée en bas, au-dessus du pied.
    const champ = (await page.locator('.agent-bulle-saisie').boundingBox())!;
    expect(posee.y + posee.height - (champ.y + champ.height)).toBeLessThan(50);
    // Toujours utilisable.
    await page.locator('.agent-bulle-champ').fill('Et après ?');
    await page.keyboard.press('Enter');
    await expect(page.locator('.agent-message.mod-agent')).toHaveCount(2, { timeout: 5_000 });

    await page.locator('.agent-bulle [aria-label="Fermer"]').click();
    await page.keyboard.press('Escape');
    await expect(barre(page)).toHaveCount(0);
    await traces(page).click();
    await expect.poll(() => bulle(page).evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    await page.waitForTimeout(300);
    const revenue = (await bulle(page).boundingBox())!;
    for (const k of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(revenue[k] - posee[k])).toBeLessThan(1.5);
});

test('tiré hors du panneau, le widget s\'arrête à son bord, jamais rogné', async () => {
    const { page } = h;
    await surligner(page, 'Ligne 5 :', 'commence');
    await carteOuverte(page, 'Définir');
    await deplacerCarte(page, -2000, 0);
    const pane = await page.evaluate(() => {
        const w = window as unknown as { app: any };
        const r = w.app.workspace.getLeavesOfType('markdown')[0].view.contentEl.getBoundingClientRect();
        return { left: r.left, right: r.right };
    });
    const b = (await carte(page).boundingBox())!;
    expect(Math.abs(b.x - (pane.left + 8))).toBeLessThan(1.5);
    // Et tiré par le coin au-delà du bord droit, il s'arrête aussi.
    await tirer(page, b.x + b.width - 2, b.y + b.height - 2, 3000, 0);
    const c = (await carte(page).boundingBox())!;
    expect(Math.abs(c.x + c.width - (pane.right - 8))).toBeLessThan(1.5);
});

test('un cadre gardé plus grand que le panneau revient plafonné à sa taille', async () => {
    const { page } = h;
    await surligner(page, 'Ligne 3 :', 'Révolution française');
    await carteOuverte(page);
    const a = (await carte(page).boundingBox())!;
    await tirer(page, a.x + a.width - 2, a.y + a.height - 2, 300, 250);
    const grande = (await carte(page).boundingBox())!;
    await carte(page).locator('[aria-label="Fermer"]').click();

    // La fenêtre rétrécit : le panneau devient plus étroit que la carte gardée.
    await page.setViewportSize({ width: 800, height: 500 });
    await page.waitForTimeout(300);
    // Si étroite, la marge n'a plus de place pour l'icône, qui se masque : on
    // la déclenche directement, c'est la taille rouverte qu'on vérifie ici.
    await traces(page).dispatchEvent('click');
    await expect.poll(() => carte(page).evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    await page.waitForTimeout(300);
    const pane = await page.evaluate(() => {
        const w = window as unknown as { app: any };
        const r = w.app.workspace.getLeavesOfType('markdown')[0].view.contentEl.getBoundingClientRect();
        return { width: r.width, height: r.height };
    });
    const b = (await carte(page).boundingBox())!;
    expect(grande.width).toBeGreaterThan(pane.width - 16);
    expect(b.width).toBeLessThanOrEqual(pane.width - 16 + 0.5);
    expect(b.height).toBeLessThanOrEqual(pane.height - 16 + 0.5);
});

test('emporté vers le haut par le défilement, le widget passe sous la barre d\'onglets', async () => {
    const { page } = h;
    await surligner(page, 'Ligne 12 :', 'Révolution française');
    await carteOuverte(page);
    // Posée dans le texte : elle défile avec lui.
    await deplacerCarte(page, 0, -1);
    const pane = await page.evaluate(() => {
        const w = window as unknown as { app: any };
        const r = w.app.workspace.getLeavesOfType('markdown')[0].view.contentEl.getBoundingClientRect();
        return { top: r.top };
    });
    const l = await ligne(page, 'Ligne 12 :');
    await page.mouse.move(l.x + 40, l.y + 200);
    for (let i = 0; i < 20; i++) {
        await page.mouse.wheel(0, 60);
        await page.waitForTimeout(80);
        const c = (await carte(page).boundingBox())!;
        if (c.y < pane.top - 20) break;
    }
    const c = (await carte(page).boundingBox())!;
    expect(c.y).toBeLessThan(pane.top - 10);
    // Au-dessus du pane, sur la largeur de la carte : c'est la barre qu'on voit.
    const dessus = await page.evaluate(({ x, y }) => {
        const el = document.elementFromPoint(x, y);
        return el?.closest('.agent-action-carte') ? 'carte' : 'autre';
    }, { x: c.x + c.width / 2, y: pane.top - 5 });
    expect(dessus).toBe('autre');
    // Et la partie encore dans le pane reste visible.
    const dedans = await page.evaluate(({ x, y }) =>
        document.elementFromPoint(x, y)?.closest('.agent-action-carte') ? 'carte' : 'autre',
    { x: c.x + c.width / 2, y: c.y + c.height - 10 });
    expect(dedans).toBe('carte');
});

// ═══ La carte devient un chat (la tête de chat du pied) ═════════════════════

const discuter = (page: Page) => carte(page).locator('[aria-label="Discuter de cette réponse"]');

async function chatVisible(page: Page): Promise<void> {
    await expect(bulle(page)).toBeVisible();
    await expect.poll(() => bulle(page).evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    await page.waitForTimeout(300);
}

test('la tête de chat d\'une carte neuve la change en chat qui commence par sa réponse', async () => {
    const { page } = h;
    await surligner(page, 'Ligne 3 :', 'Révolution française');
    await carteOuverte(page);
    const reponse = (await carte(page).locator('.agent-action-corps').textContent()) ?? '';
    // Une réponse neuve n'est pas encore une annotation : pas de poubelle.
    await expect(discuter(page)).toBeVisible();
    await expect(carte(page).locator('.agent-pied-poubelle')).toBeHidden();

    await discuter(page).click();
    await expect(carte(page)).toHaveCount(0);
    await chatVisible(page);
    await expect(page.locator('.agent-message')).toHaveCount(1);
    await expect(page.locator('.agent-message.mod-agent')).toHaveText(reponse);
    await expect(bulle(page).locator('.agent-pied-poubelle')).toBeHidden();

    // La question part avec la réponse de l'outil dans l'historique.
    await page.locator('.agent-bulle-champ').fill('Et en 1792 ?');
    await page.keyboard.press('Enter');
    await expect(page.locator('.agent-message.mod-agent').nth(1)).toContainText('après 1 message', { timeout: 5_000 });

    // Une seule icône, celle de l'outil, qui rouvre toute la conversation.
    await page.locator('.agent-bulle [aria-label="Fermer"]').click();
    await expect(traces(page)).toHaveCount(1);
    await expect(traces(page)).toHaveAttribute('aria-label', /^Traduire :/);
    await traces(page).click();
    await chatVisible(page);
    await expect(page.locator('.agent-message')).toHaveCount(3);
    await expect(bulle(page).locator('.agent-pied-poubelle')).toBeVisible();
});

test('une carte rouverte depuis la marge devient un chat sans doubler son icône', async () => {
    const { page } = h;
    await surligner(page, 'Ligne 3 :', 'Révolution française');
    await outilPuisFermer(page, 'Définir');
    await traces(page).click();
    await expect.poll(() => carte(page).evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    await expect(carte(page).locator('.agent-pied-poubelle')).toBeVisible();

    await discuter(page).click();
    await chatVisible(page);
    await expect(bulle(page).locator('.agent-pied-poubelle')).toBeVisible();
    await page.locator('.agent-bulle [aria-label="Fermer"]').click();
    await expect(traces(page)).toHaveCount(1);
    await expect(traces(page)).toHaveAttribute('aria-label', /^Définir :/);

    // La poubelle du chat retire l'annotation entière.
    await traces(page).click();
    await chatVisible(page);
    await bulle(page).locator('.agent-pied-poubelle').click();
    await bulle(page).locator('.agent-pied-supprimer').click();
    await expect(traces(page)).toHaveCount(0);
});

test('le chat prend la place et la taille de la carte posée', async () => {
    const { page } = h;
    await surligner(page, 'Ligne 3 :', 'Révolution française');
    await carteOuverte(page);
    await deplacerCarte(page, -120, 120);
    const m = (await carte(page).boundingBox())!;
    await tirer(page, m.x + m.width - 2, m.y + m.height - 2, 40, 80);
    const posee = (await carte(page).boundingBox())!;

    await discuter(page).click();
    await chatVisible(page);
    const chat = (await bulle(page).boundingBox())!;
    for (const k of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(chat[k] - posee[k])).toBeLessThan(1.5);
});

test('la confirmation de suppression cache la tête de chat', async () => {
    const { page } = h;
    await surligner(page, 'Ligne 3 :', 'Révolution française');
    await outilPuisFermer(page, 'Définir');
    await traces(page).click();
    await expect.poll(() => carte(page).evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    await carte(page).locator('.agent-pied-poubelle').click();
    await expect(discuter(page)).toBeHidden();
    await carte(page).locator('.agent-pied-annuler').click();
    await expect(discuter(page)).toBeVisible();
});

test('fenêtre étroite : la réponse fermée laisse quand même son icône, qui rouvre et supprime', async () => {
    const { page } = h;
    // La colonne remplit presque le pane : la marge gauche passe sous les
    // 60 px où le cœur masque un widget de marge.
    await page.setViewportSize({ width: 960, height: 800 });
    const marge = await page.evaluate(() => {
        const w = window as unknown as { app: any };
        const view = w.app.workspace.getLeavesOfType('markdown')[0].view;
        return document.querySelector('.cm-content')!.getBoundingClientRect().left - view.contentEl.getBoundingClientRect().left;
    });
    expect(marge).toBeLessThan(60);

    await surligner(page, 'Ligne 3 :', 'Révolution française');
    await carteOuverte(page);
    await carte(page).locator('[aria-label="Fermer"]').click();
    await expect(traces(page)).toBeVisible();
    // Dans la marge : à gauche du texte, et dans le pane (pas sous l'explorateur).
    const t = (await traces(page).boundingBox())!;
    expect(t.x + t.width).toBeLessThanOrEqual(await bordGaucheTexte(page));
    const pane = await page.evaluate(() => {
        const w = window as unknown as { app: any };
        return w.app.workspace.getLeavesOfType('markdown')[0].view.contentEl.getBoundingClientRect().left as number;
    });
    expect(t.x).toBeGreaterThanOrEqual(pane);

    await traces(page).click();
    await expect(carte(page)).toBeVisible();
    await carte(page).locator('.agent-pied-poubelle').click();
    await carte(page).locator('.agent-pied-supprimer').click();
    await expect(carte(page)).toHaveCount(0);
    await expect(traces(page)).toHaveCount(0);
});

test('la barre se déplace par sa poignée, puis défile avec le texte', async () => {
    const { page } = h;
    await surligner(page, 'Ligne 3 :', 'Révolution française');
    await expect(barre(page)).toBeVisible();
    const poignee = barre(page).locator('.toolbar-handle');
    await expect(poignee).toBeVisible();
    const a = (await barre(page).boundingBox())!;
    const p = (await poignee.boundingBox())!;
    await tirer(page, p.x + p.width / 2, p.y + p.height / 2, 120, 80);
    const b = (await barre(page).boundingBox())!;
    expect(Math.abs(b.x - a.x - 120)).toBeLessThan(2);
    expect(Math.abs(b.y - a.y - 80)).toBeLessThan(2);
    // Toujours ouverte, toujours horizontale.
    await expect(barre(page)).not.toHaveClass(/mod-vertical/);

    // Ancrée au texte : elle défile avec lui.
    await page.locator('.doc-scroll').evaluate((el) => { el.scrollTop += 100; });
    await page.waitForTimeout(100);
    const c = (await barre(page).boundingBox())!;
    expect(Math.abs(c.y - (b.y - 100))).toBeLessThan(2);
});

// Le Keymap du cœur écoute en capture sur window : sans la portée de clavier.ts,
// Mod+W tapé dans le chat fermait l'onglet, et Échap fermait la barre et le chat.
test('dans le chat, les raccourcis de l\'app ne passent pas, et Échap quitte le champ sans rien fermer', async () => {
    const { page } = h;
    const etat = () => page.evaluate(() => {
        const app = (window as unknown as { app: any }).app;
        return {
            feuilles: app.workspace.getLeavesOfType('markdown').length,
            texte: app.workspace.getLeavesOfType('markdown')[0]?.view.getEditor()?.getValue() as string,
        };
    });
    await surligner(page, 'Ligne 5 :', 'commence');
    await ouvrirChat(page);
    const avant = await etat();

    const champ = page.locator('.agent-bulle-champ');
    await champ.click();
    await page.keyboard.type('Pourquoi');
    await page.keyboard.press('ControlOrMeta+b');
    await page.keyboard.press('ControlOrMeta+w');
    await page.waitForTimeout(300);

    const apres = await etat();
    expect(apres.feuilles).toBe(avant.feuilles);
    expect(apres.texte).toBe(avant.texte);
    await expect(champ).toHaveValue('Pourquoi');

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await expect(bulle(page)).toBeVisible();
    await expect(barre(page)).toBeVisible();
    expect(await champ.evaluate((el) => el === document.activeElement)).toBe(false);
});
