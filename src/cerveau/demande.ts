import type { Demande } from '../pont/protocole';

/** Le message d'une erreur, montré tel quel. */
export class ErreurAgent extends Error {}
/** Mode factice : la page répond en factice (repondre.ts). */
export class AgentEnPause extends ErreurAgent {}

/** Le passage tel que Codex le lit. `avant` : ce qui accompagne la demande sans être elle
 *  (le catalogue des fonctions de l'agent, la mémoire, le document). */
export const citer = ({ passage: { texte, chemin, image } }: Demande, avant = '') =>
    `${avant ? `${avant}\n\n` : ''}Document ouvert : ${chemin || '(sans fichier)'}\n${image && !texte
        ? 'Passage sélectionné : l\'image jointe, une zone de la page que l\'utilisateur a entourée ou surlignée. '
            + 'C\'est souvent de l\'écriture à la main : lis-la, et réponds sur ce qu\'elle dit.'
        : `Passage sélectionné :\n"""\n${texte}\n"""${image
            ? '\nL\'image jointe montre cette zone telle qu\'elle est sur la page, avec le trait de l\'utilisateur : '
                + 'formules, schémas et notes à la main qu\'elle contient comptent autant que le texte.'
            : ''}`}`;
