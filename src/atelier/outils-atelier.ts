import { tool, type RunContext, type Tool } from '@openai/agents';
import { z } from 'zod';
import type { AccesVault } from '../cerveau/vault';
import type { NomAgent } from '../pont/protocole';
import { DELAI_MS, executer, type Execution, type OptionsExecution } from './bac-a-sable';
import { Bibliotheque, egal, verifierArgs, type CasDeTest, type Definition, type Fonction } from './bibliotheque';
import { commandesPermises, creerCourtier, verifierCommande, type Commandes, type Ui } from './courtier';

// L'atelier relie la bibliothèque (données), le bac à sable (exécution) et Fragment
// (courtier, registre de commandes). Il donne à chaque agent ses méta-outils :
// lister et lancer une commande d'affichage, essayer du code, créer, appeler et
// supprimer ses fonctions.
//
// Une fonction créée ne devient PAS un outil de plus : l'agent a un seul
// call_function et lit son catalogue à chaque demande. La liste d'outils ne bouge
// donc jamais (le cache de prompt d'OpenAI tient, l'agent reste sous 20 outils) et
// un schéma écrit par le modèle n'a pas à passer le mode strict d'OpenAI : zod le
// vérifie ici. Elle est quand même appelable dès le tour suivant du même run.

export const CREATIONS_PAR_RUN = 3;
export const PROFONDEUR_MAX = 3;

/** Ce que les outils lisent dans le contexte du run : les créations déjà faites. */
export interface ContexteAtelier { creations: number }

/** Ce que l'atelier sait faire du registre de commandes de Fragment (le Plugin, ou un faux). */
export interface HoteCommandes {
    addCommand(commande: { id: string; name: string; callback: () => void }): unknown;
    removeCommand(id: string): void;
}

export interface OptionsAtelier {
    bibliotheque: Bibliotheque;
    acces: AccesVault;
    commandes: Commandes;
    ui: Ui;
    hote: HoteCommandes;
    /** Écrit data.json (réglages + bibliothèque). */
    sauver: () => void;
    /** Un message court à l'écran (Notice en page). */
    notifier: (message: string) => void;
    execution?: OptionsExecution;
}

const NOMS: Record<NomAgent, string> = {
    chat: 'Chat', definir: 'Définir', resumer: 'Résumer', traduire: 'Traduire',
    aider: 'Indice', visualiser: 'Visualiser', bilan: 'Bilan', titre: 'Titre',
};

/** L'id (sans le préfixe `hone:` que Plugin.addCommand ajoute) de la commande d'une fonction. */
export const idCommande = (agent: NomAgent, nom: string) => `${agent}-${nom}`;

/** Un JSON que le modèle a écrit dans une chaîne ; lève un message lisible. */
function json(texte: string, quoi: string): unknown {
    try {
        return JSON.parse(texte);
    } catch {
        throw new Error(`${quoi} : JSON illisible.`);
    }
}

const rendre = (e: Execution) => JSON.stringify(
    e.ok ? { ok: true, resultat: e.valeur, journal: e.journal } : { ok: false, erreur: e.erreur, journal: e.journal },
);

export class Atelier {
    readonly bibliotheque: Bibliotheque;
    private readonly o: OptionsAtelier;

    constructor(options: OptionsAtelier) {
        this.o = options;
        this.bibliotheque = options.bibliotheque;
    }

    /** Exécute une fonction de la bibliothèque ; ses propres appels à d'autres fonctions sont bornés.
     *  `candidate` : la fonction en cours de test, appelable par son nom avant d'être enregistrée.
     *  `cadre` : une composition entière tient dans UN délai, et quand la fonction de tête a fini
     *  (ou expiré), les fonctions qu'elle appelait encore sont arrêtées avec elle. */
    executerFonction(
        agent: NomAgent, f: Pick<Fonction, 'code'>, args: unknown, simulation = false, profondeur = 0, candidate?: Definition,
        cadre?: { echeance: number; signal: AbortSignal },
    ): Promise<Execution> {
        const tete = cadre ? null : new AbortController();
        const c = cadre ?? { echeance: Date.now() + (this.o.execution?.delai ?? DELAI_MS), signal: tete!.signal };
        const courtier = creerCourtier({
            acces: this.o.acces, commandes: this.o.commandes, ui: this.o.ui, simulation,
            appelerFonction: async (nom, a) => {
                if (profondeur + 1 >= PROFONDEUR_MAX) throw new Error(`Trop d'appels imbriqués (${PROFONDEUR_MAX} niveaux au plus).`);
                const autre = candidate?.nom === nom ? candidate : this.bibliotheque.trouver(agent, nom);
                if (!autre) throw new Error(`Fonction inconnue : ${nom}`);
                const e = verifierArgs(autre.parametres, a);
                if (e) throw new Error(`Args de ${nom} hors du schéma : ${e}`);
                const r = await this.executerFonction(agent, autre, a, simulation, profondeur + 1, candidate, c);
                if (!r.ok) throw new Error(`${nom} a échoué : ${r.erreur}`);
                return r.valeur;
            },
        });
        const r = executer(f.code, args, courtier, { ...this.o.execution, delai: Math.max(0, c.echeance - Date.now()), signal: c.signal });
        return tete ? r.finally(() => tete.abort()) : r;
    }

