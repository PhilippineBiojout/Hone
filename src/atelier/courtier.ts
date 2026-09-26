import { chercherDansLeVault, CARACTERES_MAX } from '../cerveau/outils-vault';
import { RefusChemin, TAILLE_MAX, verifierChemin } from '../cerveau/garde';
import type { AccesVault } from '../cerveau/vault';
import type { Courtier } from './bac-a-sable';

// Le courtier : le seul pont entre le bac à sable et Fragment. Il est en LECTURE :
// l'agent n'écrit que dans sa bulle, jamais dans le vault ni dans les annotations.
// Il lit les notes (mêmes gardes que read_document), ouvre une note, et lance les
// seules commandes qui changent l'affichage. Un refus est une erreur que le code
// du bac à sable peut attraper, et qui revient au modèle sinon.

/** Les commandes que les fonctions peuvent lancer : elles changent l'affichage, jamais une note. */
// Ids relevés dans le vrai registre (e2e/agent-atelier.spec.ts) ; follow-link n'y paraît
// que le curseur sur un lien, listCommands ne rendant que les commandes disponibles.
export const COMMANDES_AFFICHAGE = new Set([
    'workspace:new-tab',
    'workspace:split-vertical',
    'workspace:split-horizontal',
    'app:toggle-left-sidebar',
    'app:toggle-right-sidebar',
    'editor:follow-link',
    'command-palette:open',
    'markdown:reload-active-view',
]);

export interface CommandeVue { id: string; name: string }

/** Ce que le courtier sait faire du registre de commandes (app.commands, ou un faux). */
export interface Commandes {
    lister(): CommandeVue[];
    /** Faux si la commande n'a pas tourné (inconnue, indisponible, ou en erreur). */
    lancer(id: string): boolean;
}

export interface Ui {
    /** Ouvre une note du vault dans l'onglet actif. */
    ouvrir(chemin: string): Promise<void>;
}

/** Les commandes que le courtier accepte, parmi celles disponibles maintenant. */
export function commandesPermises(commandes: Commandes): CommandeVue[] {
    return commandes.lister().filter((c) => COMMANDES_AFFICHAGE.has(c.id) && !c.id.startsWith('hone:'));
}

/** Lève si la commande n'est pas lançable par une fonction ; rend son nom sinon. */
export function verifierCommande(commandes: Commandes, id: string): string {
    if (typeof id !== 'string' || id.startsWith('hone:')) throw new Error('Refusé : les commandes de Hone ne se lancent pas depuis une fonction.');
    const c = commandesPermises(commandes).find((x) => x.id === id);
    if (!c) throw new Error(`Refusé : « ${id} » n'est pas une commande d'affichage disponible (voir list_commands).`);
    return c.name;
}

export interface OptionsCourtier {
    acces: AccesVault;
    commandes: Commandes;
    ui: Ui;
    /** Appelle une autre fonction de la même bibliothèque (composition). */
    appelerFonction?: (nom: string, args: unknown) => Promise<unknown>;
    /** Pendant les tests d'une fonction à sa création : rien ne se lance pour de vrai, mais la
     *  réponse est la même qu'en vrai, pour qu'une fonction ne puisse pas se savoir testée. */
    simulation?: boolean;
}

async function lire(acces: AccesVault, chemin: unknown): Promise<string> {
    const rel = String(chemin ?? '');
    try {
        verifierChemin(rel);
    } catch (err) {
        throw new Error(err instanceof RefusChemin ? `Refusé : ${err.message}` : 'Lecture impossible.');
    }
    const taille = acces.taille(rel);
    if (taille != null && taille > TAILLE_MAX) throw new Error('Refusé : fichier trop gros pour être lu.');
    const texte = await acces.lire(rel);
    if (texte == null) throw new Error(`Aucun fichier à ce chemin : ${rel}`);
    return texte.length > CARACTERES_MAX ? texte.slice(0, CARACTERES_MAX) : texte;
}

export function creerCourtier({ acces, commandes, ui, appelerFonction, simulation = false }: OptionsCourtier): Courtier {
    return async (op, params) => {
        switch (op) {
            case 'vault.lister':
                return acces.fichiers().slice(0, 500);
            case 'vault.chercher': {
                const r = await chercherDansLeVault(acces, String(params.requete ?? ''));
                return r.startsWith('[') ? JSON.parse(r) : [];
            }
            case 'vault.lire':
                return lire(acces, params.chemin);
            case 'commandes.lister':
                return commandesPermises(commandes);
            case 'commandes.lancer': {
                const id = String(params.id ?? '');
                const nom = verifierCommande(commandes, id);
                if (simulation) return nom;
                if (!commandes.lancer(id)) throw new Error(`La commande « ${nom} » n'a pas tourné.`);
                return nom;
            }
            case 'ui.ouvrir': {
                const rel = String(params.chemin ?? '');
                await lire(acces, rel); // mêmes gardes, et l'existence
                if (simulation) return rel;
                await ui.ouvrir(rel);
                return rel;
            }
            case 'fonctions.appeler':
                if (!appelerFonction) throw new Error('Aucune autre fonction appelable ici.');
                return appelerFonction(String(params.nom ?? ''), params.args ?? {});
            default:
                throw new Error(`Opération inconnue : ${op}`);
        }
    };
}
