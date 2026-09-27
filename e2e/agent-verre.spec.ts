import { test, expect, type Page } from '@playwright/test';
import { lancer, type Harnais } from './hone-commun';

/**
 * La lentille de verre des barres d'outils (src/verre.ts), posée par le
 * plugin sur la barre d'annotation du cœur.
 *
 * Ce que ces tests tiennent : la lentille se pose EXACTEMENT sur ce qu'on
 * survole, elle ne vole jamais un clic au bouton qu'elle recouvre, et elle
 * s'efface quand le pointeur quitte la barre. Le rendu du verre lui-même
 * (la réfraction) ne se teste pas ici : il se regarde.
 */

/** La lentille couvre-t-elle exactement l'élément, au demi-pixel près ? */
async function alignee(page: Page, selecteur: string): Promise<boolean> {
    return page.evaluate((sel) => {
        const r = (el: Element) => {
            const b = el.getBoundingClientRect();
            return [b.left, b.top, b.width, b.height].map((v) => Math.round(v * 2) / 2).join();
        };
        return r(document.querySelector('.toolbar-glass')!) === r(document.querySelector(sel)!);
    }, selecteur);
}

const verre = (page: Page) => page.locator('.toolbar-glass');

let h: Harnais;
test.beforeEach(async () => {
    h = await lancer({ note: '# Verre\n\nDu texte.' });
    await h.page.waitForSelector('.toolbar .toolbar-glass', { state: 'attached' });
});
test.afterEach(async () => { await h.electronApp.close(); });

test('la lentille se pose sur le bouton survolé, puis sur le suivant, et s\'efface quand le pointeur quitte la barre', async () => {
    const { page } = h;
    await expect(verre(page)).not.toHaveClass(/is-visible/);
    await page.hover('.toolbar-item[aria-label="Crayon"]');
    await expect(verre(page)).toHaveClass(/is-visible/);
    await expect.poll(() => alignee(page, '.toolbar-item[aria-label="Crayon"]')).toBe(true);
    await page.hover('.toolbar-option[aria-label="Vert"]');
    await expect.poll(() => alignee(page, '.toolbar-option[aria-label="Vert"]')).toBe(true);
    await page.mouse.move(5, 5);
    await expect(verre(page)).not.toHaveClass(/is-visible/);
});

test('elle ne vole pas le clic du bouton qu\'elle recouvre, et reste seule après avoir refermé et rouvert le calque', async () => {
    const { page } = h;
    await page.hover('.toolbar-item[aria-label="Gomme"]');
    await page.waitForTimeout(400);
    await page.click('.toolbar-item[aria-label="Gomme"]');
    await expect(page.locator('.toolbar-item[aria-label="Gomme"]')).toHaveClass(/is-active/);

    await page.evaluate(() => {
        const view = (window as unknown as { app: any }).app.workspace.getLeavesOfType('markdown')[0].view;
        view.toggleLayer('annotation');
        view.toggleLayer('annotation');
    });
    await page.waitForSelector('.toolbar .toolbar-glass', { state: 'attached' });
    expect(await verre(page).count()).toBe(1);
});