    /** Appelle une fonction par son nom, compte son usage et sauve. Rend le texte pour le modèle. */
    async appeler(agent: NomAgent, nom: string, args: unknown): Promise<Execution> {
        const f = this.bibliotheque.trouver(agent, nom);
        if (!f) return { ok: false, erreur: `Fonction inconnue : ${nom}. Voir ton catalogue.`, journal: [] };
        const e = verifierArgs(f.parametres, args);
        if (e) return { ok: false, erreur: `Args hors du schéma : ${e}`, journal: [] };
        const r = await this.executerFonction(agent, f, args);
        this.bibliotheque.noterUsage(agent, nom, r.ok);
        this.o.sauver();
        return r;
    }

    /** Teste chaque cas (en simulation) ; rend le premier écart, ou null. */
    async tester(agent: NomAgent, d: Definition): Promise<string | null> {
        for (const [i, t] of d.tests.entries()) {
            const r = await this.executerFonction(agent, d, t.args, true, 0, d);
            if (!r.ok) return `Test ${i + 1} en erreur : ${r.erreur}`;
            if (!egal(r.valeur, t.attendu)) {
                return `Test ${i + 1} faux : attendu ${JSON.stringify(t.attendu)}, obtenu ${JSON.stringify(r.valeur)}.`;
            }
        }
        return null;
    }

    /** Valide, teste, enregistre (ou remplace), déclare la commande et sauve. */
    async creer(agent: NomAgent, d: Definition): Promise<string> {
        const refus = this.bibliotheque.admissible(agent, d);
        if (refus) return `Refusé : ${refus}`;
        const ecart = await this.tester(agent, d);
        if (ecart) return `Pas enregistrée. ${ecart} Corrige le code ou les tests.`;
        const r = this.bibliotheque.enregistrer(agent, d);
        if (!r.ok) return `Refusé : ${r.erreur}`;
        this.declarer(agent, r.fonction, r.remplacee);
        this.o.sauver();
        this.o.notifier(`Hone · ${NOMS[agent]} ${r.remplacee ? 'a amélioré' : 's\'est fabriqué'} « ${d.nom} ».`);
        return `${r.remplacee ? 'Remplacée' : 'Enregistrée'} : « ${d.nom} », tests passés. Appelle-la par call_function.`;
    }

    supprimer(agent: NomAgent, nom: string): string {
        if (!this.bibliotheque.supprimer(agent, nom)) return `Fonction inconnue : ${nom}.`;
        this.o.hote.removeCommand(idCommande(agent, nom));
        this.o.sauver();
        return `Supprimée : « ${nom} ».`;
    }

    /** La commande de palette d'une fonction : elle se lance avec ses args de commande. */
    private declarer(agent: NomAgent, f: Fonction, remplacee = false): void {
        const id = idCommande(agent, f.nom);
        if (remplacee) this.o.hote.removeCommand(id);
        this.o.hote.addCommand({
            id,
            name: `${NOMS[agent]} · ${f.nom}`,
            callback: () => {
                void this.appeler(agent, f.nom, f.argsCommande).then((r) => this.o.notifier(r.ok
                    ? `${f.nom} : ${JSON.stringify(r.valeur).slice(0, 300)}`
                    : `${f.nom} a échoué : ${r.erreur}`));
            },
        });
    }

