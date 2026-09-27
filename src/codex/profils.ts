import { BASE, MISSIONS } from '../cerveau/agents';
import { chercherDansLeVault, lireDocument } from '../cerveau/outils-vault';
import type { AccesVault } from '../cerveau/vault';
import type { NomAgent } from '../pont/protocole';
import type { Json } from './rpc';
import type { Bornes, OutilFourni, Tour } from './serveur';

// Un profil par agent : ce que Codex sait de sa mission, et ce qu'il a le droit de faire.
// Les colonnes « outils » et « web » sont imposées par le fil lui-même (serveur.ts) :
// un agent qui n'a pas un outil ne peut pas s'en servir, quoi qu'on lui écrive.

export interface Profil {
    vault: boolean;
    web: boolean;
    schema?: Json;
    effort: NonNullable<Tour['effort']>;
}

/** Un objet JSON Schema strict : tous les champs requis, aucun autre. */
const objet = (proprietes: Record<string, Json>): Json => ({
    type: 'object', properties: proprietes, required: Object.keys(proprietes), additionalProperties: false,
});
const chaine = { type: 'string' };
const chaineOuNull = { type: ['string', 'null'] };

export const PROFILS: Record<NomAgent, Profil> = {
    chat: { vault: true, web: true, effort: 'low' },
    definir: { vault: true, web: true, effort: 'low', schema: objet({ texte: chaine }) },
    resumer: { vault: true, web: false, effort: 'low', schema: objet({ texte: chaine }) },
    traduire: { vault: false, web: true, effort: 'low', schema: objet({ texte: chaine, langue: chaine }) },
    aider: { vault: true, web: false, effort: 'medium', schema: objet({ texte: chaine, stop: { type: 'boolean' } }) },
    visualiser: {
        vault: true, web: false, effort: 'low',
        schema: objet({ possible: { type: 'boolean' }, svg: chaineOuNull, raison: chaineOuNull }),
    },
    bilan: { vault: false, web: false, effort: 'low' },
};

/** Les deux outils de lecture du vault, les mêmes que ceux du moteur OpenAI (outils-vault.ts). */
export function outilsDuVault(acces: AccesVault): OutilFourni[] {
    return [
        {
            name: 'search_vault',
            description: 'Cherche un mot ou une expression dans les notes du vault (.md, .txt) et renvoie jusqu\'à 8 extraits '
                + 'avec leur chemin. À utiliser AVANT toute recherche web.',
            inputSchema: objet({ requete: { type: 'string', description: 'Le mot ou l\'expression à chercher.' } }),
            executer: async ({ requete }) => chercherDansLeVault(acces, String(requete ?? '')),
        },
        {
            name: 'read_document',
            description: 'Lit le texte d\'une note du vault. Le chemin est relatif à la racine du vault, tel que search_vault '
                + 'le donne. Les dossiers cachés et tout ce qui est hors du vault sont refusés.',
            inputSchema: objet({ chemin: { type: 'string', description: 'Chemin relatif à la racine du vault.' } }),
            executer: async ({ chemin }) => lireDocument(acces, String(chemin ?? '')),
        },
    ];
}

/** Ce qui borne le fil d'un agent : consignes (BASE + mission + préférences), outils, web. */
export function bornesDe(agent: NomAgent, acces: AccesVault, preferences = ''): Bornes {
    const p = PROFILS[agent];
    return {
        consignes: `${BASE}\n${MISSIONS[agent]}${preferences}`,
        outils: p.vault ? outilsDuVault(acces) : [],
        web: p.web,
    };
}
