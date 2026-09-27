import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import { cp, mkdtemp, mkdir, readFile, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

/**
 * Les réponses de la marge restent avec leur document, dans l'app installée
 * (/Applications/Fragment.app) sur une copie complète de fragment-notes : ses vrais
 * documents, sa disposition, ses plugins. Hone y répond en factice, pour ne rien
 * dépenser sur le compte ChatGPT : c'est la marge qu'on vérifie, pas Codex.
 *
 * Même parcours que hone-traces-persistantes.spec.ts, dont les aides sont recopiées :
 *     npx playwright test e2e/hone-traces-son-coffre.spec.ts --workers=1
 */

const DOC1 = "Histoire de l'informatique/01 Les machines à calculer.md";
const DOC2 = "Histoire de l'informatique/02 Les premiers ordinateurs.md";

interface Coffre { vault: string; userData: string }
interface Harnais { electronApp: ElectronApplication; page: Page }

async function fenetreApp(electronApp: ElectronApplication): Promise<Page> {
    const fin = Date.now() + 30_000;
    while (Date.now() < fin) {
        for (const w of electronApp.windows()) {
            if (!w.url().startsWith('devtools')) return w;
        }
        await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error('fenêtre app introuvable');
}

async function preparer(): Promise<Coffre> {
    const base = await mkdtemp(path.join(os.tmpdir(), 'prom-traces-coffre-'));
    const vault = path.join(base, 'vault');
    const userData = path.join(base, 'userdata');
    await mkdir(userData, { recursive: true });
    await cp('/Users/philippinebiojout/Documents/IA/fragment-notes', vault, { recursive: true,
        filter: (src) => !src.includes('node_modules') && !src.includes('/.git') && !/[\\/]hone[\\/]traces\.json$/.test(src) });
    const data = path.join(vault, '.fragment/plugins/hone/data.json');
    const reglages = JSON.parse(await readFile(data, 'utf8').catch(() => '{}'));
    await writeFile(data, JSON.stringify({ ...reglages, factice: true }), 'utf8');
    await writeFile(path.join(userData, 'config.json'), JSON.stringify({ vaultRoot: vault }), 'utf8');
    return { vault, userData };
}

async function lancer(c: Coffre): Promise<Harnais> {
    const electronApp = await _electron.launch({
        executablePath: '/Applications/Fragment.app/Contents/MacOS/Fragment',
        args: [`--user-data-dir=${c.userData}`, `--vault-root=${c.vault}`],
        env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: process.env.HOME! } as Record<string, string>,
    });
    const page = await fenetreApp(electronApp);
    await page.waitForFunction(() => !!(window as any).app?.workspace?.layoutReady, undefined, { timeout: 30_000 });
    await page.setViewportSize({ width: 1400, height: 800 });
    // Hone chargé : son calque est au catalogue.
    await page.waitForFunction(() => [...(window as any).app.layers.entries()].some((e: any) => e.key === 'hone'), undefined, { timeout: 30_000 });
    await page.evaluate(() => {
        const w = window as unknown as { app: any };
        for (const l of w.app.workspace.getLeavesOfType('markdown').slice(1)) l.detach();
    });
    return { electronApp, page };
}

/** Ouvre un document comme elle le fait, par le lien : son coffre restaure des onglets différés. */
async function ouvrir(page: Page, chemin: string, texte: string): Promise<void> {
    await page.evaluate((p) => (window as unknown as { app: any }).app.workspace.openLinkText(p, '', false), chemin);
    await expect(page.locator('.cm-line:visible', { hasText: texte }).first()).toBeVisible();
}

/** Le calque d'annotation est désactivé d'office, et une vue neuve peut l'avoir perdu. */
async function armerAnnotation(page: Page): Promise<void> {
    await page.evaluate(() => {
        const w = window as unknown as { app: any };
        // La vue à l'écran : l'onglet actif n'est pas toujours celui du document ouvert.
        const vue = w.app.workspace.getLeavesOfType('markdown').map((l: any) => l.view)
            .find((v: any) => v.contentEl?.getClientRects().length > 0);
        if (!vue.activeLayers.has('annotation')) vue.toggleLayer('annotation');
    });
    await expect(page.locator('.toolbar-item[aria-label="Crayon"]:visible')).toHaveCount(1);
}

/** Le rectangle CLIENT de la première ligne rendue qui contient `texte`. */
async function ligne(page: Page, texte: string) {
    const loc = page.locator('.cm-line:visible', { hasText: texte }).first();
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
        const el = [...document.querySelectorAll('.cm-line')].find((l) => l.textContent?.includes(ligneTexte) && l.getClientRects().length > 0)!;
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
    const item = page.locator(`.toolbar-item[aria-label="${outil}"]:visible`);
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
const carte = (page: Page) => page.locator('.agent-action-carte');
const traces = (page: Page) => page.locator('.agent-trace:visible');

async function definirPuisFermer(page: Page): Promise<string> {
    await barre(page).locator('[aria-label="Définir"]').click();
    await expect(carte(page)).toBeVisible({ timeout: 4_000 });
    await expect.poll(async () => ((await carte(page).locator('.agent-action-corps').textContent()) ?? '').length, { timeout: 8_000 }).toBeGreaterThan(0);
    const texte = (await carte(page).locator('.agent-action-corps').textContent()) ?? '';
    await carte(page).locator('[aria-label="Fermer"]').click();
    await expect(carte(page)).toHaveCount(0);
    return texte;
}


test('dans son app et son coffre, la marge garde ses réponses d’un document à l’autre et après relance', async () => {
    const coffre = await preparer();
    let h = await lancer(coffre);
    try {
        let { page } = h;
        await ouvrir(page, DOC1, 'Blaise Pascal');
        await armerAnnotation(page);
        await entourer(page, 'Blaise Pascal', 'Pascaline');
        const reponse = await definirPuisFermer(page);
        await expect(traces(page)).toHaveCount(1);
        const avant = (await traces(page).boundingBox())!;
        await page.screenshot({ path: 'test-results/traces-son-coffre-1-doc1.png' });

        await ouvrir(page, DOC2, 'Alan Turing');
        await expect(traces(page)).toHaveCount(0);
        await armerAnnotation(page);
        await entourer(page, 'Alan Turing', 'Turing');
        await definirPuisFermer(page);
        await expect(traces(page)).toHaveCount(1);
        await page.screenshot({ path: 'test-results/traces-son-coffre-2-doc2.png' });

        await ouvrir(page, DOC1, 'Blaise Pascal');
        await expect(traces(page)).toHaveCount(1);
        await expect(traces(page)).toHaveAttribute('aria-label', /^Définir : .*Pascaline/);
        const apres = (await traces(page).boundingBox())!;
        expect(Math.abs(apres.y - avant.y)).toBeLessThan(2);
        await page.screenshot({ path: 'test-results/traces-son-coffre-3-retour.png' });
        await traces(page).click();
        await expect(carte(page).locator('.agent-action-corps')).toHaveText(reponse);
        await carte(page).locator('[aria-label="Fermer"]').click();
        await expect.poll(async () => {
            const brut = await readFile(path.join(coffre.vault, '.fragment/plugins/hone/traces.json'), 'utf8').catch(() => '{}');
            return Object.keys(JSON.parse(brut).documents ?? {}).sort();
        }).toEqual([DOC1, DOC2]);

        await h.electronApp.close();
        h = await lancer(coffre);
        page = h.page;
        await ouvrir(page, DOC1, 'Blaise Pascal');
        await expect(traces(page)).toHaveCount(1);
        await page.screenshot({ path: 'test-results/traces-son-coffre-4-relance.png' });
        await ouvrir(page, DOC2, 'Alan Turing');
        await expect(traces(page)).toHaveCount(1);
    } finally {
        await h.electronApp.close();
    }
});
