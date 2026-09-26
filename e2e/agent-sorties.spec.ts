import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import { cp, mkdtemp, mkdir, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

/**
 * Les sorties structurées de l'agent, en mode factice (sans .env, aucune
 * requête) : le dessin de Visualiser nettoyé dans la carte, le globe d'une
 * réponse du web, l'indice qui s'arrête, et leur retour depuis la marge.
 *
 * Harnais recopié de agent-widget.spec.ts, dont la description suit.
 *
 * Le chat et les cartes d'outil en widget (src/widget.ts) : déplacer par
 * l'en-tête, agrandir par les bords et les coins, rester posé dans le texte.
 *
 * Se lance depuis Fragment, qui porte Playwright : copier ce fichier dans
 * `Fragment/app/e2e/`, `npm run build` ici, puis depuis `Fragment/app/` :
 *     npx playwright test e2e/agent-sorties.spec.ts --workers=1
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

// ═══ Les sorties structurées ═══════════════════════════════════════════════

const CAPTURES = process.env.AGENT_CAPTURES;

async function carteOuverte(page: Page, libelle: string): Promise<void> {
    if (!['Définir', 'Visualiser'].includes(libelle)) await plus(page).click();
    await barre(page).locator(`[aria-label="${libelle}"]`).click();
    await expect(carte(page)).toBeVisible({ timeout: 4_000 });
    await expect.poll(() => carte(page).evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    await page.waitForTimeout(300);
}

async function capturer(page: Page, nom: string): Promise<void> {
    if (!CAPTURES) return;
    for (const theme of ['dark', 'light'] as const) {
        await page.emulateMedia({ colorScheme: theme });
        await page.waitForTimeout(150);
        await carte(page).screenshot({ path: path.join(CAPTURES, `${nom}-${theme}.png`) });
    }
    await page.emulateMedia({ colorScheme: null });
}

test('Visualiser dessine un SVG nettoyé dans la carte, qui suit sa largeur', async () => {
    const { page } = h;
    await surligner(page, 'Ligne 3 :', 'Révolution française');
    await expect(barre(page)).toBeVisible();
    await carteOuverte(page, 'Visualiser');
    const corps = carte(page).locator('.agent-action-corps');
    await expect(corps).toHaveClass(/is-visuel/);
    const svg = corps.locator('svg');
    await expect(svg).toHaveCount(1);
    expect(await svg.getAttribute('viewBox')).toBeTruthy();
    expect(await svg.getAttribute('width')).toBeNull();
    const largeurs = await page.evaluate(() => {
        const c = document.querySelector('.agent-action-corps')!;
        const s = c.querySelector('svg')!;
        const style = getComputedStyle(c);
        return { svg: s.getBoundingClientRect().width, corps: c.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) };
    });
    expect(Math.abs(largeurs.svg - largeurs.corps)).toBeLessThan(2);
    // Le texte du dessin prend la couleur du thème (currentColor), pas du noir en dur.
    const couleurs = await page.evaluate(() => {
        const t = document.querySelector('.agent-action-corps svg text')!;
        return { texte: getComputedStyle(t).fill, carte: getComputedStyle(document.querySelector('.agent-action-corps')!).color };
    });
    expect(couleurs.texte).toBe(couleurs.carte);
    await expect(carte(page).locator('.agent-action-source')).toBeHidden();
    await capturer(page, 'visualiser');

    // Fermée puis rouverte depuis la marge : le dessin revient, sans rappeler l'agent.
    await carte(page).locator('[aria-label="Fermer"]').click();
    await expect(carte(page)).toHaveCount(0);
    await tracesVisibles(page).first().click();
    await expect(carte(page).locator('.agent-action-corps svg')).toHaveCount(1);
});

test('Définir tirée du web porte le globe, qui revient avec elle', async () => {
    const { page } = h;
    await surligner(page, 'Ligne 3 :', 'Révolution française');
    await carteOuverte(page, 'Définir');
    await expect(carte(page).locator('.agent-action-source')).toBeVisible();
    await expect(carte(page).locator('.agent-action-source')).toHaveAttribute('title', 'Réponse tirée du web');
    await capturer(page, 'definir-web');
    await carte(page).locator('[aria-label="Fermer"]').click();
    await tracesVisibles(page).first().click();
    await expect(carte(page).locator('.agent-action-source')).toBeVisible();
});

test('Aider donne un indice de plus à chaque fois, puis s\'arrête sans rappeler l\'agent', async () => {
    const { page } = h;
    const indices: string[] = [];
    for (let i = 0; i < 5; i++) {
        await surligner(page, 'Ligne 3 :', 'Révolution française');
        await expect(barre(page)).toBeVisible();
        indices.push(await outilPuisFermer(page, 'Aider'));
    }
    expect(indices[0]).toContain('numéro 1');
    expect(indices[2]).toContain('numéro 3');
    expect(indices[3]).toContain('Je ne peux plus t\'aider');
    expect(indices[4]).toContain('Je ne peux plus t\'aider');
    // L'indice arrêté se lit autrement (italique, couleur secondaire).
    await surligner(page, 'Ligne 3 :', 'Révolution française');
    await carteOuverte(page, 'Aider');
    await expect(carte(page).locator('.agent-action-corps')).toHaveClass(/is-stop/);
    await capturer(page, 'aider-stop');
});
