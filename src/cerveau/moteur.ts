import OpenAI from 'openai';
import {
    assistant, MaxTurnsExceededError, run, setDefaultOpenAIClient, setTracingDisabled, user,
    type AgentInputItem, type RunItem,
} from '@openai/agents';
import type { App } from 'fragment';
import type { Atelier, ContexteAtelier } from '../atelier/outils-atelier';
import type { ContexteMemoire, Memoire } from '../memoire/outils-memoire';
import type { Demande, Etape, Sortie, Source } from '../pont/protocole';
import type { Reglages } from '../reglages/reglages';
import { creerAgents, type Agents } from './agents';
import { Compteur } from './couts';
import { langueDuVault } from './langue';
import { accesVault, type AccesVault } from './vault';

// Le cerveau de Hone, EN PAGE (plus de procès forké). La CSP de Fragment autorise
// api.openai.com (connect-src … https:), et le renderer a Node : le SDK OpenAI y
// tourne. La clé vit désormais dans les données du plugin — assumé (modèle Obsidian).

/** Le message d'une erreur, montré tel quel. */
export class ErreurAgent extends Error {}
/** Pas de clé (ou mode factice) : la page répond en factice (repondre.ts). */
export class AgentEnPause extends ErreurAgent {}

/** `avant` : ce qui change d'une demande à l'autre sans être la demande (le catalogue des
 *  fonctions de l'agent). Il vient APRÈS les consignes et les outils, fixes, pour que le
 *  préfixe mis en cache par OpenAI reste le même. */
export const citer = ({ passage: { texte, chemin } }: Demande, avant = '') =>
    `${avant ? `${avant}\n\n` : ''}Document ouvert : ${chemin || '(sans fichier)'}\nPassage sélectionné :\n"""\n${texte}\n"""`;

async function entree(acces: AccesVault, demande: Demande, avant = ''): Promise<string | AgentInputItem[]> {
    switch (demande.agent) {
        case 'chat':
            // Les 12 derniers tours : chaque question renvoie tout l'historique, et se paie.
            return [
                ...demande.historique.slice(-12).map((t) => (t.auteur === 'moi' ? user(t.texte) : assistant(t.texte))),
                user(`${citer(demande, avant)}\n\nQuestion : ${demande.question}`),
            ];
        case 'bilan':
            return `${citer(demande, avant)}\n\nDiscussion :\n${demande.historique
                .map((t) => `${t.auteur === 'moi' ? 'Utilisateur' : 'Agent'} : ${t.texte}`).join('\n')}`;
        case 'aider':
            return `${citer(demande, avant)}\n\n${demande.indices.length > 0
                ? `Indices déjà donnés :\n${demande.indices.map((t, i) => `${i + 1}. ${t}`).join('\n')}`
                : 'Aucun indice donné pour l\'instant.'}`;
        case 'traduire':
            return `${citer(demande, avant)}\n\nLangue cible : ${await langueDuVault(acces)}.`;
        default:
            return citer(demande, avant);
    }
}

/** Ce qu'on montre d'un appel d'outil : le champ qui dit ce qu'il vise. */
const DETAIL: Record<string, string[]> = {
    search_vault: ['requete'], read_document: ['chemin'], create_function: ['nom'], call_function: ['nom'],
    delete_function: ['nom'], run_command: ['id'], remember: ['recherche', 'semaine'], note_preference: ['preference'],
};

/** Un appel d'outil vu dans le flux, en étape montrable ; null si ce n'en est pas un. */
export function etapeDe(item: RunItem): Etape | null {
    if (item.type !== 'tool_call_item') return null;
    const brut = item.rawItem as { type: string; name?: string; arguments?: string; providerData?: { action?: { query?: string } } };
    if (brut.type === 'hosted_tool_call' && brut.name === 'web_search_call') {
        return { outil: 'web', detail: brut.providerData?.action?.query ?? '' };
    }
    if (brut.type !== 'function_call' || !brut.name) return null;
    let args: Record<string, unknown> = {};
    try {
        args = JSON.parse(brut.arguments ?? '{}');
    } catch {
        // des arguments illisibles : l'étape se montre sans détail
    }
    const champ = (DETAIL[brut.name] ?? []).map((c) => args[c]).find((v) => typeof v === 'string' && v);
    return { outil: brut.name, detail: typeof champ === 'string' ? champ : '' };
}

/** Les noms des outils que l'agent a appelés, pour la mémoire. */
function outilsAppeles(items: RunItem[]): string[] {
    return items.filter((i) => i.type === 'tool_call_item')
        .map((i) => (i.rawItem as { name?: string; type: string }).name ?? (i.rawItem as { type: string }).type);
}

/** D'après les outils réellement appelés : le web prime, puis le vault. */
function source(items: RunItem[]): Source {
    let vault = false;
    for (const item of items) {
        if (item.type !== 'tool_call_item') continue;
        const brut = item.rawItem as { type: string; name?: string };
        if (brut.type === 'hosted_tool_call' && brut.name === 'web_search_call') return 'web';
        if (brut.type === 'function_call' && (brut.name === 'search_vault' || brut.name === 'read_document')) vault = true;
    }
    return vault ? 'vault' : 'modele';
}

function messagePourUtilisateur(err: unknown): string {
    if (err instanceof MaxTurnsExceededError) return 'Question trop complexe, je n\'arrive pas à y répondre.';
    const msg = String((err as Error)?.message ?? err);
    if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|fetch failed|network/i.test(msg)) return 'Pas de connexion : vérifie ta connexion internet.';
    if (/401|invalid api key|incorrect api key/i.test(msg)) return 'Clé API refusée par OpenAI : vérifie ta clé dans les réglages de Hone.';
    if (/429|quota|rate limit/i.test(msg)) return 'Limite ou crédits OpenAI atteints : réessaie plus tard.';
    if (/model.*(not found|does not exist)/i.test(msg)) return 'Modèle introuvable : vérifie les modèles dans les réglages de Hone.';
    return 'Une erreur est survenue.';
}

