import path from 'node:path';
import {
    assistant, MaxTurnsExceededError, run, setDefaultOpenAIKey, setTracingDisabled, user,
    type AgentInputItem, type RunItem,
} from '@openai/agents';
import type { Demande, Message, Requete, Retour, Sortie, Source } from '../protocole';
import { creerAgents } from './agents';
import { Compteur } from './couts';
import { langueDuVault } from './langue';

// Le processus de l'agent, lancé par lienAgent.ts avec --vault= et --plugin=.
// Lui seul lit le .env et parle à OpenAI : dans la page, la clé serait lisible
// par tout script, et la CSP n'y laisse pas joindre api.openai.com.

const argument = (nom: string): string => {
    const arg = process.argv.find((a) => a.startsWith(`--${nom}=`));
    if (!arg) throw new Error(`Argument manquant : --${nom}=`);
    return arg.slice(nom.length + 3);
};
const racineVault = argument('vault');
const dossierPlugin = argument('plugin');

try {
    process.loadEnvFile(path.join(dossierPlugin, '.env'));
} catch {
    // pas de .env : chaque demande répondra « clé manquante »
}
const cle = process.env.OPENAI_API_KEY?.trim() ?? '';
// Un sous-processus éventuel n'héritera pas de la clé.
delete process.env.OPENAI_API_KEY;

const compteur = new Compteur(path.join(dossierPlugin, 'couts.jsonl'), Number(process.env.AGENT_PLAFOND_TOKENS ?? 500_000) || 0);
/** À 1, aucune requête ne part vers OpenAI. */
const bloque = process.env.AGENT_BLOQUE?.trim() === '1';

setTracingDisabled(true);
if (cle) setDefaultOpenAIKey(cle);
const agents = cle ? creerAgents(racineVault, {
    fort: process.env.AGENT_MODELE_FORT?.trim() || 'gpt-5.4',
    leger: process.env.AGENT_MODELE_LEGER?.trim() || 'gpt-5.4-mini',
}) : null;

const citer = ({ passage: { texte, chemin } }: Demande) =>
    `Document ouvert : ${chemin || '(sans fichier)'}\nPassage sélectionné :\n"""\n${texte}\n"""`;

function entree(demande: Demande): string | AgentInputItem[] {
    switch (demande.agent) {
        case 'chat':
            // Les 12 derniers tours : chaque question renvoie tout l'historique, et se paie.
            return [
                ...demande.historique.slice(-12).map((t: Message) => (t.auteur === 'moi' ? user(t.texte) : assistant(t.texte))),
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
            return `${citer(demande)}\n\nLangue cible : ${langueDuVault(racineVault)}.`;
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
    if (/401|invalid api key|incorrect api key/i.test(msg)) return 'Clé API refusée par OpenAI : vérifie le .env du plugin.';
    if (/429|quota|rate limit/i.test(msg)) return 'Limite ou crédits OpenAI atteints : réessaie plus tard.';
    if (/model.*(not found|does not exist)/i.test(msg)) return 'Modèle introuvable : vérifie AGENT_MODELE_FORT et AGENT_MODELE_LEGER dans le .env.';
    return 'Une erreur est survenue.';
}

const envoyer = (retour: Retour) => process.send?.(retour);

async function traiter({ id, demande }: Requete): Promise<void> {
    if (bloque) return void envoyer({ id, type: 'pause' });
    if (!agents) return void envoyer({ id, type: 'erreur', message: 'Clé API manquante : ajoute OPENAI_API_KEY dans le .env du plugin.' });
    const refus = compteur.refus();
    if (refus) return void envoyer({ id, type: 'erreur', message: refus });

    const agent = agents[demande.agent];
    const modele = String(agent.model);
    try {
        let sortie: Sortie;
        if (demande.agent === 'chat') {
            const flux = await run(agents.chat, entree(demande), { stream: true, maxTurns: 10 });
            for await (const ev of flux) {
                if (ev.type === 'raw_model_stream_event' && ev.data.type === 'output_text_delta') {
                    envoyer({ id, type: 'morceau', texte: ev.data.delta });
                }
            }
            await flux.completed;
            compteur.noter(demande.agent, modele, flux.state.usage);
            sortie = { texte: String(flux.finalOutput ?? ''), source: source(flux.newItems) };
        } else {
            const resultat = await run(agent, entree(demande), { maxTurns: 6 });
            compteur.noter(demande.agent, modele, resultat.state.usage);
            const final = resultat.finalOutput as Record<string, unknown> | string | undefined;
            sortie = demande.agent === 'bilan'
                ? { texte: String(final ?? '') }
                : demande.agent === 'definir' || demande.agent === 'resumer'
                    ? { texte: String((final as { texte: string }).texte), source: source(resultat.newItems) }
                    : (final as Sortie);
        }
        envoyer({ id, type: 'fin', sortie });
    } catch (err) {
        // OpenAI recopie un bout de la clé dans ses erreurs : on l'efface du terminal.
        console.error(`[agent] ${demande.agent} :`, String((err as Error)?.message ?? err).replace(/sk-[\w*-]+/g, 'sk-…'));
        envoyer({ id, type: 'erreur', message: messagePourUtilisateur(err) });
    }
}

process.on('message', (m) => void traiter(m as Requete));
// Le plugin mort : le processus s'en va avec lui.
process.on('disconnect', () => process.exit(0));
