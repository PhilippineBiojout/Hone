import { AgentEnPause } from '../cerveau/moteur';
import { moteurCodexCourant, type MoteurCodex } from '../cerveau/moteur-codex';
import type { Etape, Message, Outil, Passage, Source, Sorties } from './protocole';

export type { Outil, Source } from './protocole';

// La façade que les composants appellent. Tout passe par Codex, avec le compte ChatGPT
// (cerveau/moteur-codex.ts). Le factice ne sert plus qu'aux e2e (réglage `factice`).

export interface ContexteQuestion {
    texte: string;
    /** '' si la vue n'a pas encore de fichier. */
    chemin: string;
    from: number;
    to: number;
}

/** Ce qu'une carte d'outil affiche ; `texte` est ce que le chat reprend. */
export interface ReponseOutil {
    texte: string;
    source?: Source;
    /** Visualiser : à nettoyer avant affichage (nettoyerSvg.ts). */
    svg?: string;
    /** Aider : le prochain indice donnerait la solution. */
    stop?: boolean;
    /** Les outils appelés par l'agent pour y arriver, dans l'ordre. */
    etapes?: Etape[];
}

export interface ReponseOrale {
    texte: string;
    /** Sa voix encodée ; sans elle, la synthèse du système lit `texte`. */
    audio?: ArrayBuffer;
    transcription?: string;
}

export const INDICE_STOP = 'Je ne peux plus t\'aider sans te donner la solution. Pose ta question dans le chat si tu es bloqué.';

/** Par Codex, en factice seulement avec le réglage `factice` (ou hors du plugin chargé).
 *  Toute autre erreur remonte, avec son message pour l'utilisateur. */
async function parAgent<T>(appel: (moteur: MoteurCodex) => Promise<T>, factice: () => Promise<T>): Promise<T> {
    const moteur = moteurCodexCourant();
    if (!moteur?.pret()) return factice();
    try {
        return await appel(moteur);
    } catch (err) {
        if (err instanceof AgentEnPause) return factice();
        throw err;
    }
}

const passage = ({ texte, chemin }: ContexteQuestion): Passage => ({ texte, chemin });
const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));
const extrait = (c: ContexteQuestion, n: number) => (c.texte.length > n ? `${c.texte.slice(0, n)}…` : c.texte);

/** `historique` : la conversation avant cette question ; `morceau` reçoit le texte en direct. */
export async function repondre(
    question: string, contexte: ContexteQuestion, historique: Message[] = [], morceau?: (texte: string) => void,
): Promise<string> {
    return parAgent(
        async (moteur) => (await moteur.demander(
            { agent: 'chat', passage: passage(contexte), question, historique }, morceau,
        ) as Sorties['chat']).texte,
        async () => {
            await attendre(700);
            const n = historique.length;
            const suite = n > 0 ? ` (après ${n} message${n > 1 ? 's' : ''})` : '';
            return `Réponse factice : Hone est en mode factice. `
                + `Question reçue : « ${question} »${suite}, sur « ${extrait(contexte, 60)} ».`;
        },
    );
}

/**
 * `precedents` : les réponses du même outil déjà données sur ce passage (Aider).
 * `surEtape` reçoit chaque outil appelé pendant l'attente ; la réponse les garde toutes.
 */
export async function agir(
    outil: Outil, contexte: ContexteQuestion, precedents: ReponseOutil[] = [], surEtape?: (etape: Etape) => void,
): Promise<ReponseOutil> {
    if (outil === 'aider' && precedents.some((p) => p.stop)) return { texte: INDICE_STOP, stop: true };
    const etapes: Etape[] = [];
    const noter = (etape: Etape): void => {
        etapes.push(etape);
        surEtape?.(etape);
    };
    const reponse = await parAgent(async (moteur): Promise<ReponseOutil> => {
        const sortie = await moteur.demander(outil === 'aider'
            ? { agent: outil, passage: passage(contexte), indices: precedents.map((p) => p.texte) }
            : { agent: outil, passage: passage(contexte) }, undefined, noter);
        switch (outil) {
            case 'visualiser': {
                const v = sortie as Sorties['visualiser'];
                return v.possible && v.svg
                    ? { texte: 'Visuel dessiné par Hone.', svg: v.svg }
                    : { texte: v.raison ?? 'Ce passage ne se prête pas à un visuel.' };
            }
            case 'aider': {
                const a = sortie as Sorties['aider'];
                return a.stop ? { texte: a.texte || INDICE_STOP, stop: true } : { texte: a.texte };
            }
            case 'traduire':
                return { texte: (sortie as Sorties['traduire']).texte };
            default:
                return sortie as Sorties['definir'];
        }
    }, () => agirFactice(outil, contexte, precedents, noter));
    return etapes.length > 0 ? { ...reponse, etapes } : reponse;
}

