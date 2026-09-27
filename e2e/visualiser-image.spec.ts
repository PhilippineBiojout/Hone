import { test, expect, type Page } from '@playwright/test';
import path from 'path';
import { barre, carte, lancerInstallee, selectionnerInstallee, type Harnais } from './hone-commun';

/**
 * Visualiser par le vrai Codex, dans l'app installée sur une copie de fragment-notes :
 * Hone choisit seul entre une image générée (une chose à voir) et un dessin SVG (une
 * structure). AGENT_CAPTURES=<dossier> garde la carte dans les deux thèmes.
 */

const NOTE = {
    chemin: 'note-visualiser.md',
    ligne: 'Ligne 2',
    contenu: [
        '# Test de Visualiser',
        '',
        'Ligne 2 : une orbitale 2p a deux lobes de part et d\'autre du noyau, comme un haltère, et un plan nodal entre eux.',
        '',
        'Ligne 4 : les premiers calculateurs se succèdent vite : le Z3 en 1941, Colossus en 1944, puis ENIAC en 1945.',
    ].join('\n'),
};

// Copier le coffre, lancer l'app, puis une image générée (environ une minute).
test.describe.configure({ timeout: 300_000 });

let h: Harnais;
test.beforeEach(async () => { h = await lancerInstallee(NOTE); });
test.afterEach(async () => { await h?.electronApp.close(); });

const CAPTURES = process.env.AGENT_CAPTURES;

async function capturer(page: Page, nom: string): Promise<void> {
    if (!CAPTURES) return;
    for (const theme of ['dark', 'light'] as const) {
        await page.emulateMedia({ colorScheme: theme });
        await page.waitForTimeout(150);
        await carte(page).screenshot({ path: path.join(CAPTURES, `${nom}-${theme}.png`) });
    }
    await page.emulateMedia({ colorScheme: null });
}

async function visualiser(page: Page, ligne: string, passage: string): Promise<string> {
    await selectionnerInstallee(page, ligne, passage);
    await expect(barre(page)).toBeVisible();
    await barre(page).locator('[aria-label="Visualiser"]').click();
    // Pendant l'attente, un rond qui réfléchit ; la carte ne s'ouvre qu'avec la réponse.
    await expect(carte(page)).toBeVisible({ timeout: 240_000 });
    const corps = carte(page).locator('.agent-action-corps');
    await expect(corps.locator('img, svg').first()).toBeVisible({ timeout: 10_000 });
    return (await corps.locator('img').count()) > 0 ? 'image' : 'dessin';
}

test('une chose à voir : Hone génère une image, rangée dans le plugin et affichée à la largeur de la carte', async () => {
    const { page, vault } = h;
    const forme = await visualiser(page, 'Ligne 2', 'une orbitale 2p a deux lobes de part et d\'autre du noyau');
    expect(forme).toBe('image');

    const img = carte(page).locator('.agent-action-corps img');
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBeGreaterThan(100);
    const src = await img.getAttribute('src');
    expect(src).not.toMatch(/^data:/); // un chemin lu par la plateforme, pas un mégaoctet dans la page
    const largeurs = await carte(page).evaluate((el) => ({
        img: el.querySelector('.agent-action-corps img')!.getBoundingClientRect().width,
        corps: (el.querySelector('.agent-action-corps') as HTMLElement).clientWidth,
    }));
    expect(largeurs.img).toBeGreaterThan(largeurs.corps - 30);
    await expect(carte(page).locator('.agent-action-parcours')).toContainText(/image/i);

    // Le fichier est bien dans images/ du plugin, dans la copie du coffre.
    const chemin = await page.evaluate(() => {
        const app = (window as unknown as { app: any }).app;
        return app.vault.adapter.list(`${app.plugins.pluginsDir}/hone/images`);
    });
    expect((chemin as { files: string[] }).files.length).toBeGreaterThan(0);
    console.log('IMAGE', vault, (chemin as { files: string[] }).files);
    await page.waitForTimeout(600);
    await capturer(page, 'visualiser-image');
});

test('une structure : Hone dessine un SVG', async () => {
    const { page } = h;
    const forme = await visualiser(page, 'Ligne 4', 'les premiers calculateurs se succèdent vite');
    console.log('FORME', forme);
    expect(forme).toBe('dessin');
    await page.waitForTimeout(600);
    await capturer(page, 'visualiser-dessin');
});
