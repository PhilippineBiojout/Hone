import { CONSIGNES_ATELIER } from '../atelier/consignes';
import { BASE, MISSIONS } from '../cerveau/consignes';
import { chercherDansLeVault, lireDocument } from '../cerveau/outils-vault';
import type { AccesVault } from '../cerveau/vault';
import type { NomAgent } from '../pont/protocole';
import type { Json } from './rpc';
import { objet } from './schema';
import type { Bornes, OutilFourni, Tour } from './serveur';

// Un profil par agent : ce que Codex sait de sa mission, et ce qu'il a le droit de faire.
// Les colonnes « outils » et « web » sont imposées par le fil lui-même (serveur.ts) :
// un agent qui n'a pas un outil ne peut pas s'en servir, quoi qu'on lui écrive.

export interface Profil {
    vault: boolean;
    web: boolean;
    schema?: Json;
    effort: NonNullable<Tour['effort']>;
    /** Peut générer une image (Visualiser) : sa consigne reçoit alors CONSIGNE_IMAGE. */
    image?: boolean;
}

const chaine = { type: 'string' };
const chaineOuNull = { type: ['string', 'null'] };

export const PROFILS: Record<NomAgent, Profil> = {
    chat: { vault: true, web: true, effort: 'low' },
    definir: { vault: true, web: true, effort: 'low', schema: objet({ texte: chaine }) },
    resumer: { vault: true, web: false, effort: 'low', schema: objet({ texte: chaine }) },
    traduire: { vault: false, web: true, effort: 'low', schema: objet({ texte: chaine, langue: chaine }) },
    aider: { vault: true, web: false, effort: 'medium', schema: objet({ texte: chaine, stop: { type: 'boolean' } }) },
    visualiser: {
        vault: true, web: false, effort: 'low', image: true,
        schema: objet({
            forme: { type: 'string', enum: ['dessin', 'image'] }, possible: { type: 'boolean' }, svg: chaineOuNull, raison: chaineOuNull,
        }),
    },
    bilan: { vault: false, web: false, effort: 'low' },
    titre: { vault: false, web: false, effort: 'low', schema: objet({ sujet: chaine }) },
};

/** Les deux outils de lecture du vault, lus par outils-vault.ts. */
export function outilsDuVault(acces: AccesVault): OutilFourni[] {
    return [
        {
            name: 'search_vault',
            description: 'Cherche un mot ou une expression dans les notes du vault (.md, .txt), le texte des PDF et les noms de fichiers, et renvoie jusqu\'à 8 extraits '
                + 'avec leur chemin. À utiliser AVANT toute recherche web.',
            inputSchema: objet({ requete: { type: 'string', description: 'Le mot ou l\'expression à chercher.' } }),
            executer: async ({ requete }) => chercherDansLeVault(acces, String(requete ?? '')),
        },
        {
            name: 'read_document',
            description: 'Lit un document du vault en entier : une note (.md, .txt) ou un PDF (cours, carnet reMarkable, scan). '
                + 'Un PDF rend son texte page par page, et chaque page écrite à la main ou scannée en image, que tu lis. '
                + 'Le chemin est relatif à la racine du vault, tel que search_vault ou « Document ouvert » le donne. '
                + 'Les dossiers cachés et tout ce qui est hors du vault sont refusés.',
            inputSchema: objet({
                chemin: { type: 'string', description: 'Chemin relatif à la racine du vault.' },
                pages: { type: ['string', 'null'], description: 'PDF : les pages à lire, « 3 », « 2-5 » ou « 1, 4 » ; null pour toutes.' },
                en_image: { type: 'boolean', description: 'PDF : vrai pour voir ces pages en image même si elles ont du texte (formules, schémas, notes à la main).' },
            }),
            executer: async ({ chemin, pages, en_image }) => lireDocument(acces, String(chemin ?? ''), {
                pages: typeof pages === 'string' ? pages : null, enImage: en_image === true,
            }),
        },
    ];
}

/** Sur Codex seulement : Visualiser choisit entre un dessin SVG et une image générée. */
export const CONSIGNE_IMAGE = `
Au lieu d'un dessin, tu peux générer une image avec ton outil de génération d'images. Choisis la forme selon le passage :
- forme "dessin" (le SVG ci-dessus) quand le passage a une structure : des étapes, des dates, des liens entre des idées, une comparaison ;
- forme "image" quand le passage décrit une chose concrète qu'il faut voir : un objet, une forme, un lieu, un phénomène, une expérience.
Pour une image : génère-la une seule fois, en illustration de manuel sur fond clair uni, avec des légendes courtes dans la langue du passage et rien qui ne soit dans le passage ou le document. Rends alors possible à true et svg à null.
La règle « aucune image » plus haut ne vaut qu'à l'intérieur du SVG.`;

/** Ce qu'un agent reçoit en plus de son profil : la mémoire (préférences et ses deux outils)
 *  et l'atelier (ses consignes et ses méta-outils). Le titre n'en reçoit rien. */
export interface Extras {
    preferences?: string;
    outils?: OutilFourni[];
    atelier?: boolean;
}

/** Ce qui borne le fil d'un agent : consignes (BASE + mission + atelier + préférences), outils, web, image. */
export function bornesDe(agent: NomAgent, acces: AccesVault, extras: Extras = {}): Bornes {
    const p = PROFILS[agent];
    return {
        consignes: `${BASE}\n${MISSIONS[agent]}${p.image ? CONSIGNE_IMAGE : ''}${extras.atelier ? CONSIGNES_ATELIER : ''}${extras.preferences ?? ''}`,
        outils: [...(p.vault ? outilsDuVault(acces) : []), ...(extras.outils ?? [])],
        web: p.web,
        image: p.image === true,
    };
}
