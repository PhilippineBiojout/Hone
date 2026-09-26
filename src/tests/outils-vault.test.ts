import { describe, expect, it } from 'vitest';
import { CARACTERES_MAX, chercherDansLeVault, lireDocument } from '../cerveau/outils-vault';
import type { AccesVault } from '../cerveau/vault';

/** Un faux vault en mémoire : chemin relatif → contenu. */
function fauxVault(fichiers: Record<string, string>): AccesVault {
    return {
        fichiers: () => Object.keys(fichiers).sort(),
        lire: async (rel) => (rel in fichiers ? fichiers[rel] : null),
        taille: (rel) => (rel in fichiers ? fichiers[rel].length : null),
    };
}

describe('chercherDansLeVault', () => {
    const v = fauxVault({
        'a.md': 'Le chat dort sur le tapis.',
        'b.md': 'Rien à voir ici.',
        'c.txt': 'Un CHÂT accentué.',
    });

    it('trouve sans tenir compte des accents ni de la casse', async () => {
        const chemins = (JSON.parse(await chercherDansLeVault(v, 'chat')) as { chemin: string }[]).map((x) => x.chemin);
        expect(chemins).toContain('a.md');
        expect(chemins).toContain('c.txt'); // « CHÂT » plié → chat
        expect(chemins).not.toContain('b.md');
    });
    it('rend un message pour une requête vide', async () => {
        expect(await chercherDansLeVault(v, '   ')).toBe('Requête vide.');
    });
    it('rend un message quand rien ne correspond', async () => {
        expect(await chercherDansLeVault(v, 'zzz')).toBe('Aucun résultat dans le vault.');
    });
    it('trouve aussi par le nom du fichier', async () => {
        const r = JSON.parse(await chercherDansLeVault(fauxVault({ 'physique.md': 'x' }), 'physique')) as { chemin: string }[];
        expect(r[0].chemin).toBe('physique.md');
    });
});

describe('lireDocument', () => {
    it('lit une note existante', async () => {
        expect(await lireDocument(fauxVault({ 'a.md': 'bonjour' }), 'a.md')).toBe('bonjour');
    });
    it('refuse un chemin caché ou hors du vault', async () => {
        expect(await lireDocument(fauxVault({}), '.fragment/x.md')).toMatch(/^Refusé/);
        expect(await lireDocument(fauxVault({}), '../x.md')).toMatch(/^Refusé/);
    });
    it('refuse une extension non lue', async () => {
        expect(await lireDocument(fauxVault({}), 'a.png')).toMatch(/^Refusé/);
    });
    it('signale un fichier absent', async () => {
        expect(await lireDocument(fauxVault({}), 'absent.md')).toMatch(/^Aucun fichier/);
    });
    it('tronque au-delà du maximum', async () => {
        const gros = 'a'.repeat(CARACTERES_MAX + 100);
        expect(await lireDocument(fauxVault({ 'g.md': gros }), 'g.md')).toContain('tronqué');
    });
});
