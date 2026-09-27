import type { App } from 'fragment';
import { bornesDe, PROFILS } from '../codex/profils';
import { ServeurCodex, transportReel, type FabriqueTransport } from '../codex/serveur';
import { rangerImage } from '../codex/images';
import { vaultRoot } from '../codex/racine';
import type { Memoire } from '../memoire/outils-memoire';
import type { Demande, Etape, Message, Passage, Sortie, Sorties, Source } from '../pont/protocole';
import type { Reglages } from '../reglages/reglages';
import { BASE } from './agents';
import type { Langue } from './gradium';
import { langueDuVault } from './langue';
import { AgentEnPause, citer, ErreurAgent } from './moteur';
import { accesVault, type AccesVault } from './vault';

// Le moteur qui fait tourner la bulle et les outils sur Codex, avec le compte ChatGPT
// (pas de clé API). Même contrat que le moteur OpenAI (moteur.ts) : une Demande entre,
// une Sortie sort ; la façade (pont/repondre.ts) ne voit pas la différence.
//
// Codex ne voit ni l'écran ni le trait : le passage entouré est recopié dans le texte
// de la demande (citer), avec le document et la mémoire. Le vault ne sert qu'à aller
// plus loin, par les deux outils de lecture, pour les agents qui les ont (profils.ts).

/** Le texte envoyé à Codex : mémoire et document, le passage, puis ce que la mission demande. */
async function texteDe(acces: AccesVault, d: Demande, avant: string): Promise<string> {
    const passage = citer(d, avant);
    switch (d.agent) {
        case 'chat': {
            // Chaque question part dans un fil neuf : la conversation d'avant voyage avec elle.
            const fil = d.historique.slice(-12)
                .map((m) => `${m.auteur === 'moi' ? 'Utilisateur' : 'Toi'} : ${m.texte}`).join('\n\n');
            return `${passage}${fil ? `\n\nConversation jusqu'ici :\n${fil}` : ''}\n\nQuestion : ${d.question}`;
        }
        case 'bilan':
            return `${passage}\n\nDiscussion :\n${d.historique
                .map((m) => `${m.auteur === 'moi' ? 'Utilisateur' : 'Agent'} : ${m.texte}`).join('\n')}`;
        case 'aider':
            return `${passage}\n\n${d.indices.length > 0
                ? `Indices déjà donnés :\n${d.indices.map((t, i) => `${i + 1}. ${t}`).join('\n')}`
                : 'Aucun indice donné pour l\'instant.'}`;
        case 'traduire':
            return `${passage}\n\nLangue cible : ${await langueDuVault(acces)}.`;
        default:
            return passage;
    }
}

/** Ce que l'étiquette d'attente montre d'un appel : la requête ou le chemin. */
function etape(nom: string, args: Record<string, unknown>): Etape {
    const detail = [args.requete, args.chemin, args.query].find((v) => typeof v === 'string' && v);
    return { outil: nom, detail: typeof detail === 'string' ? detail : '' };
}

/** D'après les outils réellement appelés : le web prime, puis le vault. */
function source(outils: string[]): Source {
    if (outils.includes('web')) return 'web';
    return outils.some((o) => o === 'search_vault' || o === 'read_document') ? 'vault' : 'modele';
}

/** La discussion orale : ce qui change de l'écrit. */
const A_L_ORAL = `Tu parles à voix haute avec l'utilisateur, à propos du passage cité. Réponds en deux ou trois phrases.
Réponds dans la langue où l'utilisateur vient de parler : en anglais s'il parle anglais, en français sinon. Indique cette langue dans \`langue\`.
Pas de Markdown, pas de liste, pas de formule : tout ce que tu écris est dit.`;

/** La réplique orale et sa langue, qui choisit la voix (gradium.ts). */
const SCHEMA_ORAL = {
    type: 'object',
    properties: { texte: { type: 'string' }, langue: { type: 'string', enum: ['fr', 'en'] } },
    required: ['texte', 'langue'],
    additionalProperties: false,
};

function messagePourUtilisateur(err: unknown): string {
    const msg = String((err as Error)?.message ?? err);
    if (/ENOENT|spawn/i.test(msg)) return 'Codex n\'est pas connecté : binaire introuvable (codexPath dans data.json).';
    if (/not logged in|login|unauthori[sz]ed|401/i.test(msg)) return 'Codex n\'est pas connecté : lance `codex login` dans un terminal.';
    if (/usage limit|rate limit|429/i.test(msg)) return 'Limite de ton compte ChatGPT atteinte : réessaie plus tard.';
    if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network|stream disconnected/i.test(msg)) return 'Pas de connexion : vérifie ta connexion internet.';
    return `Codex n'a pas pu répondre : ${msg}`;
}

export class MoteurCodex {
    private readonly acces: AccesVault;
    private readonly serveur: ServeurCodex;
    /** La racine du vault : les chemins du vault s'y ajoutent pour Codex. */
    private readonly cwd: string;

    constructor(private readonly app: App, private readonly reglages: Reglages, private readonly memoire?: Memoire, fabrique?: FabriqueTransport) {
        this.acces = accesVault(app);
        const cwd = this.cwd = vaultRoot(app);
        this.serveur = new ServeurCodex(cwd, fabrique ?? transportReel(reglages.codex.codexPath, cwd));
    }