    /** Au démarrage : une commande par fonction déjà apprise, même sans clé. */
    declarerTout(agents: readonly NomAgent[]): void {
        for (const agent of agents) for (const f of this.bibliotheque.lister(agent)) this.declarer(agent, f);
    }

    /** Les méta-outils d'un agent. Chaque agent a son propre jeu, lié à sa bibliothèque. */
    outils(agent: NomAgent): Tool[] {
        const creations = (ctx?: RunContext<unknown>) => {
            const c = ctx?.context as ContexteAtelier | undefined;
            return c && typeof c.creations === 'number' ? c : null;
        };
        return [
            tool({
                name: 'list_commands',
                description: 'Liste les commandes de Fragment que tu peux lancer (elles ne changent que l\'affichage).',
                parameters: z.object({}),
                execute: async () => JSON.stringify(commandesPermises(this.o.commandes)),
            }),
            tool({
                name: 'run_command',
                description: 'Lance une commande de Fragment par son id (voir list_commands).',
                parameters: z.object({ id: z.string() }),
                execute: async ({ id }) => {
                    try {
                        const nom = verifierCommande(this.o.commandes, id);
                        return this.o.commandes.lancer(id) ? `Lancée : ${nom}.` : `La commande « ${nom} » n'a pas tourné.`;
                    } catch (err) {
                        return String((err as Error).message);
                    }
                },
            }),
            tool({
                name: 'run_code',
                description: 'Exécute un brouillon de code sans l\'enregistrer : le corps d\'une fonction async (args, hone) '
                    + 'qui retourne une valeur JSON. Pour un calcul ponctuel, ou pour mettre au point une fonction.',
                parameters: z.object({
                    code: z.string(),
                    args: z.string().describe('Les args en JSON, par exemple {"chemin":"cours/poly.md"}.'),
                }),
                execute: async ({ code, args }) => {
                    try {
                        return rendre(await this.executerFonction(agent, { code }, json(args, 'args')));
                    } catch (err) {
                        return String((err as Error).message);
                    }
                },
            }),
            tool({
                name: 'create_function',
                description: 'Crée (ou remplace, même nom) une fonction réutilisable dans ta bibliothèque. Elle est testée '
                    + 'avant d\'être enregistrée : chaque test doit rendre exactement le résultat attendu.',
                parameters: z.object({
                    nom: z.string().describe('snake_case, par exemple compter_definitions.'),
                    description: z.string().describe('Ce qu\'elle fait et quand s\'en servir, en une ou deux phrases.'),
                    parametres: z.string().describe('JSON Schema (type object) des args, en JSON.'),
                    code: z.string().describe('Le corps d\'une fonction async (args, hone) qui retourne une valeur JSON.'),
                    tests: z.string().describe('2 ou 3 cas en JSON : [{"args":{…},"attendu":…}].'),
                    args_commande: z.string().describe('Les args (JSON) quand on la lance depuis la palette de commandes.'),
                }),
                execute: async (p, ctx) => {
                    const c = creations(ctx);
                    if (c && c.creations >= CREATIONS_PAR_RUN) return `Refusé : ${CREATIONS_PAR_RUN} créations au plus par demande.`;
                    try {
                        const d: Definition = {
                            nom: p.nom, description: p.description, code: p.code,
                            parametres: json(p.parametres, 'parametres') as Record<string, unknown>,
                            tests: json(p.tests, 'tests') as CasDeTest[],
                            argsCommande: json(p.args_commande, 'args_commande') as Record<string, unknown>,
                        };
                        if (c) c.creations++;
                        return await this.creer(agent, d);
                    } catch (err) {
                        return String((err as Error).message);
                    }
                },
            }),
            tool({
                name: 'call_function',
                description: 'Appelle une fonction de ta bibliothèque (voir ton catalogue) avec ses args.',
                parameters: z.object({ nom: z.string(), args: z.string().describe('Les args en JSON.') }),
                execute: async ({ nom, args }) => {
                    try {
                        return rendre(await this.appeler(agent, nom, json(args, 'args')));
                    } catch (err) {
                        return String((err as Error).message);
                    }
                },
            }),
            tool({
                name: 'delete_function',
                description: 'Supprime une fonction de ta bibliothèque (inutile, fausse, ou pour faire de la place).',
                parameters: z.object({ nom: z.string() }),
                execute: async ({ nom }) => this.supprimer(agent, nom),
            }),
        ];
    }
}
