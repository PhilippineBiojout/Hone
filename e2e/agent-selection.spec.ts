import { test, expect, type Page } from '@playwright/test';
import {
    barre, boiteDuMot, bulle, desarmer, lancer, nbTraits, ouvrirChat, plus, selectionner, surligner,
    texteCompris, traces, type Harnais,
} from './hone-commun';

/**
 * La barre de Hone : une sélection à la souris (ou un trait) la fait apparaître au-dessus du
 * passage ; elle n'a pas de croix, un clic à côté la ferme. Le clavier ne déclenche rien.
 */

/** Un clic sur la ligne 12, loin du passage. */
async function clicACote(page: Page): Promise<void> {
    const mot = await boiteDuMot(page, 'Ligne 12 :', 'commence');
    await page.mouse.click(mot.x + 2, mot.y + mot.height / 2);
}

let h: Harnais;
test.beforeEach(async () => { h = await lancer(); });
test.afterEach(async () => { await h.electronApp.close(); });

test('sélectionner à la souris fait apparaître la barre au-dessus du passage ; « … » l\'élargit sans sortir du pane', async () => {
    const { page } = h;
    await selectionner(page, 'Ligne 3 :', 'Révolution française');
    await expect(barre(page)).toBeVisible();
    // Le surlignage est dessiné par l'éditeur à la frame suivante.
    await expect.poll(async () => (await texteCompris(page)).trim()).toBe('Révolution française');
    // Pas d'encre : la sélection n'est pas un trait d'annotation.
    expect(await nbTraits(page)).toBe(0);

    // Horizontale, au-dessus du passage, centrée sur lui.
    const mot = await boiteDuMot(page, 'Ligne 3 :', 'Révolution française');
    const avant = (await barre(page).boundingBox())!;
    expect(avant.width).toBeGreaterThan(avant.height);
    expect(avant.y + avant.height).toBeLessThanOrEqual(mot.y + 1);
    expect(Math.abs(avant.x + avant.width / 2 - (mot.x + mot.width / 2))).toBeLessThan(2);

    await plus(page).click();
    await expect(plus(page)).toBeHidden();
    await expect(barre(page).locator('[aria-label="Résumer"]')).toBeVisible();
    await expect.poll(async () => (await barre(page).boundingBox())!.width).toBeGreaterThan(avant.width + 60);
    const apres = (await barre(page).boundingBox())!;
    const pane = (await page.locator('.view-content:has(.agent-barre)').boundingBox())!;
    expect(apres.height).toBeCloseTo(avant.height, 0);
    expect(apres.x).toBeGreaterThanOrEqual(pane.x);
    expect(apres.x + apres.width).toBeLessThanOrEqual(pane.x + pane.width);
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

test('pas de croix : un clic à côté ferme la barre sans dessiner, la barre d\'annotation ne la ferme pas ; chat ouvert, rien ne se ferme', async () => {
    const { page } = h;
    await surligner(page, 'Ligne 3 :', 'Révolution');
    await expect(barre(page)).toBeVisible();
    await expect(barre(page).locator('[aria-label="Fermer"]')).toHaveCount(0);
    expect(await nbTraits(page)).toBe(1);

    // Une couleur de la barre d'annotation : la barre de l'agent reste.
    await page.locator('.toolbar:not(.agent-barre) .toolbar-item').first().click();
    await expect(barre(page)).toBeVisible();

    // Surligneur armé : le clic qui ferme ne dessine rien ; le trait suivant, si.
    await clicACote(page);
    await expect(barre(page)).toHaveCount(0);
    await page.waitForTimeout(200);
    expect(await nbTraits(page)).toBe(1);
    await surligner(page, 'Ligne 12 :', 'commence');
    await expect.poll(() => nbTraits(page)).toBe(2);

    // Chat ouvert : un clic à côté ne dessine rien et ne ferme ni la barre ni le chat.
    await ouvrirChat(page);
    await clicACote(page);
    await page.waitForTimeout(200);
    expect(await nbTraits(page)).toBe(2);
    await expect(barre(page)).toBeVisible();
    await expect(bulle(page)).toBeVisible();
});

test('un simple clic ou une sélection au clavier ne montrent rien', async () => {
    const { page } = h;
    await desarmer(page);
    const b = await boiteDuMot(page, 'Ligne 3 :', 'Révolution');
    await page.mouse.click(b.x + 5, b.y + b.height / 2);
    await page.waitForTimeout(200);
    await expect(barre(page)).toHaveCount(0);
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
