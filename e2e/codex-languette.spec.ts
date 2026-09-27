import { test, expect, type Page } from '@playwright/test';
import { lancerInstallee, type Harnais } from './hone-commun';

/**
 * La languette du panneau Codex, dans l'app installée sur une copie complète de
 * fragment-notes, avec le vrai Codex : elle ferme et rouvre le panneau, et fermer
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

/** Écart entre le bord droit de la languette et le bord gauche du dock droit, et la largeur du dock. */
async function mesure(page: Page) {
    return page.evaluate(() => {
        const l = document.querySelector('.codex-languette')!.getBoundingClientRect();
        const d = (window as unknown as Fenetre).app.workspace.rightSplit.containerEl.getBoundingClientRect();
        return { ecart: Math.abs(l.right - d.left), dock: d.width, droite: window.innerWidth - l.right,
            milieu: Math.abs((l.top + l.height / 2) - (d.top + d.height / 2)) };
    });
}

async function attendreFinDuPli(page: Page) { await page.waitForTimeout(400); }

/** Son coffre restaure parfois le panneau déjà ouvert : on part panneau fermé. */
async function partirFerme(page: Page) {
    const languette = page.locator('.codex-languette');
    await attendreFinDuPli(page);
    if (await languette.getAttribute('aria-label') === 'Fermer Codex') {
        await languette.click();
        await attendreFinDuPli(page);
    }
    await expect(languette).toHaveAttribute('aria-label', 'Ouvrir Codex');
}

test('la languette ferme et rouvre Codex, sans couper la conversation', async () => {
    const { page } = h;
    const languette = page.locator('.codex-languette');
    await expect(languette).toBeVisible();
    await partirFerme(page);

    // Ouvrir par la languette.
    await languette.click();
    await expect(page.locator('.codex-panel')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.codex-header__status')).toHaveText('ready', { timeout: 30_000 });
    await attendreFinDuPli(page);
    await expect(languette).toHaveAttribute('aria-label', 'Fermer Codex');
    let m = await mesure(page);
    expect(m.dock).toBeGreaterThan(150);
    expect(m.ecart).toBeLessThan(1);
    expect(m.milieu).toBeLessThan(1);
    await page.screenshot({ path: 'test-results/hone-languette-ouverte.png' });

    const r1 = await demander(page, 'Retiens le mot « cerise ». Réponds seulement : OK');
    await expect(r1).toContainText('OK');

    // Fermer par la languette : le dock se replie, la languette reste au bord de la fenêtre.
    await languette.click();
    await attendreFinDuPli(page);
    await expect(languette).toHaveAttribute('aria-label', 'Ouvrir Codex');
    m = await mesure(page);
    expect(m.dock).toBeLessThan(1);
    expect(m.droite).toBeLessThan(1);
    await page.screenshot({ path: 'test-results/hone-languette-fermee.png' });

    // Rouvrir : même conversation, même fil.
    await languette.click();
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

test('la languette dans les deux thèmes', async () => {
    const { page } = h;
    const languette = page.locator('.codex-languette');
    await partirFerme(page);
    for (const theme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: theme });
        await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
        await attendreFinDuPli(page);
        const boite = (await languette.boundingBox())!;
        await page.screenshot({ path: `test-results/hone-languette-fermee-${theme}.png`,
            clip: { x: boite.x - 200, y: boite.y - 60, width: 200 + boite.width, height: boite.height + 120 } });
        await languette.click();
        await expect(page.locator('.codex-panel')).toBeVisible({ timeout: 10_000 });
        await attendreFinDuPli(page);
        const b2 = (await languette.boundingBox())!;
        await page.screenshot({ path: `test-results/hone-languette-ouverte-${theme}.png`,
            clip: { x: b2.x - 120, y: b2.y - 120, width: 480, height: b2.height + 240 } });
        await page.screenshot({ path: `test-results/hone-languette-page-${theme}.png` });
        await languette.click();
        await attendreFinDuPli(page);
    }
});
