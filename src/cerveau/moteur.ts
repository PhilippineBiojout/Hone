import OpenAI from 'openai';
import {
    assistant, MaxTurnsExceededError, run, setDefaultOpenAIClient, setTracingDisabled, user,
    type AgentInputItem, type RunItem,
} from '@openai/agents';
import type { App } from 'fragment';
import type { Demande, Sortie, Source } from '../pont/protocole';
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

const citer = ({ passage: { texte, chemin } }: Demande) =>
    `Document ouvert : ${chemin || '(sans fichier)'}\nPassage sélectionné :\n"""\n${texte}\n"""`;

async function entree(acces: AccesVault, demande: Demande): Promise<string | AgentInputItem[]> {
    switch (demande.agent) {
        case 'chat':
            // Les 12 derniers tours : chaque question renvoie tout l'historique, et se paie.
            return [
                ...demande.historique.slice(-12).map((t) => (t.auteur === 'moi' ? user(t.texte) : assistant(t.texte))),
                user(`${citer(demande)}\n\nQuestion : ${demande.question}`),
            ];
        case 'bilan':
            return `${citer(demande)}\n\nDiscussion :\n${demande.historique
                .map((t) => `${t.auteur === 'moi' ? 'Utilisateur' : 'Agent'} : ${t.texte}`).join('\n')}`;
        case 'aider':
            return `${citer(demande)}\n\n${demande.indices.length > 0
                ? `Indices déjà donnés :\n${demande.indices.map((t, i) => `${i + 1}. ${t}`).join('\n')}`
                : 'Aucun indice donné pour l\'instant.'}`;
        case 'traduire':
            return `${citer(demande)}\n\nLangue cible : ${await langueDuVault(acces)}.`;
        default:
            return citer(demande);
    }
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

    constructor(app: App, reglages: Reglages) {
        this.acces = accesVault(app);
        this.compteur = new Compteur(reglages.plafond);
        setTracingDisabled(true);
        const cle = reglages.cle.trim();
        if (cle && !reglages.factice) {
            // dangerouslyAllowBrowser : assumé, la clé est déjà en page (modèle Obsidian).
            setDefaultOpenAIClient(new OpenAI({ apiKey: cle, dangerouslyAllowBrowser: true }));
            this.agents = creerAgents(this.acces, { fort: reglages.modeleFort, leger: reglages.modeleLeger });
        } else {
            this.agents = null;
        }
    }

    /** Vrai si une clé est configurée ; sinon la page répond en factice. */
    pret(): boolean {
        return this.agents !== null;
    }

    /** `morceau` reçoit le texte du chat en direct. Lève ErreurAgent en cas d'échec, AgentEnPause si pas prêt. */
    async demander(demande: Demande, morceau?: (texte: string) => void): Promise<Sortie> {
        if (!this.agents) throw new AgentEnPause('Hone sans clé.');
        const refus = this.compteur.refus();
        if (refus) throw new ErreurAgent(refus);

        const agent = this.agents[demande.agent];
        try {
            const items = await entree(this.acces, demande);
            if (demande.agent === 'chat') {
                const flux = await run(this.agents.chat, items, { stream: true, maxTurns: 10 });
                for await (const ev of flux) {
                    if (ev.type === 'raw_model_stream_event' && ev.data.type === 'output_text_delta') {
                        morceau?.(ev.data.delta);
                    }
                }
                await flux.completed;
                this.compteur.noter(flux.state.usage);
                return { texte: String(flux.finalOutput ?? ''), source: source(flux.newItems) };
            }
            const resultat = await run(agent, items, { maxTurns: 6 });
            this.compteur.noter(resultat.state.usage);
            const final = resultat.finalOutput as Record<string, unknown> | string | undefined;
            return demande.agent === 'bilan'
                ? { texte: String(final ?? '') }
                : demande.agent === 'definir' || demande.agent === 'resumer'
                    ? { texte: String((final as { texte: string }).texte), source: source(resultat.newItems) }
                    : (final as Sortie);
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
export function ouvrirMoteur(app: App, reglages: Reglages): () => void {
    const courant = moteur = new Moteur(app, reglages);
    return () => {
        if (moteur === courant) moteur = null;
    };
}

/** Null hors du plugin chargé (tests, e2e en factice). */
export function moteurCourant(): Moteur | null {
    return moteur;
}
