import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { bulle, lancerInstallee, selectionnerInstallee, type Harnais } from './hone-commun';

/**
 * L'atelier et la mémoire par le vrai Codex, dans l'app installée : depuis le retrait du
 * moteur OpenAI, leurs outils passent à Codex (codex/profils.ts, bornesDe). Une fonction
 * se crée puis se réutilise d'une question à l'autre, une préférence dite est retenue.
 * La preuve est sur le disque : data.json (bibliothèque, préférences) et memoire.jsonl
 * (les outils appelés à chaque échange).
 */

const NOTE = {
    chemin: 'note-atelier.md',
    ligne: 'Ligne 2',
    contenu: [
        '# Atelier',
        '',
        'Ligne 2 : un.',
        '',
        'Ligne 4 : deux.',
        'Ligne 5 : trois.',
        '',
        'Ligne 7 : quatre.',
    ].join('\n'),
};

test.describe.configure({ timeout: 480_000 });

let h: Harnais;
test.beforeEach(async () => { h = await lancerInstallee(NOTE); });
test.afterEach(async () => { await h?.electronApp.close(); });

const dossier = () => path.join(h.vault, '.fragment/plugins/hone');
const donnees = async () => JSON.parse(await readFile(path.join(dossier(), 'data.json'), 'utf8'));
/** Les outils appelés au dernier échange, d'après la mémoire. */
async function outilsDuDernier(): Promise<string[]> {
    const lignes = (await readFile(path.join(dossier(), 'memoire.jsonl'), 'utf8')).trim().split('\n');
    return JSON.parse(lignes.at(-1)!).outils;
}

async function demander(page: Page, question: string): Promise<string> {
    const lue = async () => (await readFile(path.join(dossier(), 'memoire.jsonl'), 'utf8').catch(() => '')).length;
    const taille = await lue();
    await bulle(page).locator('.agent-bulle-champ').fill(question);
    await bulle(page).locator('.agent-bulle-champ').press('Enter');
    const reponse = bulle(page).locator('.agent-message.mod-agent').last();
    await expect(reponse).not.toHaveClass(/is-pending/, { timeout: 180_000 });
    await expect(reponse).not.toHaveClass(/is-error/);
    // La mémoire note l'échange juste après la réponse.
    await expect.poll(lue, { timeout: 10_000 }).toBeGreaterThan(taille);
    return (await reponse.textContent()) ?? '';
}

test('Codex se fabrique une fonction, la réutilise, et retient une préférence', async () => {
    const { page } = h;
    await selectionnerInstallee(page, 'Ligne 2', 'un');
    await page.click('.agent-barre [aria-label="Discuter avec Hone"]');
    await expect(bulle(page)).toBeVisible();

    const avant = ((await donnees()).atelier?.fonctions?.chat ?? []).length;
    const premiere = await demander(page, 'Fabrique-toi dans ton atelier une fonction compter_lignes_non_vides (args : chemin) '
        + 'qui compte les lignes non vides d\'une note du vault, puis appelle-la sur note-atelier.md et donne le nombre.');
    console.log('PREMIERE', premiere, await outilsDuDernier());
    expect(await outilsDuDernier()).toContain('create_function');
    const fonctions = (await donnees()).atelier.fonctions.chat as { nom: string; usage: { appels: number } }[];
    expect(fonctions.length).toBe(avant + 1);
    expect(premiere).toContain('5');

    const seconde = await demander(page, 'Combien de lignes non vides a note-atelier.md ? Sers-toi de ta bibliothèque.');
    console.log('SECONDE', seconde, await outilsDuDernier());
    expect(await outilsDuDernier()).toContain('call_function');
    expect(await outilsDuDernier()).not.toContain('create_function');
    expect(((await donnees()).atelier.fonctions.chat as unknown[]).length).toBe(avant + 1);

    const troisieme = await demander(page, 'Retiens pour la suite : je veux des réponses d\'une seule phrase.');
    console.log('TROISIEME', troisieme, await outilsDuDernier());
    expect(await outilsDuDernier()).toContain('note_preference');
    expect((await donnees()).preferences.join(' ')).toMatch(/phrase/i);
    await page.screenshot({ path: 'test-results/hone-atelier-codex.png' });
});
