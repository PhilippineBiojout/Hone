// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CARACTERES_MAX, chercherDansLeVault, lireDocument } from '../serveur/outils-vault';

let vault: string;

beforeAll(() => {
    vault = fs.mkdtempSync(path.join(os.tmpdir(), 'outils-'));
    fs.mkdirSync(path.join(vault, 'cours'));
    fs.mkdirSync(path.join(vault, '.fragment'));
    fs.writeFileSync(path.join(vault, 'cours/thermo.md'), 'La notion d\'Entropie mesure le désordre.');
    fs.writeFileSync(path.join(vault, 'long.md'), 'x'.repeat(CARACTERES_MAX + 10));
    fs.writeFileSync(path.join(vault, '.fragment/.env'), 'OPENAI_API_KEY=sk-secret entropie');
});

afterAll(() => fs.rmSync(vault, { recursive: true, force: true }));

describe('search_vault', () => {
    it('trouve sans tenir compte des majuscules ni des accents, et garde les accents de l\'extrait', () => {
        const trouves = JSON.parse(chercherDansLeVault(vault, 'entropie'));
        expect(trouves).toHaveLength(1);
        expect(trouves[0].chemin).toBe(path.join('cours', 'thermo.md'));
        expect(trouves[0].extrait).toContain('désordre');
    });

    it('ne cherche jamais dans les dossiers cachés', () => {
        expect(chercherDansLeVault(vault, 'sk-secret')).toBe('Aucun résultat dans le vault.');
    });
});

describe('read_document', () => {
    it('rend un refus lisible au lieu de lever', () => {
        expect(lireDocument(vault, '.fragment/.env')).toMatch(/^Refusé : /);
        expect(lireDocument(vault, '../../etc/hosts')).toMatch(/^Refusé : /);
    });

    it('tronque un document trop long', () => {
        const texte = lireDocument(vault, 'long.md');
        expect(texte.length).toBeLessThan(CARACTERES_MAX + 100);
        expect(texte).toContain('document tronqué');
    });
});
