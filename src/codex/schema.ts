import type { Json } from './rpc';

// Les schémas des outils qu'on donne à Codex (profils.ts, mémoire, atelier).

/** Un objet JSON Schema strict : tous les champs requis, aucun autre. */
export const objet = (proprietes: Record<string, Json>): Json => ({
    type: 'object', properties: proprietes, required: Object.keys(proprietes), additionalProperties: false,
});

/** Une chaîne, décrite pour le modèle. */
export const chaine = (description?: string): Json => (description ? { type: 'string', description } : { type: 'string' });

/** Ce que Codex a passé pour un champ de texte ; null s'il l'a laissé vide. */
export const texteOuNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
