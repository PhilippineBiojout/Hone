import { tool } from '@openai/agents';
import { z } from 'zod';
import { RefusChemin, TAILLE_MAX, verifierChemin } from './garde';
import type { AccesVault } from './vault';

// Deux outils de lecture, aucun d'écriture. Un refus est RENDU au modèle, pas levé.

export const CARACTERES_MAX = 20_000;

/** Minuscules et sans accents. */
const plier = (texte: string) => texte.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export async function chercherDansLeVault(acces: AccesVault, requete: string): Promise<string> {
    const q = plier(requete.trim());
    if (!q) return 'Requête vide.';
    const trouves: { chemin: string; extrait: string }[] = [];
    for (const rel of acces.fichiers()) {
        const texte = await acces.lire(rel);
        if (texte == null) continue;
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

export async function lireDocument(acces: AccesVault, rel: string): Promise<string> {
    try {
        verifierChemin(rel);
    } catch (err) {
        return err instanceof RefusChemin ? `Refusé : ${err.message}` : 'Lecture impossible.';
    }
    const taille = acces.taille(rel);
    if (taille != null && taille > TAILLE_MAX) return 'Refusé : fichier trop gros pour être lu.';
    const texte = await acces.lire(rel);
    if (texte == null) return `Aucun fichier à ce chemin : ${rel}`;
    return texte.length > CARACTERES_MAX
        ? `${texte.slice(0, CARACTERES_MAX)}\n[… document tronqué à ${CARACTERES_MAX} caractères]`
        : texte;
}

export function outilsVault(acces: AccesVault) {
    return [
        tool({
            name: 'search_vault',
            description:
                'Cherche un mot ou une expression dans les notes du vault (.md, .txt) et renvoie jusqu\'à 8 extraits '
                + 'avec leur chemin. À utiliser AVANT toute recherche web.',
            parameters: z.object({ requete: z.string().describe('Le mot ou l\'expression à chercher.') }),
            execute: async ({ requete }) => chercherDansLeVault(acces, requete),
        }),
        tool({
            name: 'read_document',
            description:
                'Lit le texte d\'une note du vault. Le chemin est relatif à la racine du vault, tel que search_vault '
                + 'le donne. Les dossiers cachés et tout ce qui est hors du vault sont refusés.',
            parameters: z.object({ chemin: z.string().describe('Chemin relatif à la racine du vault.') }),
            execute: async ({ chemin }) => lireDocument(acces, chemin),
        }),
    ];
}
