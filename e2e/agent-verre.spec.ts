import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import { cp, mkdtemp, mkdir, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

/**
 * La lentille de verre des barres d'outils (src/verre.ts), posée par le
 * plugin sur la barre d'annotation du cœur.
 *
 * Se lance depuis Fragment, qui porte Playwright : copier ce fichier dans
 * `Fragment/app/e2e/`, `npm run build` ici, puis depuis `Fragment/app/` :
 *     npx playwright test e2e/agent-verre.spec.ts --workers=1
 *
 * Ce que ces tests tiennent : la lentille se pose EXACTEMENT sur ce qu'on
 * survole, elle ne vole jamais un clic au bouton qu'elle recouvre, et elle
 * s'efface quand le pointeur quitte la barre. Le rendu du verre lui-même
 * (la réfraction) ne se teste pas ici : il se regarde.
 */

/** Ce que les tests touchent de `window.app`, et rien de plus. */
interface Fenetre {
    app?: {
        workspace: {
            getLeavesOfType(type: string): { view: { editor?: unknown; toggleLayer(id: string): void } }[];
        };
    };
}

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

async function lancer(): Promise<{ electronApp: ElectronApplication; page: Page }> {
    const base = await mkdtemp(path.join(os.tmpdir(), 'prom-verre-'));
    const vault = path.join(base, 'vault');
    const userData = path.join(base, 'userdata');
    await mkdir(vault, { recursive: true });
    await mkdir(userData, { recursive: true });
    await writeFile(path.join(vault, 'note.md'), '# Verre\n\nDu texte.', 'utf8');
    await cp('/Users/philippinebiojout/Documents/IA/fragment-notes/.fragment/plugins/agent', path.join(vault, '.fragment/plugins/agent'), { recursive: true,
        filter: (src) => !src.includes('node_modules') && !/[\\/](\.env|couts\.jsonl)$/.test(src) });
    await writeFile(path.join(userData, 'config.json'), JSON.stringify({ vaultRoot: vault }), 'utf8');

    const electronApp = await _electron.launch({
        args: ['.', `--user-data-dir=${userData}`],
        env: { ...process.env, NODE_ENV: 'development' } as Record<string, string>,
    });
    const page = await fenetreApp(electronApp);
    await page.waitForFunction(
        () => {
            const leaves = (window as unknown as Fenetre).app?.workspace?.getLeavesOfType?.('markdown') ?? [];
            return leaves.length > 0 && !!leaves[0].view?.editor;
        },
        undefined,
        { timeout: 30_000 },
    );
    await page.evaluate(() => {
        (window as unknown as Fenetre).app!.workspace.getLeavesOfType('markdown')[0].view.toggleLayer('annotation');
    });
    await page.waitForSelector('.toolbar .toolbar-glass', { state: 'attached' });
    return { electronApp, page };
}

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

test.describe('lentille de la toolbar', () => {
    let electronApp: ElectronApplication;
    let page: Page;

    test.beforeEach(async () => {
        ({ electronApp, page } = await lancer());
    });

    test.afterEach(async () => {
        await electronApp.close();
    });

    test('se pose sur le bouton survolé, puis sur le suivant', async () => {
        const glass = page.locator('.toolbar-glass');
        await expect(glass).not.toHaveClass(/is-visible/);

        await page.hover('.toolbar-item[aria-label="Crayon"]');
        await expect(glass).toHaveClass(/is-visible/);
        await expect.poll(() => alignee(page, '.toolbar-item[aria-label="Crayon"]')).toBe(true);

        await page.hover('.toolbar-option[aria-label="Vert"]');
        await expect.poll(() => alignee(page, '.toolbar-option[aria-label="Vert"]')).toBe(true);
    });

    test('ne vole pas le clic du bouton qu\'elle recouvre', async () => {
        await page.hover('.toolbar-item[aria-label="Gomme"]');
        await page.waitForTimeout(400);
        await page.click('.toolbar-item[aria-label="Gomme"]');
        await expect(page.locator('.toolbar-item[aria-label="Gomme"]')).toHaveClass(/is-active/);
    });

    test('s\'efface quand le pointeur quitte la barre', async () => {
        await page.hover('.toolbar-item[aria-label="Crayon"]');
        await expect(page.locator('.toolbar-glass')).toHaveClass(/is-visible/);
        await page.mouse.move(5, 5);
        await expect(page.locator('.toolbar-glass')).not.toHaveClass(/is-visible/);
    });

    test('une seule lentille, même après avoir refermé et rouvert le calque', async () => {
        await page.evaluate(() => {
            const view = (window as unknown as Fenetre).app!.workspace.getLeavesOfType('markdown')[0].view;
            view.toggleLayer('annotation');
            view.toggleLayer('annotation');
        });
        await page.waitForSelector('.toolbar .toolbar-glass', { state: 'attached' });
        expect(await page.locator('.toolbar-glass').count()).toBe(1);
    });
});
