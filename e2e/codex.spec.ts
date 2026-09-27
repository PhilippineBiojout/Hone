import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import { cp, mkdtemp, mkdir, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

/**
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
            if (w.url().includes('localhost:5123')) return w;
        }
        await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error('fenêtre app introuvable');
}

async function lancer(): Promise<Harnais> {
    const base = await mkdtemp(path.join(os.tmpdir(), 'prom-agent-'));
    const vault = path.join(base, 'vault');
    const userData = path.join(base, 'userdata');

    await mkdir(vault, { recursive: true });
    await mkdir(userData, { recursive: true });
    await writeFile(path.join(vault, 'note.md'), CONTENU, 'utf8');
    await cp('/Users/philippinebiojout/Documents/IA/fragment-notes/.fragment/plugins/hone', path.join(vault, '.fragment/plugins/hone'), { recursive: true, // Ni node_modules, ni le .env (la clé ne sort pas du plugin : sans lui, l'agent répond en factice), ni le journal des coûts.
        filter: (src) => !src.includes('node_modules') && !/[\\/](\.env|couts\.jsonl)$/.test(src) });
    // Depuis le cœur 3c4dbe4, un coffre sans community-plugins.json est en mode restreint : rien ne se charge.
    await writeFile(path.join(vault, '.fragment/community-plugins.json'), JSON.stringify(['hone']), 'utf8');
    await writeFile(path.join(userData, 'config.json'), JSON.stringify({ vaultRoot: vault }), 'utf8');

    const electronApp = await _electron.launch({
        args: ['.', `--user-data-dir=${userData}`],
        env: { ...process.env, NODE_ENV: 'development' } as Record<string, string>,
    });

    const page = await fenetreApp(electronApp);
    await page.waitForFunction(
        () => {
            const w = window as unknown as { app?: any };
            const leaves = w.app?.workspace?.getLeavesOfType?.('markdown') ?? [];
            return leaves.length > 0 && !!leaves[0].view?.editor;
        },
        undefined,
        { timeout: 30_000 },
    );
    // Assez large pour la colonne, la barre et le chat côte à côte.
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