/** Le moteur d'une session : les agents prêts, ou null si aucune clé. */
export class Moteur {
    private readonly acces: AccesVault;
    private readonly agents: Agents | null;
    private readonly compteur: Compteur;
    private readonly atelier: Atelier | undefined;
    private readonly memoire: Memoire | undefined;

    constructor(app: App, reglages: Reglages, atelier?: Atelier, memoire?: Memoire) {
        this.acces = accesVault(app);
        this.compteur = new Compteur(reglages.plafond);
        setTracingDisabled(true);
        this.atelier = reglages.atelierActif ? atelier : undefined;
        this.memoire = memoire;
        const cle = reglages.cle.trim();
        if (cle && !reglages.factice) {
            // dangerouslyAllowBrowser : assumé, la clé est déjà en page (modèle Obsidian).
            setDefaultOpenAIClient(new OpenAI({ apiKey: cle, dangerouslyAllowBrowser: true }));
            this.agents = creerAgents(this.acces, { fort: reglages.modeleFort, leger: reglages.modeleLeger }, this.atelier, this.memoire);
        } else {
            this.agents = null;
        }
    }

    /** Vrai si une clé est configurée ; sinon la page répond en factice. */
    pret(): boolean {
        return this.agents !== null;
    }

    /** `morceau` reçoit le texte du chat en direct, `surEtape` chaque outil appelé. Toutes les missions
     *  sont streamées pour ça. Lève ErreurAgent en cas d'échec, AgentEnPause si pas prêt. */
    async demander(demande: Demande, morceau?: (texte: string) => void, surEtape?: (etape: Etape) => void): Promise<Sortie> {
        if (!this.agents) throw new AgentEnPause('Hone sans clé.');
        const refus = this.compteur.refus();
        if (refus) throw new ErreurAgent(refus);

        const agent = this.agents[demande.agent];
        // L'atelier coûte des tours (créer, tester, corriger) : on en laisse davantage.
        const tours = this.atelier ? { chat: 14, autres: 10 } : { chat: 10, autres: 6 };
        const context: ContexteAtelier & ContexteMemoire = { creations: 0, note: demande.passage.chemin };
        try {
            // Après les consignes et les outils (fixes, en cache) : le catalogue, puis la mémoire
            // (le récent, puis ce document), puis le document lui-même, juste avant la demande.
            const souvenirs = await this.memoire?.avant(demande);
            const avant = [this.atelier?.bibliotheque.catalogue(demande.agent), souvenirs?.memoire, souvenirs?.document]
                .filter(Boolean).join('\n\n');
            const items = await entree(this.acces, demande, avant);
            if (demande.agent === 'chat') {
                const flux = await run(this.agents.chat, items, { stream: true, maxTurns: tours.chat, context });
                for await (const ev of flux) {
                    if (ev.type === 'raw_model_stream_event' && ev.data.type === 'output_text_delta') {
                        morceau?.(ev.data.delta);
                    } else if (ev.type === 'run_item_stream_event' && ev.name === 'tool_called') {
                        const etape = etapeDe(ev.item);
                        if (etape) surEtape?.(etape);
                    }
                }
                await flux.completed;
                this.compteur.noter(flux.state.usage);
                const sortie: Sortie = { texte: String(flux.finalOutput ?? ''), source: source(flux.newItems) };
                void this.memoire?.noter(demande, sortie, outilsAppeles(flux.newItems));
                return sortie;
            }
            const resultat = await run(agent, items, { stream: true, maxTurns: tours.autres, context });
            for await (const ev of resultat) {
                if (ev.type === 'run_item_stream_event' && ev.name === 'tool_called') {
                    const etape = etapeDe(ev.item);
                    if (etape) surEtape?.(etape);
                }
            }
            await resultat.completed;
            this.compteur.noter(resultat.state.usage);
            const final = resultat.finalOutput as Record<string, unknown> | string | undefined;
            const sortie = demande.agent === 'bilan'
                ? { texte: String(final ?? '') }
                : demande.agent === 'definir' || demande.agent === 'resumer'
                    ? { texte: String((final as { texte: string }).texte), source: source(resultat.newItems) }
                    : (final as Sortie);
            void this.memoire?.noter(demande, sortie, outilsAppeles(resultat.newItems));
            return sortie;
        } catch (err) {
            if (err instanceof AgentEnPause) throw err;
            // OpenAI recopie un bout de la clé dans ses erreurs : on l'efface du terminal.
            console.error(`[hone] ${demande.agent} :`, String((err as Error)?.message ?? err).replace(/sk-[\w*-]+/g, 'sk-…'));
            throw new ErreurAgent(messagePourUtilisateur(err));
        }
    }
}

let moteur: Moteur | null = null;

/** Au chargement du plugin (et à chaque changement de réglages) ; la fonction rendue le libère. */
export function ouvrirMoteur(app: App, reglages: Reglages, atelier?: Atelier, memoire?: Memoire): () => void {
    const courant = moteur = new Moteur(app, reglages, atelier, memoire);
    return () => {
        if (moteur === courant) moteur = null;
    };
}

/** Null hors du plugin chargé (tests, e2e en factice). */
export function moteurCourant(): Moteur | null {
    return moteur;
}
