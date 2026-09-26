import { z } from 'zod';
import type { NomAgent } from '../pont/protocole';
import { CODE_MAX } from './bac-a-sable';

// La bibliothèque : les fonctions que chaque agent s'est fabriquées, une liste par
// agent, rangée dans les données du plugin (data.json) et relue au démarrage.
// Ce fichier ne fait que des données : valider une définition, refuser un doublon,
// tenir l'usage, rendre le catalogue que l'agent lit. Rien n'y s'exécute.
//
// Les garde-fous viennent de la littérature sur les agents qui se fabriquent des
// outils (Voyager, CRAFT, TroVE, SkillsBench) : sans filtre, une bibliothèque
// gonfle, se remplit de doublons et de fonctions fausses, et fait pire que rien.
// D'où : des tests à résultat attendu, pas de doublon, un plafond, l'usage suivi.

export const AGENTS: readonly NomAgent[] = ['chat', 'definir', 'resumer', 'traduire', 'aider', 'visualiser', 'bilan'];
export const PLAFOND_FONCTIONS = 12;
export const DESCRIPTION_MAX = 300;
export const PARAMETRES_MAX = 2_000;
export const TESTS_MIN = 2;
export const TESTS_MAX = 3;
const NOM = /^[a-z][a-z0-9_]{2,40}$/;

export interface CasDeTest { args: Record<string, unknown>; attendu: unknown }
export interface Usage { appels: number; reussites: number; echecs: number }

export interface Fonction {
    nom: string;
    description: string;
    /** Un JSON Schema d'objet : ce que la fonction reçoit dans `args`. */
    parametres: Record<string, unknown>;
    /** Le corps d'une fonction async (args, hone). */
    code: string;
    tests: CasDeTest[];
    /** Les args quand on la lance depuis la palette de commandes. */
    argsCommande: Record<string, unknown>;
    usage: Usage;
    creeLe: string;
    majLe: string;
}

/** Ce que l'agent propose ; la bibliothèque y ajoute usage et dates. */
export type Definition = Pick<Fonction, 'nom' | 'description' | 'parametres' | 'code' | 'tests' | 'argsCommande'>;

export interface DonneesAtelier {
    version: 1;
    fonctions: Partial<Record<NomAgent, Fonction[]>>;
}

const estObjet = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Le validateur des args, depuis le JSON Schema ; lève si le schéma n'est pas lisible. */
export function validateur(parametres: Record<string, unknown>): z.ZodType {
    return z.fromJSONSchema(parametres as Parameters<typeof z.fromJSONSchema>[0]);
}

/** Vérifie des args contre le schéma ; rend le message d'erreur, ou null. */
export function verifierArgs(parametres: Record<string, unknown>, args: unknown): string | null {
    const r = validateur(parametres).safeParse(args);
    return r.success ? null : r.error.issues.map((i) => `${i.path.join('.') || 'args'} : ${i.message}`).join(' ; ');
}

/** Rend le premier défaut d'une définition, ou null si elle est valide. */
export function validerDefinition(d: Definition): string | null {
    if (!NOM.test(d.nom)) return 'Nom invalide : minuscules, chiffres et _, 3 à 41 caractères, commence par une lettre.';
    if (typeof d.description !== 'string' || d.description.trim().length < 10) return 'Description trop courte : dis ce que fait la fonction et quand t\'en servir.';
    if (d.description.length > DESCRIPTION_MAX) return `Description trop longue (${DESCRIPTION_MAX} caractères au plus).`;
    if (!estObjet(d.parametres) || d.parametres.type !== 'object') return 'Les paramètres doivent être un JSON Schema de type object.';
    if (JSON.stringify(d.parametres).length > PARAMETRES_MAX) return `Schéma des paramètres trop long (${PARAMETRES_MAX} caractères au plus).`;
    try {
        validateur(d.parametres);
    } catch (err) {
        return `Schéma des paramètres illisible : ${String((err as Error)?.message ?? err)}`;
    }
    if (typeof d.code !== 'string' || d.code.trim() === '') return 'Code vide.';
    if (d.code.length > CODE_MAX) return `Code trop long (${CODE_MAX} caractères au plus).`;
    if (!Array.isArray(d.tests) || d.tests.length < TESTS_MIN || d.tests.length > TESTS_MAX) {
        return `Donne ${TESTS_MIN} à ${TESTS_MAX} tests, chacun avec ses args et le résultat attendu.`;
    }
    for (const [i, t] of d.tests.entries()) {
        if (!estObjet(t) || !estObjet(t.args) || !('attendu' in t)) return `Test ${i + 1} : il faut { args, attendu }.`;
        const e = verifierArgs(d.parametres, t.args);
        if (e) return `Test ${i + 1} : args hors du schéma (${e}).`;
    }
    if (!estObjet(d.argsCommande)) return 'args_commande doit être un objet.';
    const e = verifierArgs(d.parametres, d.argsCommande);
    if (e) return `args_commande hors du schéma (${e}).`;
    return null;
}

