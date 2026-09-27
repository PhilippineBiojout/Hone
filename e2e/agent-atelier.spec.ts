import { test, expect, type Page } from '@playwright/test';
import { lancer, type Harnais } from './hone-commun';

/**
 * L'atelier dans le vrai renderer d'Electron : la seule preuve que le bac à sable
 * est fermé là où il compte (les tests unitaires tournent sous Node). Les fonctions
 * sont posées d'avance dans data.json, en mode factice : aucune clé, aucun appel.
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

const lancerCommande = (page: Page, id: string) => page.evaluate((i) =>
    (window as unknown as { app: any }).app.commands.executeCommandById(i), id);

const commandes = (page: Page): Promise<string[]> => page.evaluate(() =>
    (window as unknown as { app: any }).app.commands.listCommands().map((c: { id: string }) => c.id));

test.describe('atelier de Hone', () => {
    let h: Harnais;
    test.beforeAll(async () => {
        h = await lancer({
            note: '# Note de test\nLa Révolution française commence en 1789.',
            donnees: { atelier: { version: 1, fonctions: FONCTIONS } },
            editeur: false,
        });
        await h.page.waitForFunction(() =>
            (window as unknown as { app?: any }).app?.commands?.listCommands?.().some((c: { id: string }) => c.id === 'hone:chat-sonde'),
        undefined, { timeout: 30_000 });
    });
    test.afterAll(async () => { await h?.electronApp.close(); });

    test('les fonctions apprises sont des commandes de la palette, et la liste blanche d\'affichage existe', async () => {
        const ids = await commandes(h.page);
        expect(ids).toEqual(expect.arrayContaining(['hone:chat-sonde', 'hone:chat-boucle']));
        // Si le cœur renomme une commande de la liste blanche (atelier/courtier.ts), c'est ici que ça casse.
        for (const id of ['workspace:new-tab', 'app:toggle-left-sidebar', 'app:toggle-right-sidebar', 'command-palette:open']) {
            expect(ids, `commandes du cœur : ${ids.filter((i) => !i.startsWith('hone:')).join(', ')}`).toContain(id);
        }
    });

    test('dans le renderer, le bac à sable ne sort pas de Fragment, et une boucle infinie est tuée sans geler l\'app', async () => {
        expect(await lancerCommande(h.page, 'hone:chat-sonde')).toBe(true);
        const notice = h.page.locator('.notice', { hasText: 'sonde' }).last();
        await expect(notice).toBeVisible({ timeout: 10_000 });
        const texte = (await notice.textContent()) ?? '';
        expect(texte).not.toMatch(/échoué/);
        expect(JSON.parse(texte.slice(texte.indexOf('{')))).toEqual(FERME);

        await lancerCommande(h.page, 'hone:chat-boucle');
        // Pendant la boucle, la page répond encore.
        const debut = Date.now();
        expect(await h.page.evaluate(() => 1 + 1)).toBe(2);
        expect(Date.now() - debut).toBeLessThan(1000);
        await expect(h.page.locator('.notice', { hasText: 'boucle a échoué' })).toContainText('Temps dépassé', { timeout: 10_000 });
    });
});
