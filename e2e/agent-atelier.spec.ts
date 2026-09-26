import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import { cp, mkdtemp, mkdir, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

/**
 * L'atelier dans le vrai renderer d'Electron : la seule preuve que le bac à sable
 * est fermé là où il compte (les tests unitaires tournent sous Node). Les fonctions
 * sont posées d'avance dans data.json, en mode factice : aucune clé, aucun appel.
 *
 *     npx playwright test e2e/agent-atelier.spec.ts --workers=1
 */

const usage = { appels: 0, reussites: 0, echecs: 0 };
const dates = { creeLe: '2026-09-26T00:00:00.000Z', majLe: '2026-09-26T00:00:00.000Z' };
const sansArgs = { type: 'object', properties: {} };

/** Tout ce qu'une fonction pourrait tenter pour sortir de Fragment. */
const SONDE = `
    const essai = async (f) => { try { await f(); return 'ouvert'; } catch (e) { return 'fermé'; } };
    return {
        fetch: typeof fetch, websocket: typeof WebSocket, xhr: typeof XMLHttpRequest, require: typeof require,
        process: typeof process, importScripts: typeof importScripts, worker: typeof Worker,
        importData: await essai(() => import('data:text/javascript,export default 1')),
        importWeb: await essai(() => import('https://example.com/x.js')),
        global: typeof Function('return this')().fetch,
        lu: (await hone.vault.lire('note.md')).slice(0, 6),
        cache: await essai(() => hone.vault.lire('.fragment/plugins/hone/data.json')),
    };`;
const FERME = {
    fetch: 'undefined', websocket: 'undefined', xhr: 'undefined', require: 'undefined', process: 'undefined',
    importScripts: 'undefined', worker: 'undefined', importData: 'fermé', importWeb: 'fermé', global: 'undefined',
    lu: '# Note', cache: 'fermé',
};

const FONCTIONS = {
    chat: [
        {
            nom: 'sonde', description: 'Sonde de test : tente de sortir du bac à sable et rend ce qu\'elle a trouvé.',
            parametres: sansArgs, code: SONDE,
            tests: [{ args: {}, attendu: FERME }, { args: {}, attendu: FERME }], argsCommande: {}, usage, ...dates,
        },
        {
            nom: 'boucle', description: 'Boucle infinie volontaire, pour vérifier que l\'app ne gèle pas.',
            parametres: sansArgs, code: 'while (true) {}',
            tests: [{ args: {}, attendu: 0 }, { args: {}, attendu: 0 }], argsCommande: {}, usage, ...dates,
        },
    ],
};

interface Harnais { electronApp: ElectronApplication; page: Page }

async function fenetreApp(electronApp: ElectronApplication): Promise<Page> {
    const fin = Date.now() + 30_000;
    while (Date.now() < fin) {
        for (const w of electronApp.windows()) if (w.url().includes('localhost:5123')) return w;
        await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error('fenêtre app introuvable');
}

async function lancer(): Promise<Harnais> {
    const base = await mkdtemp(path.join(os.tmpdir(), 'prom-atelier-'));
    const vault = path.join(base, 'vault');
    const userData = path.join(base, 'userdata');
    const plugin = path.join(vault, '.fragment/plugins/hone');
    await mkdir(vault, { recursive: true });
    await mkdir(userData, { recursive: true });
    await writeFile(path.join(vault, 'note.md'), '# Note de test\nLa Révolution française commence en 1789.', 'utf8');
    await cp('/Users/philippinebiojout/Documents/IA/fragment-notes/.fragment/plugins/hone', plugin, {
        recursive: true,
        // Ni node_modules, ni les données réelles (la clé ne sort pas du plugin).
        filter: (src) => !src.includes('node_modules') && !/[\\/](data\.json|memoire\.jsonl)$/.test(src),
    });
    await writeFile(path.join(plugin, 'data.json'), JSON.stringify({ factice: true, atelier: { version: 1, fonctions: FONCTIONS } }), 'utf8');
    await writeFile(path.join(userData, 'config.json'), JSON.stringify({ vaultRoot: vault }), 'utf8');

    const electronApp = await _electron.launch({
        args: ['.', `--user-data-dir=${userData}`],
        env: { ...process.env, NODE_ENV: 'development' } as Record<string, string>,
    });
    const page = await fenetreApp(electronApp);
    await page.waitForFunction(() => {
        const w = window as unknown as { app?: any };
        return (w.app?.commands?.listCommands?.() ?? []).some((c: { id: string }) => c.id === 'hone:chat-sonde');
    }, undefined, { timeout: 30_000 });
    return { electronApp, page };
}

const lancerCommande = (page: Page, id: string) => page.evaluate((i) => {
    const w = window as unknown as { app: any };
    return w.app.commands.executeCommandById(i);
}, id);

test.describe('atelier de Hone', () => {
    let h: Harnais;
    test.beforeAll(async () => {
        h = await lancer();
    });
    test.afterAll(async () => {
        await h?.electronApp.close();
    });

    test('les fonctions apprises sont des commandes de la palette', async () => {
        const ids = await h.page.evaluate(() => (window as unknown as { app: any }).app.commands.listCommands().map((c: { id: string }) => c.id));
        expect(ids).toEqual(expect.arrayContaining(['hone:chat-sonde', 'hone:chat-boucle']));
    });

    test('la liste blanche d\'affichage existe dans le vrai registre', async () => {
        const ids: string[] = await h.page.evaluate(() => (window as unknown as { app: any }).app.commands.listCommands().map((c: { id: string }) => c.id));
        // Journalisé pour relire les ids réels si le cœur en renomme un.
        console.log('commandes du cœur :', ids.filter((i) => !i.startsWith('hone:')).join(', '));
        for (const id of ['workspace:new-tab', 'app:toggle-left-sidebar', 'app:toggle-right-sidebar', 'command-palette:open']) {
            expect(ids).toContain(id);
        }
    });

    test('dans le renderer, le bac à sable ne sort pas de Fragment', async () => {
        expect(await lancerCommande(h.page, 'hone:chat-sonde')).toBe(true);
        const notice = h.page.locator('.notice', { hasText: 'sonde' }).last();
        await expect(notice).toBeVisible({ timeout: 10_000 });
        const texte = (await notice.textContent()) ?? '';
        expect(texte).not.toMatch(/échoué/);
        const json = JSON.parse(texte.slice(texte.indexOf('{')));
        expect(json).toEqual(FERME);
    });

    test('une boucle infinie est tuée sans geler l\'app', async () => {
        await lancerCommande(h.page, 'hone:chat-boucle');
        // Pendant la boucle, la page répond encore.
        const debut = Date.now();
        expect(await h.page.evaluate(() => 1 + 1)).toBe(2);
        expect(Date.now() - debut).toBeLessThan(1000);
        await expect(h.page.locator('.notice', { hasText: 'boucle a échoué' })).toContainText('Temps dépassé', { timeout: 10_000 });
    });
});