/** Égalité profonde de deux valeurs JSON, clés d'objet dans n'importe quel ordre. */
export function egal(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (Array.isArray(a) || Array.isArray(b)) {
        return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => egal(x, b[i]));
    }
    if (estObjet(a) && estObjet(b)) {
        const ka = Object.keys(a);
        return ka.length === Object.keys(b).length && ka.every((k) => k in b && egal(a[k], b[k]));
    }
    return false;
}

const plier = (t: string) => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const mots = (t: string) => new Set(plier(t).split(/[^a-z0-9]+/).filter((m) => m.length >= 4));

/** Ressemblance de deux descriptions (Jaccard sur les mots de 4 lettres et plus). */
export function ressemblance(a: string, b: string): number {
    const ma = mots(a);
    const mb = mots(b);
    if (ma.size === 0 || mb.size === 0) return 0;
    let communs = 0;
    for (const m of ma) if (mb.has(m)) communs++;
    return communs / (ma.size + mb.size - communs);
}

export const SEUIL_DOUBLON = 0.6;

/** Utilité d'une fonction, pour savoir laquelle remplacer au plafond. */
const utilite = (f: Fonction) => f.usage.reussites - 2 * f.usage.echecs;

function relire(brut: unknown): Fonction | null {
    if (!estObjet(brut)) return null;
    const f = brut as unknown as Fonction;
    const u: Partial<Usage> = estObjet(f.usage) ? f.usage : {};
    const nombre = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
    const def: Definition = {
        nom: f.nom, description: f.description, parametres: f.parametres, code: f.code, tests: f.tests, argsCommande: f.argsCommande,
    };
    if (validerDefinition(def) !== null) return null;
    return {
        ...def,
        usage: { appels: nombre(u.appels), reussites: nombre(u.reussites), echecs: nombre(u.echecs) },
        creeLe: typeof f.creeLe === 'string' ? f.creeLe : new Date(0).toISOString(),
        majLe: typeof f.majLe === 'string' ? f.majLe : new Date(0).toISOString(),
    };
}

/** Relit la section `atelier` de data.json ; les entrées invalides sont jetées, le plafond appliqué. */
export function lireAtelier(data: unknown): DonneesAtelier {
    const brut = estObjet(data) && estObjet(data.atelier) && estObjet(data.atelier.fonctions) ? data.atelier.fonctions : {};
    const fonctions: DonneesAtelier['fonctions'] = {};
    for (const agent of AGENTS) {
        const liste = Array.isArray(brut[agent]) ? (brut[agent] as unknown[]) : [];
        const vues = new Set<string>();
        const bonnes = liste.map(relire).filter((f): f is Fonction => f !== null && !vues.has(f.nom) && Boolean(vues.add(f.nom)));
        if (bonnes.length > 0) fonctions[agent] = bonnes.slice(0, PLAFOND_FONCTIONS);
    }
    return { version: 1, fonctions };
}

export type Enregistrement =
    | { ok: true; remplacee: boolean; fonction: Fonction }
    | { ok: false; erreur: string };

