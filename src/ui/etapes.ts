import type { Etape } from '../pont/protocole';

// Ce que l'agent a fait pour répondre, en mots : pendant l'attente (au présent) et
// au pied de la carte (au passé). C'est ce qui montre que c'est une boucle, et, avec
// l'atelier et la mémoire, qu'il se fabrique des fonctions et qu'il se souvient.

const guillemets = (d: string) => (d ? ` « ${d} »` : '');

/** `fini` : au passé, pour le parcours replié au pied de la carte. */
export function decrireEtape({ outil, detail }: Etape, fini: boolean): string {
    const t = (present: string, passe: string) => (fini ? passe : present);
    switch (outil) {
        case 'search_vault':
            return `${t('Cherche', 'Cherché')}${guillemets(detail)} dans tes notes`;
        case 'read_document':
            return `${t('Lit', 'Lu')} ${detail}`.trim();
        case 'web':
            return `${t('Cherche', 'Cherché')}${guillemets(detail)} sur le web`;
        case 'create_function':
            return `${t('Se fabrique', 'S\'est fabriqué')} la fonction${guillemets(detail)}`;
        case 'call_function':
            return `${t('Lance', 'Lancé')} sa fonction${guillemets(detail)}`;
        case 'delete_function':
            return `${t('Supprime', 'Supprimé')} la fonction${guillemets(detail)}`;
        case 'image':
            return t('Génère une image', 'Généré une image');
        case 'run_code':
            return t('Essaie un calcul', 'Essayé un calcul');
        case 'list_commands':
            return t('Regarde les commandes de l\'app', 'Regardé les commandes de l\'app');
        case 'run_command':
            return `${t('Lance', 'Lancé')} la commande ${detail}`.trim();
        case 'remember':
            return `${t('Fouille', 'Fouillé')} sa mémoire${guillemets(detail)}`;
        case 'note_preference':
            return `${t('Retient', 'Retenu')} ta préférence${guillemets(detail)}`;
        default:
            return `${t('Utilise', 'Utilisé')} ${outil}`;
    }
}

const RECHERCHES = new Set(['search_vault', 'web', 'remember']);
const FONCTIONS = new Set(['create_function', 'call_function', 'run_code', 'delete_function']);

/** « 2 recherches, 1 lecture, 1 image » : le titre du parcours replié. */
export function resumerEtapes(etapes: readonly Etape[]): string {
    const compter = (n: number, un: string, plusieurs: string): string | null => (n === 0 ? null : `${n} ${n > 1 ? plusieurs : un}`);
    const recherches = etapes.filter((e) => RECHERCHES.has(e.outil)).length;
    const lectures = etapes.filter((e) => e.outil === 'read_document').length;
    const fonctions = etapes.filter((e) => FONCTIONS.has(e.outil)).length;
    const images = etapes.filter((e) => e.outil === 'image').length;
    const autres = etapes.length - recherches - lectures - fonctions - images;
    return [compter(recherches, 'recherche', 'recherches'), compter(lectures, 'lecture', 'lectures'),
        compter(fonctions, 'fonction', 'fonctions'), compter(images, 'image', 'images'),
        compter(autres, 'autre action', 'autres actions')]
        .filter((x): x is string => x !== null).join(', ');
}