const FACTICE: Record<Outil, string> = {
    definir: 'Définition factice : Hone n\'a pas de clé.',
    visualiser: 'Visualisation factice.',
    aider: 'Indice factice',
    traduire: 'Traduction factice : Hone traduira vers la langue du vault.',
    resumer: 'Résumé factice : Hone donnera les points clés de la sélection.',
};

const SVG_FACTICE = '<svg viewBox="0 0 320 90" font-family="inherit" font-size="12">'
    + '<line x1="20" y1="45" x2="300" y2="45" stroke="currentColor" stroke-width="2"/>'
    + '<circle cx="40" cy="45" r="6" fill="var(--color-accent)"/><text x="40" y="28" text-anchor="middle" fill="currentColor">1941</text>'
    + '<text x="40" y="72" text-anchor="middle" fill="var(--text-muted)">Z3</text>'
    + '<circle cx="160" cy="45" r="6" fill="var(--color-accent)"/><text x="160" y="28" text-anchor="middle" fill="currentColor">1944</text>'
    + '<text x="160" y="72" text-anchor="middle" fill="var(--text-muted)">Colossus</text>'
    + '<circle cx="280" cy="45" r="6" fill="var(--color-accent)"/><text x="280" y="28" text-anchor="middle" fill="currentColor">1945</text>'
    + '<text x="280" y="72" text-anchor="middle" fill="var(--text-muted)">ENIAC</text></svg>';

async function agirFactice(
    outil: Outil, contexte: ContexteQuestion, precedents: ReponseOutil[], noter: (etape: Etape) => void,
): Promise<ReponseOutil> {
    const e = extrait(contexte, 60);
    // Deux étapes factices, comme un agent qui cherche puis lit : la boucle se voit aussi sans clé.
    if (outil !== 'traduire') {
        await attendre(500);
        noter({ outil: 'search_vault', detail: extrait(contexte, 24) });
        await attendre(500);
        noter({ outil: 'read_document', detail: contexte.chemin || 'note.md' });
        await attendre(500);
    } else {
        await attendre(1500);
    }
    switch (outil) {
        case 'visualiser':
            return { texte: FACTICE.visualiser, svg: SVG_FACTICE };
        case 'aider':
            return precedents.length >= 3
                ? { texte: INDICE_STOP, stop: true }
                : { texte: `${FACTICE.aider} numéro ${precedents.length + 1}, sur « ${e} ».` };
        case 'definir':
            return { texte: `${FACTICE.definir} Passage : « ${e} ».`, source: 'web' };
        default:
            return { texte: `${FACTICE[outil]} Passage : « ${e} ».` };
    }
}

/** Un tour de parole enregistré ; toujours factice (la voix passera par Gradium). */
export async function parler(audio: Blob, contexte: ContexteQuestion, historique: Message[] = []): Promise<ReponseOrale> {
    await attendre(1000);
    const tour = historique.filter((m) => m.auteur === 'moi').length + 1;
    return {
        texte: `Réponse orale factice numéro ${tour}. J'ai bien reçu ${audio.size > 0 ? 'ton enregistrement' : 'un enregistrement vide'}, `
            + `sur le passage « ${extrait(contexte, 40)} ». Le back n'est pas encore branché.`,
        transcription: `Transcription factice du tour ${tour}.`,
    };
}

/** Le bilan écrit d'une discussion orale, à sa fermeture. */
export async function resumerOral(historique: Message[], contexte: ContexteQuestion): Promise<string> {
    return parAgent(
        async (moteur) => (await moteur.demander({ agent: 'bilan', passage: passage(contexte), historique }) as Sorties['bilan']).texte,
        async () => {
            await attendre(1200);
            const tours = historique.filter((m) => m.auteur === 'moi').length;
            return `• Bilan factice : Hone est en mode factice.\n`
                + `• ${tours} tour${tours > 1 ? 's' : ''} de parole sur « ${extrait(contexte, 40)} ».\n`
                + `• Hone donnera ici les points clés de la discussion.`;
        },
    );
}
