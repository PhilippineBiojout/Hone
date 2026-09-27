import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import { cp, mkdtemp, mkdir, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

/**
 * Le panneau Codex dans l'app installée (/Applications/Fragment.app) sur une copie
 * complète de fragment-notes : son workspace.json gardait la feuille Codex posée
 * directement dans le dock (ancien code), restaurée à 0 × 0.
 *
 * Le panneau Codex (src/codex/) : la commande l'ouvre dans le dock droit, il
 * lance `codex app-server` et arrive à « ready ». Appelle le vrai binaire codex
 * (connexion, thread, puis un vrai message).
 *
 * Se lance comme agent-widget.spec.ts, dont le harnais est recopié :
 *     npx playwright test e2e/hone-codex.spec.ts --workers=1
 */

const NB_LIGNES = 200;
const CONTENU = Array.from({ length: NB_LIGNES }, (_, i) =>
    i === 0
        ? '# Document de test pour l\'agent'
        : `Ligne ${i} : la Révolution française commence en 1789.`,
).join('\n');

interface Harnais {
    electronApp: ElectronApplication;
    page: Page;
}

async function fenetreApp(electronApp: ElectronApplication): Promise<Page> {
    const fin = Date.now() + 30_000;
    while (Date.now() < fin) {
        for (const w of electronApp.windows()) {
            if (!w.url().startsWith('devtools')) return w;
        }
        await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error('fenêtre app introuvable');
}

async function lancer(disposition?: unknown): Promise<Harnais> {
    const base = await mkdtemp(path.join(os.tmpdir(), 'prom-agent-'));
    const vault = path.join(base, 'vault');
    const userData = path.join(base, 'userdata');
    await mkdir(userData, { recursive: true });
    // Copie fidèle du coffre de Philippine (disposition et plugins compris), sans node_modules ni data.json de Hone.
    await cp('/Users/philippinebiojout/Documents/IA/fragment-notes', vault, { recursive: true,
        filter: (src) => !src.includes('node_modules') && !src.includes('/.git') });
    await writeFile(path.join(userData, 'config.json'), JSON.stringify({ vaultRoot: vault }), 'utf8');
    const electronApp = await _electron.launch({
        executablePath: '/Applications/Fragment.app/Contents/MacOS/Fragment',
        args: [`--user-data-dir=${userData}`, `--vault-root=${vault}`],
        env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: process.env.HOME! } as Record<string, string>,
    });

    const page = await fenetreApp(electronApp);
    await page.waitForFunction(() => !!(window as any).app?.workspace, undefined, { timeout: 30_000 });
    await page.setViewportSize({ width: 1400, height: 800 });
    return { electronApp, page };
}

test('la commande ouvre le panneau Codex, visible et connecté', async () => {
    const { electronApp, page } = await lancer();
    try {
        // Hone branche Codex en fin de onload (après reMarkable) : on attend la commande.
        await page.waitForFunction(() => !!(window as unknown as { app: any }).app.commands.findCommand('hone:open-codex-panel'), undefined, { timeout: 30_000 });
        await page.evaluate(() => (window as unknown as { app: any }).app.commands.executeCommandById('hone:open-codex-panel'));
        const panneau = page.locator('.codex-panel');
        await expect(panneau).toBeVisible({ timeout: 10_000 });
        const box = await panneau.boundingBox();
        expect(box!.width).toBeGreaterThan(150);
        expect(box!.height).toBeGreaterThan(150);
        await expect(page.locator('.codex-header__status')).toHaveText('ready', { timeout: 20_000 });
        await expect(page.locator('.codex-composer__input')).toBeEnabled();

        // Un vrai tour : Codex répond dans une bulle, puis le panneau revient à « ready ».
        await page.locator('.codex-composer__input').fill('Réponds seulement : OK');
        await page.locator('.codex-composer__input').press('Enter');
        await expect(page.locator('.codex-msg--user')).toHaveText('Réponds seulement : OK');
        await expect(page.locator('.codex-msg--assistant').last()).toContainText('OK', { timeout: 60_000 });
        await expect(page.locator('.codex-header__status')).not.toHaveText('thinking…', { timeout: 60_000 });
        await page.screenshot({ path: 'test-results/hone-codex.png' });
    } finally {
        await electronApp.close();
    }
});

