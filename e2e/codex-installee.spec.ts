import { test, expect } from '@playwright/test';
import { barre, bulle, carte, lancerInstallee, selectionnerInstallee, type Harnais } from './hone-commun';

/**
 * Hone par le vrai Codex (compte ChatGPT, pas de clé API), dans l'app installée
 * (/Applications/Fragment.app) sur une copie complète de fragment-notes : le panneau
 * Codex du dock, la bulle, et un outil de la barre. Plus aucun « factice ».
 */

const NOTE = {
    chemin: 'note-codex.md',
    ligne: 'Ligne 2',
    contenu: [
        '# Test de la bulle Codex',
        '',
        'Ligne 2 : la photosynthèse transforme la lumière en énergie chimique.',
        '',
        'Ligne 4 : la Révolution française commence en 1789.',
    ].join('\n'),
};

// Copier tout le coffre et lancer l'app prend plus que les 30 s par défaut ; Codex aussi.
test.describe.configure({ timeout: 240_000 });

let h: Harnais;
test.beforeEach(async () => { h = await lancerInstallee(NOTE); });
test.afterEach(async () => { await h?.electronApp.close(); });

// Son workspace.json gardait une feuille Codex posée hors d'une pile, restaurée à 0 × 0 :
// seule une copie de SON coffre le montre.
test('la commande ouvre le panneau Codex, visible, connecté, et il répond', async () => {
    const { page } = h;
    await page.evaluate(() => (window as unknown as { app: any }).app.commands.executeCommandById('hone:open-codex-panel'));
    const panneau = page.locator('.codex-panel');
    await expect(panneau).toBeVisible({ timeout: 10_000 });
    // Le dock s'élargit en s'ouvrant : on mesure une fois l'animation finie.
    await expect.poll(async () => (await panneau.boundingBox())?.width ?? 0).toBeGreaterThan(150);
    const box = (await panneau.boundingBox())!;
    expect(box.height).toBeGreaterThan(150);
    await expect(page.locator('.codex-header__status')).toHaveText('ready', { timeout: 20_000 });
    await page.locator('.codex-composer__input').fill('Réponds seulement : OK');
    await page.locator('.codex-composer__input').press('Enter');
    await expect(page.locator('.codex-msg--user')).toHaveText('Réponds seulement : OK');
    await expect(page.locator('.codex-msg--assistant').last()).toContainText('OK', { timeout: 60_000 });
});

test('la bulle répond par Codex, sur le passage sélectionné', async () => {
    const { page } = h;
    await selectionnerInstallee(page, 'Ligne 2', 'la photosynthèse transforme la lumière en énergie chimique');
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

    // L'assistant s'appelle Hone, pas Codex.
    await bulle(page).locator('.agent-bulle-champ').fill('Qui es-tu ? Réponds en une phrase.');
    await bulle(page).locator('.agent-bulle-champ').press('Enter');
    const nom = bulle(page).locator('.agent-message.mod-agent').last();
    await expect(nom).not.toHaveClass(/is-pending/, { timeout: 120_000 });
    console.log('IDENTITE', await nom.textContent());
    await expect(nom).toContainText('Hone');
    await expect(nom).not.toContainText('Codex');
});

test('Traduire traduit le passage entouré, par Codex', async () => {
    const { page } = h;
    await selectionnerInstallee(page, 'Ligne 4', 'la Révolution française commence en 1789');
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
