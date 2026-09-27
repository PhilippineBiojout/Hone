import { test, expect, type Page } from '@playwright/test';
import { lancerInstallee, type Harnais } from './hone-commun';

/**
 * Le panneau Codex, dans l'app installée sur une copie complète de fragment-notes,
 * avec le vrai Codex : le ruban ferme et rouvre le panneau, et fermer
 * (replier le dock, ou même fermer la feuille) ne coupe pas Codex : la conversation
 * et le fil restent.
 */

test.describe.configure({ timeout: 300_000 });

let h: Harnais;
test.beforeEach(async () => { h = await lancerInstallee(); });
test.afterEach(async () => { await h?.electronApp.close(); });

type Fenetre = Window & { app: any };

async function demander(page: Page, texte: string) {
    const avant = await page.locator('.codex-msg--assistant').count();
    await page.locator('.codex-composer__input').fill(texte);
    await page.locator('.codex-composer__input').press('Enter');
    await expect(page.locator('.codex-header__status')).not.toHaveText('ready', { timeout: 10_000 }).catch(() => {});
    await expect(page.locator('.codex-header__status')).toHaveText(/ready|tokens/, { timeout: 120_000 });
    await expect(page.locator('.codex-msg--assistant')).toHaveCount(avant + 1, { timeout: 120_000 });
    return page.locator('.codex-msg--assistant').last();
}

async function attendreFinDuPli(page: Page) { await page.waitForTimeout(400); }

/** Le bouton du ruban (et la commande) : afficher ou masquer le panneau. */
async function basculer(page: Page) {
    await page.evaluate(() => (window as unknown as Fenetre).app.commands.executeCommandById('hone:open-codex-panel'));
    await attendreFinDuPli(page);
}

const replie = (page: Page) => page.evaluate(() => (window as unknown as Fenetre).app.workspace.rightSplit.collapsed as boolean);

/** Son coffre restaure parfois le panneau déjà ouvert : on part panneau fermé. */
async function partirFerme(page: Page) {
    await attendreFinDuPli(page);
    if (!(await replie(page)) && await page.locator('.codex-panel').isVisible()) await basculer(page);
    expect(await replie(page) || !(await page.locator('.codex-panel').isVisible())).toBe(true);
}

test('fermer et rouvrir Codex, sans couper la conversation', async () => {
    const { page } = h;
    await partirFerme(page);

    // Ouvrir par le ruban.
    await basculer(page);
    await expect(page.locator('.codex-panel')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.codex-header__status')).toHaveText('ready', { timeout: 30_000 });

    const r1 = await demander(page, 'Retiens le mot « cerise ». Réponds seulement : OK');
    await expect(r1).toContainText('OK');

    // Fermer par le ruban : le dock se replie.
    await basculer(page);
    expect(await replie(page)).toBe(true);

    // Rouvrir : même conversation, même fil.
    await basculer(page);
    await expect(page.locator('.codex-panel')).toBeVisible();
    await expect(page.locator('.codex-msg--user').first()).toContainText('cerise');
    await expect(page.locator('.codex-header__status')).not.toHaveText(/exited|error|connecting/);
    const r2 = await demander(page, 'Quel mot t\'ai-je demandé de retenir ? Réponds par ce seul mot.');
    await expect(r2).toContainText(/cerise/i);

    // Fermer la feuille elle-même, puis rouvrir par la commande : toujours là.
    await page.evaluate(() => (window as unknown as Fenetre).app.workspace.getLeavesOfType('codex-on-fragment-view')[0].detach());
    await expect(page.locator('.codex-panel')).toHaveCount(0);
    await page.evaluate(() => (window as unknown as Fenetre).app.commands.executeCommandById('hone:open-codex-panel'));
    await expect(page.locator('.codex-panel')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.codex-msg--user')).toHaveCount(2);
    const r3 = await demander(page, 'Et le mot, encore une fois ? Un seul mot.');
    await expect(r3).toContainText(/cerise/i);
});
