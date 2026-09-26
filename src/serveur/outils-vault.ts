import fs from 'node:fs';
import { tool } from '@openai/agents';
import { z } from 'zod';
import { cheminSur, fichiersLisibles, RefusChemin } from './garde';

// Deux outils de lecture, aucun d'écriture. Un refus est RENDU au modèle, pas levé.

export const CARACTERES_MAX = 20_000;

/** Minuscules et sans accents. */
const plier = (texte: string) => texte.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const lire = (racine: string, rel: string) => fs.readFileSync(cheminSur(racine, rel), 'utf-8');

export function chercherDansLeVault(racine: string, requete: string): string {
    const q = plier(requete.trim());
    if (!q) return 'Requête vide.';
    const trouves: { chemin: string; extrait: string }[] = [];
    for (const rel of fichiersLisibles(racine)) {
        let texte: string;
        try {
            texte = lire(racine, rel);
        } catch {
            continue;
        }
        const plie = plier(texte);
        const i = plie.indexOf(q);
        if (i === -1 && !plier(rel).includes(q)) continue;
        // Même longueur une fois plié : l'extrait se prend dans le vrai texte, accents compris.
        const source = plie.length === texte.length ? texte : plie;
        trouves.push({ chemin: rel, extrait: i === -1 ? texte.slice(0, 300) : source.slice(Math.max(0, i - 200), i + 300) });
        if (trouves.length >= 8) break;
    }
    return trouves.length > 0 ? JSON.stringify(trouves) : 'Aucun résultat dans le vault.';
}

export function lireDocument(racine: string, rel: string): string {
    try {
        const texte = lire(racine, rel);
        return texte.length > CARACTERES_MAX
            ? `${texte.slice(0, CARACTERES_MAX)}\n[… document tronqué à ${CARACTERES_MAX} caractères]`
            : texte;
    } catch (err) {
        return err instanceof RefusChemin ? `Refusé : ${err.message}` : 'Lecture impossible.';
    }
}

export function outilsVault(racine: string) {
    return [
        tool({
            name: 'search_vault',
            description:
                'Cherche un mot ou une expression dans les notes du vault (.md, .txt) et renvoie jusqu\'à 8 extraits '
                + 'avec leur chemin. À utiliser AVANT toute recherche web.',
            parameters: z.object({ requete: z.string().describe('Le mot ou l\'expression à chercher.') }),
            execute: async ({ requete }) => chercherDansLeVault(racine, requete),
        }),
        tool({
            name: 'read_document',
            description:
                'Lit le texte d\'une note du vault. Le chemin est relatif à la racine du vault, tel que search_vault '
                + 'le donne. Les dossiers cachés et tout ce qui est hors du vault sont refusés.',
            parameters: z.object({ chemin: z.string().describe('Chemin relatif à la racine du vault.') }),
            execute: async ({ chemin }) => lireDocument(racine, chemin),
        }),
    ];
}