export class Bibliotheque {
    private readonly donnees: DonneesAtelier;

    constructor(donnees: DonneesAtelier) {
        this.donnees = donnees;
    }

    lister(agent: NomAgent): readonly Fonction[] {
        return this.donnees.fonctions[agent] ?? [];
    }

    trouver(agent: NomAgent, nom: string): Fonction | undefined {
        return this.lister(agent).find((f) => f.nom === nom);
    }

    /** Une autre fonction trop proche (description), ou undefined. */
    doublon(agent: NomAgent, d: Pick<Definition, 'nom' | 'description'>): Fonction | undefined {
        return this.lister(agent).find((f) => f.nom !== d.nom && ressemblance(f.description, d.description) >= SEUIL_DOUBLON);
    }

    /** Vérifie qu'une définition (déjà testée) peut entrer, sans l'ajouter. */
    admissible(agent: NomAgent, d: Definition): string | null {
        const defaut = validerDefinition(d);
        if (defaut) return defaut;
        const proche = this.doublon(agent, d);
        if (proche) {
            return `Ressemble trop à ta fonction « ${proche.nom} » (${proche.description}). `
                + `Améliore-la en la recréant sous le même nom, ou supprime-la d'abord.`;
        }
        if (!this.trouver(agent, d.nom) && this.lister(agent).length >= PLAFOND_FONCTIONS) {
            const moins = [...this.lister(agent)].sort((a, b) => utilite(a) - utilite(b) || a.majLe.localeCompare(b.majLe))[0];
            return `Plafond de ${PLAFOND_FONCTIONS} fonctions atteint. La moins utile est « ${moins.nom} » `
                + `(${moins.usage.reussites} réussites, ${moins.usage.echecs} échecs) : supprime-la ou remplace une fonction existante.`;
        }
        return null;
    }

    /** Ajoute, ou remplace la fonction du même nom (nouvelle version, usage remis à zéro). */
    enregistrer(agent: NomAgent, d: Definition, maintenant = new Date()): Enregistrement {
        const refus = this.admissible(agent, d);
        if (refus) return { ok: false, erreur: refus };
        const ancienne = this.trouver(agent, d.nom);
        const fonction: Fonction = {
            nom: d.nom, description: d.description.trim(), parametres: d.parametres, code: d.code,
            tests: d.tests, argsCommande: d.argsCommande,
            usage: { appels: 0, reussites: 0, echecs: 0 },
            creeLe: ancienne?.creeLe ?? maintenant.toISOString(),
            majLe: maintenant.toISOString(),
        };
        const liste = this.lister(agent).filter((f) => f.nom !== d.nom);
        this.donnees.fonctions[agent] = [...liste, fonction];
        return { ok: true, remplacee: Boolean(ancienne), fonction };
    }

    supprimer(agent: NomAgent, nom: string): boolean {
        const liste = this.lister(agent);
        if (!liste.some((f) => f.nom === nom)) return false;
        this.donnees.fonctions[agent] = liste.filter((f) => f.nom !== nom);
        return true;
    }

    noterUsage(agent: NomAgent, nom: string, ok: boolean): void {
        const f = this.trouver(agent, nom);
        if (!f) return;
        f.usage.appels++;
        if (ok) f.usage.reussites++;
        else f.usage.echecs++;
    }

    /** Ce que l'agent lit à chaque demande : ses fonctions, leur contrat et leur usage. */
    catalogue(agent: NomAgent): string {
        const liste = this.lister(agent);
        if (liste.length === 0) return 'Tes fonctions : aucune pour l\'instant.';
        const lignes = liste.map((f) => `- ${f.nom} : ${f.description}\n  args : ${JSON.stringify(f.parametres.properties ?? {})}`
            + `\n  usage : ${f.usage.reussites} réussites, ${f.usage.echecs} échecs`);
        return `Tes fonctions (${liste.length}/${PLAFOND_FONCTIONS}), appelables par call_function :\n${lignes.join('\n')}`;
    }

    enJSON(): DonneesAtelier {
        return this.donnees;
    }
}
