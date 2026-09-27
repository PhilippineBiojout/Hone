import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import { cp, mkdtemp, mkdir, readFile, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

/**
 * Les réponses de la marge restent avec leur document (registreTraces.ts) : on ouvre un autre
 * document, on revient, l'icône est toujours là ; on relance l'app, elle y est encore. Seule la
 * poubelle la retire.
 *
 * Se lance depuis Fragment, qui porte Playwright : copier ce fichier dans
 * `Fragment-main/app/e2e/hone-traces-persistantes.spec.ts`, `npm run build` ici, puis depuis
 * `Fragment-main/app/` :
 *     npx playwright test e2e/hone-traces-persistantes.spec.ts --workers=1
 *
 * Harnais recopié de agent-widget.spec.ts, avec un second document et une relance sur le même coffre.
 */

const CONTENU = Array.from({ length: 60 }, (_, i) =>
    i === 0 ? '# Premier document' : `Ligne ${i} : la Révolution française commence en 1789.`,
).join('\n');
const AUTRE = Array.from({ length: 60 }, (_, i) =>
    i === 0 ? '# Second document' : `Rang ${i} : le traité de Westphalie est signé en 1648.`,
).join('\n');

interface Coffre { vault: string; userData: string }
interface Harnais { electronApp: ElectronApplication; page: Page }

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

async function preparer(): Promise<Coffre> {
    const base = await mkdtemp(path.join(os.tmpdir(), 'prom-traces-'));
    const vault = path.join(base, 'vault');
    const userData = path.join(base, 'userdata');
    await mkdir(vault, { recursive: true });
    await mkdir(userData, { recursive: true });
    await writeFile(path.join(vault, 'note.md'), CONTENU, 'utf8');
    await writeFile(path.join(vault, 'autre.md'), AUTRE, 'utf8');
    await cp('/Users/philippinebiojout/Documents/IA/fragment-notes/.fragment/plugins/hone', path.join(vault, '.fragment/plugins/hone'), {
        recursive: true,
        filter: (src) => !src.includes('node_modules') && !/[\\/](\.env|couts\.jsonl|traces\.json|memoire\.jsonl)$/.test(src),
    });
    await writeFile(path.join(vault, '.fragment/plugins/hone/data.json'), JSON.stringify({ factice: true }), 'utf8');
    await writeFile(path.join(vault, '.fragment/community-plugins.json'), JSON.stringify(['hone']), 'utf8');
    await writeFile(path.join(userData, 'config.json'), JSON.stringify({ vaultRoot: vault }), 'utf8');
    return { vault, userData };
}

async function lancer(c: Coffre): Promise<Harnais> {
    const electronApp = await _electron.launch({
        args: ['.', `--user-data-dir=${c.userData}`],
        env: { ...process.env, NODE_ENV: 'development' } as Record<string, string>,
    });
    const page = await fenetreApp(electronApp);
    await page.waitForFunction(() => {
        const w = window as unknown as { app?: any };
        const leaves = w.app?.workspace?.getLeavesOfType?.('markdown') ?? [];
        return !!w.app?.workspace?.layoutReady && leaves.length > 0 && !!leaves[0].view?.editor;
    }, undefined, { timeout: 30_000 });
    await page.setViewportSize({ width: 1400, height: 800 });
    // Un seul onglet : le parcours ouvre chaque document à la place de l'autre.
    await page.evaluate(() => {
        const w = window as unknown as { app: any };
        for (const l of w.app.workspace.getLeavesOfType('markdown').slice(1)) l.detach();
    });
    return { electronApp, page };
}

/** Ouvre un document dans l'onglet courant, et attend son texte. */
async function ouvrir(page: Page, chemin: string, texte: string): Promise<void> {
    // Dans l'onglet affiché : c'est là que le cœur remonte la vue, et le calque avec.
    await page.evaluate(async (p) => {
        const w = window as unknown as { app: any };
        const leaf = w.app.workspace.getLeavesOfType('markdown').find((l: any) => l.view?.contentEl?.getClientRects().length > 0)
            ?? w.app.workspace.getLeavesOfType('markdown')[0];
        await leaf.openFile(w.app.vault.getAbstractFileByPath(p));
    }, chemin);
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

test('une réponse fermée reste dans la marge de son document, au retour et après relance', async () => {
    const coffre = await preparer();
    let h = await lancer(coffre);
    try {
        let { page } = h;
        await ouvrir(page, 'note.md', 'Ligne 3 :');
        await armerAnnotation(page);
        await entourer(page, 'Ligne 3 :', 'Révolution');
        const reponse = await definirPuisFermer(page);
        await expect(traces(page)).toHaveCount(1);
        await expect(traces(page)).toHaveAttribute('aria-label', /^Définir : Révolution/);
        const avant = (await traces(page).boundingBox())!;

        // Un autre document : ses propres annotations, pas celles du premier.
        await ouvrir(page, 'autre.md', 'Rang 3 :');
        await expect(traces(page)).toHaveCount(0);
        await armerAnnotation(page);
        await entourer(page, 'Rang 5 :', 'Westphalie');
        await definirPuisFermer(page);
        await expect(traces(page)).toHaveCount(1);
        await expect(traces(page)).toHaveAttribute('aria-label', /^Définir : Westphalie/);

        // Retour au premier : l'icône est là, à la même place, et rouvre la même réponse.
        await ouvrir(page, 'note.md', 'Ligne 3 :');
        await expect(traces(page)).toHaveCount(1);
        await expect(traces(page)).toHaveAttribute('aria-label', /^Définir : Révolution/);
        const apres = (await traces(page).boundingBox())!;
        expect(Math.abs(apres.y - avant.y)).toBeLessThan(2);
        expect(Math.abs(apres.x - avant.x)).toBeLessThan(2);
        await traces(page).click();
        await expect(carte(page)).toBeVisible();
        await expect(carte(page).locator('.agent-action-corps')).toHaveText(reponse);
        await carte(page).locator('[aria-label="Fermer"]').click();
        await expect(traces(page)).toHaveCount(1);

        // Écrit sur disque, sans attendre la fermeture.
        await expect.poll(async () => {
            const brut = await readFile(path.join(coffre.vault, '.fragment/plugins/hone/traces.json'), 'utf8').catch(() => '{}');
            return Object.keys(JSON.parse(brut).documents ?? {}).sort();
        }).toEqual(['autre.md', 'note.md']);

        // Relance : les deux documents gardent leur icône.
        await h.electronApp.close();
        h = await lancer(coffre);
        page = h.page;
        await ouvrir(page, 'note.md', 'Ligne 3 :');
        await expect(traces(page)).toHaveCount(1);
        await traces(page).click();
        await expect(carte(page).locator('.agent-action-corps')).toHaveText(reponse);

        // La poubelle, et seulement elle, retire la réponse, pour de bon.
        await carte(page).locator('.agent-pied-poubelle').click();
        await carte(page).locator('.agent-pied-supprimer').click();
        await expect(traces(page)).toHaveCount(0);
        await ouvrir(page, 'autre.md', 'Rang 3 :');
        await expect(traces(page)).toHaveCount(1);
        await expect.poll(async () => {
            const brut = await readFile(path.join(coffre.vault, '.fragment/plugins/hone/traces.json'), 'utf8').catch(() => '{}');
            return Object.keys(JSON.parse(brut).documents ?? {}).sort();
        }).toEqual(['autre.md']);
        await h.electronApp.close();
        h = await lancer(coffre);
        page = h.page;
        await ouvrir(page, 'note.md', 'Ligne 3 :');
        await page.waitForTimeout(500);
        await expect(traces(page)).toHaveCount(0);
        await ouvrir(page, 'autre.md', 'Rang 3 :');
        await expect(traces(page)).toHaveCount(1);
    } finally {
        await h.electronApp.close();
    }
});