    /** Faux seulement en mode factice (e2e) : Codex se lance à la première demande. */
    pret(): boolean {
        return !this.reglages.factice;
    }

    /** `morceau` reçoit le texte du chat en direct, `surEtape` chaque outil appelé. */
    async demander(demande: Demande, morceau?: (texte: string) => void, surEtape?: (etape: Etape) => void): Promise<Sortie> {
        if (!this.pret()) throw new AgentEnPause('Hone en factice.');
        const profil = PROFILS[demande.agent];
        try {
            const souvenirs = await this.memoire?.avant(demande);
            const avant = [souvenirs?.memoire, souvenirs?.document].filter(Boolean).join('\n\n');
            const fin = await this.serveur.demander(
                bornesDe(demande.agent, this.acces, this.memoire?.preferences.bloc() ?? ''),
                await texteDe(this.acces, demande, avant),
                {
                    schema: profil.schema,
                    effort: profil.effort,
                    morceau: demande.agent === 'chat' ? morceau : undefined,
                    surOutil: (nom, args) => surEtape?.(etape(nom, args)),
                    images: this.images(demande.passage),
                },
            );
            let sortie = this.sortieDe(demande, fin.texte, fin.outils);
            if (demande.agent === 'visualiser') sortie = await this.avecImage(sortie as Sorties['visualiser'], fin.images);
            void this.memoire?.noter(demande, sortie, fin.outils);
            return sortie;
        } catch (err) {
            if (err instanceof ErreurAgent) throw err;
            console.error(`[hone] codex ${demande.agent} :`, err);
            throw new ErreurAgent(messagePourUtilisateur(err));
        }
    }

    private sortieDe(demande: Demande, texte: string, outils: string[]): Sortie {
        switch (demande.agent) {
            case 'chat':
                return { texte, source: source(outils) };
            case 'bilan':
                return { texte };
            default: {
                let json: Record<string, unknown>;
                try {
                    json = JSON.parse(texte);
                } catch {
                    throw new ErreurAgent('Codex a rendu une réponse illisible.');
                }
                if (demande.agent === 'titre') return { sujet: String(json.sujet ?? '') };
                return demande.agent === 'definir' || demande.agent === 'resumer'
                    ? { texte: String(json.texte ?? ''), source: source(outils) }
                    : json as unknown as Sortie;
            }
        }
    }

    /** Une image générée prend la place du dessin ; « image » annoncée sans image reçue : pas de visuel. */
    private async avecImage(v: Sorties['visualiser'] & { forme?: string }, images: string[]): Promise<Sorties['visualiser']> {
        const derniere = images.at(-1);
        const chemin = derniere ? await rangerImage(this.app, derniere) : null;
        if (chemin) return { possible: true, svg: null, raison: null, image: chemin };
        if (v.forme === 'image') return { possible: false, svg: null, raison: 'L\'image n\'a pas pu être générée.', image: null };
        return { possible: v.possible, svg: v.svg, raison: v.raison, image: null };
    }

    /** La capture d'une zone sans texte, en chemin absolu pour Codex. */
    private images(passage: Passage): string[] {
        return passage.image ? [`${this.cwd}/${passage.image}`] : [];
    }

    /** La clé Gradium de la discussion orale ; vide : pas de voix. */
    cleGradium(): string {
        return this.reglages.gradiumCle;
    }

    /** La discussion orale : la réponse à une phrase dite (appel.ts), sans outils ni web.
     *  À l'oral, Hone parle et répond ; il ne va rien chercher, la réponse vient plus vite. */
    async direOral(passage: Passage, historique: Message[], phrase: string): Promise<{ texte: string; langue: Langue }> {
        if (!this.pret()) throw new AgentEnPause('Hone en factice.');
        const fil = historique.slice(-12)
            .map((m) => `${m.auteur === 'moi' ? 'Utilisateur' : 'Toi'} : ${m.texte}`).join('\n\n');
        const texte = `${citer({ agent: 'chat', passage, question: phrase, historique }, '')}`
            + `${fil ? `\n\nCe qui s'est déjà dit à voix haute :\n${fil}` : ''}\n\nL'utilisateur vient de dire : ${phrase}`;
        try {
            const fin = await this.serveur.demander(
                { consignes: `${BASE}\n${A_L_ORAL}${this.memoire?.preferences.bloc() ?? ''}`, outils: [], web: false },
                texte, { effort: 'low', schema: SCHEMA_ORAL, images: this.images(passage) },
            );
            const json = JSON.parse(fin.texte) as { texte?: unknown; langue?: unknown };
            return { texte: String(json.texte ?? ''), langue: json.langue === 'en' ? 'en' : 'fr' };
        } catch (err) {
            console.error('[hone] codex oral :', err);
            throw new ErreurAgent(messagePourUtilisateur(err));
        }
    }

    arreter(): void {
        this.serveur.arreter();
    }
}

let moteur: MoteurCodex | null = null;

/** Au chargement du plugin et à chaque changement de réglages ; la fonction rendue arrête Codex. */
export function ouvrirMoteurCodex(app: App, reglages: Reglages, memoire?: Memoire): () => void {
    const courant = moteur = new MoteurCodex(app, reglages, memoire);
    return () => {
        courant.arreter();
        if (moteur === courant) moteur = null;
    };
}

/** Null hors du plugin chargé (tests). */
export function moteurCodexCourant(): MoteurCodex | null {
    return moteur;
}
