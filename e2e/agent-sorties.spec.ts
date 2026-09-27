import { test, expect, type Page } from '@playwright/test';
import path from 'path';
import { barre, carte, carteOuverte, lancer, outilPuisFermer, surligner, tracesVisibles, type Harnais } from './hone-commun';

/**
 * Les sorties structurées de l'agent, en factice : le dessin de Visualiser nettoyé dans la
 * carte, le globe d'une réponse du web, l'indice qui s'arrête, et leur retour depuis la marge.
 * AGENT_CAPTURES=<dossier> garde une capture de chaque carte, dans les deux thèmes.
 */

let h: Harnais;
test.beforeEach(async () => { h = await lancer(); });
test.afterEach(async () => { await h.electronApp.close(); });

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
