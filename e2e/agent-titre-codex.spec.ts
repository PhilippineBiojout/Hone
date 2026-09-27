import { test, expect } from '@playwright/test';
import { barre, bulle, lancerInstallee, ouvrirChat, selectionnerInstallee } from './hone-commun';

/**
 * Un vrai titre écrit par Codex, dans l'app installée sur une copie de fragment-notes : deux
 * passages qui ne nomment pas leur sujet, sélectionnés à la souris. Appelle le vrai Codex, un
 * appel court chacun.
 */

const CAS = [
    { doc: "Histoire de l'informatique/01 Les machines à calculer.md", ligne: 'roues dentées',
        passage: "C'est une machine à roues dentées qui additionne et soustrait", capture: 'titre-codex-1' },
    { doc: "Histoire de l'informatique/02 Les premiers ordinateurs.md", ligne: 'machine abstraite',
        passage: 'un ruban infini découpé en cases', capture: 'titre-codex-2' },
];

for (const cas of CAS) test(`Codex écrit le sujet du passage « ${cas.passage} »`, async () => {
    const h = await lancerInstallee();
    try {
        const { page } = h;
        await page.evaluate((c) => {
            const app = (window as unknown as { app: any }).app;
            return app.workspace.getLeaf('tab').openFile(app.vault.getFileByPath(c));
        }, cas.doc);
        await page.locator('.cm-line:visible', { hasText: cas.ligne }).first().waitFor();
        await selectionnerInstallee(page, cas.ligne, cas.passage);
        await expect(barre(page)).toBeVisible();
        await ouvrirChat(page);
        const tete = bulle(page).locator('.agent-bulle-extrait');
        await expect(tete).toHaveText(/^Question sur /, { timeout: 60_000 });
        await expect(tete).not.toHaveText(/[*#]/);
        console.log('TITRE', cas.passage, '→', await tete.textContent());
        await expect.poll(() => bulle(page).evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
        await page.waitForTimeout(400);
        await page.screenshot({ path: `test-results/${cas.capture}.png` });
    } finally {
        await h.electronApp.close();
    }
});
