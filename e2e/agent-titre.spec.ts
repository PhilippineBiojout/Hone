import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'fs/promises';
import path from 'path';
import { armer, barre, boiteDuMot, bulle, carte, lancer, ouvrirChat, trace, traces, type Harnais } from './hone-commun';

/**
 * La tête du chat et des cartes (ui/texteLisible.ts) : jamais de Markdown brut, puis le sujet
 * écrit par Hone, « Question sur … » pour le chat et « Définir : … » pour une carte. Le sujet se
 * garde avec la réponse : l'icône de la marge le dit, et le rouvre sans le redemander.
 *
 * En factice (pas d'appel réel), le sujet vaut « le sujet factice » suivi des premiers mots.
 */

const NOTE = [
    '# Les machines à calculer',
    '',
    '## La Pascaline',
    '',
    'En 1642, la **Pascaline** additionne et soustrait avec des roues dentées.',
    '',
    'Fin de la note.',
].join('\n');

/** Surligne de « Pascaline » à « additionne » : le passage enjambe la fin du gras (`**`). */
async function surlignerPassage(page: Page): Promise<void> {
    await armer(page, 'Surligneur');
    const a = await boiteDuMot(page, 'En 1642', 'Pascaline');
    const b = await boiteDuMot(page, 'En 1642', 'additionne');
    const y = a.y + a.height / 2;
    const x0 = a.x + 2;
    const x1 = b.x + b.width - 2;
    await trace(page, Array.from({ length: 10 }, (_, i) => ({ x: x0 + ((x1 - x0) * i) / 9, y })));
    await expect(barre(page)).toBeVisible();
}

const teteChat = (page: Page) => bulle(page).locator('.agent-bulle-extrait');
const titreCarte = (page: Page) => carte(page).locator('.agent-action-titre');

let h: Harnais;
test.beforeEach(async () => {
    h = await lancer({ note: NOTE });
});
test.afterEach(async () => {
    await h.electronApp.close();
});

test('la tête du chat : le passage sans Markdown, puis « Question sur » le sujet', async () => {
    const { page } = h;
    await surlignerPassage(page);
    // Le passage cité porte bien du Markdown brut : c'est ce que la tête ne doit pas montrer.
    const passage = await page.evaluate(() => {
        const ed = (window as unknown as { app: any }).app.workspace.getLeavesOfType('markdown')[0].view.editor;
        return ed.cm.state.doc.toString() as string;
    });
    expect(passage).toContain('**Pascaline**');

    await ouvrirChat(page);
    await expect(teteChat(page)).not.toHaveText(/[*#]/);
    await expect(teteChat(page)).toHaveText(/^Question sur le sujet factice Pascaline/, { timeout: 4_000 });
    await expect(teteChat(page)).not.toHaveText(/[*#]/);
    expect(await teteChat(page).getAttribute('title')).not.toMatch(/[*#]/);
    // Le titre ne déborde pas : une ligne, coupée par des points de suspension.
    const box = (await teteChat(page).boundingBox())!;
    expect(box.height).toBeLessThan(30);
    await expect.poll(() => bulle(page).evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'test-results/titre-chat.png' });
});

test('une carte : « Définir » puis « Définir : » le sujet, gardé avec la réponse dans la marge', async () => {
    const { page } = h;
    await surlignerPassage(page);
    await barre(page).locator('[aria-label="Définir"]').click();
    await expect(carte(page)).toBeVisible({ timeout: 4_000 });
    await expect(titreCarte(page)).toHaveText(/^Définir : le sujet factice Pascaline/, { timeout: 4_000 });
    await expect(titreCarte(page)).not.toHaveText(/[*#]/);
    await expect.poll(() => carte(page).evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'test-results/titre-carte.png' });
    await carte(page).locator('[aria-label="Fermer"]').click();
    await expect(carte(page)).toHaveCount(0);

    // L'icône de la marge dit le même titre, et le sujet est écrit avec la réponse.
    await expect(traces(page)).toHaveCount(1);
    await expect(traces(page)).toHaveAttribute('title', /^Définir : le sujet factice Pascaline/);
    await expect.poll(async () => {
        const brut = await readFile(path.join(h.vault, '.fragment/plugins/hone/traces.json'), 'utf8').catch(() => '{}');
        return JSON.parse(brut).documents?.['note.md']?.[0]?.sujet ?? null;
    }).toMatch(/^le sujet factice Pascaline/);

    // Rouverte depuis la marge : le titre est là tout de suite, sans nouvel appel.
    await traces(page).click();
    await expect(carte(page)).toBeVisible();
    await expect(titreCarte(page)).toHaveText(/^Définir : le sujet factice Pascaline/, { timeout: 200 });

    // La carte devenue chat garde le sujet : « Question sur … ».
    await carte(page).locator('[aria-label="Discuter de cette réponse"]').click();
    await expect(bulle(page)).toBeVisible();
    await expect(teteChat(page)).toHaveText(/^Question sur le sujet factice Pascaline/, { timeout: 200 });
});
