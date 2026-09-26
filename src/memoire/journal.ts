import type { NomAgent } from '../pont/protocole';

// Le journal de la mémoire. L'API d'OpenAI ne se souvient de rien : chaque appel
// repart de zéro, et c'est l'app qui lui renvoie ce qu'il doit savoir. On note donc
// chaque échange, de chaque agent, dans memoire.jsonl, à côté de data.json dans le
// dossier du plugin, jamais dans les notes. Append-only : une ligne par échange.
// Les réponses encombrantes sont réduites à l'écriture (un SVG ne se relit pas, il
// mangerait le plafond de la fenêtre).

export interface Echange {
    /** ISO 8601. */
    date: string;
    agent: NomAgent;
    /** Le chemin de la note, '' si la vue n'avait pas de fichier. */
    note: string;
    passage: string;
    demande: string;
    reponse: string;
    /** Les outils que l'agent a appelés pour répondre. */
    outils: string[];
}

/** Où le journal s'écrit : l'adapter du vault en page, un faux dans les tests. */
export interface Stockage {
    /** Le contenu, ou null si le fichier n'existe pas encore. */
    lire(): Promise<string | null>;
    ajouter(texte: string): Promise<void>;
}

export const PASSAGE_MAX = 300;
export const DEMANDE_MAX = 600;
export const REPONSE_MAX = 1_500;

const couper = (t: string, n: number) => (t.length > n ? `${t.slice(0, n)}…` : t);

/** Un SVG se résume à ce qu'il montre : son titre et son nombre d'éléments. */
export function reduireSvg(svg: string): string {
    const titre = /<title[^>]*>([^<]{1,120})<\/title>/i.exec(svg)?.[1]?.trim();
    const elements = (svg.match(/<(rect|circle|ellipse|line|path|polyline|polygon|text)\b/gi) ?? []).length;
    return `[schéma SVG${titre ? ` « ${titre} »` : ''}, ${elements} éléments]`;
}

/** Borne chaque champ ; ce qui ressemble à un SVG est réduit. */
export function borner(e: Echange): Echange {
    const reponse = /<svg[\s>]/i.test(e.reponse) ? e.reponse.replace(/<svg[\s\S]*?<\/svg>/gi, reduireSvg) : e.reponse;
    return {
        ...e,
        passage: couper(e.passage, PASSAGE_MAX),
        demande: couper(e.demande, DEMANDE_MAX),
        reponse: couper(reponse, REPONSE_MAX),
        outils: e.outils.slice(0, 20),
    };
}

function relire(ligne: string): Echange | null {
    try {
        const e = JSON.parse(ligne) as Partial<Echange>;
        if (typeof e.date !== 'string' || Number.isNaN(Date.parse(e.date)) || typeof e.agent !== 'string') return null;
        return {
            date: e.date, agent: e.agent as NomAgent, note: String(e.note ?? ''), passage: String(e.passage ?? ''),
            demande: String(e.demande ?? ''), reponse: String(e.reponse ?? ''),
            outils: Array.isArray(e.outils) ? e.outils.map(String) : [],
        };
    } catch {
        return null;
    }
}

export class Journal {
    private echanges: Echange[] = [];
    private ecriture: Promise<void> = Promise.resolve();

    constructor(private readonly stockage: Stockage) {}

    /** Relit le fichier ; une ligne corrompue est ignorée, pas le reste. */
    async charger(): Promise<void> {
        const texte = await this.stockage.lire().catch(() => null);
        this.echanges = (texte ?? '').split('\n').filter((l) => l.trim()).map(relire)
            .filter((e): e is Echange => e !== null);
    }

    tous(): readonly Echange[] {
        return this.echanges;
    }

    /** Ajoute un échange ; les écritures se suivent dans l'ordre, sans se chevaucher. */
    noter(e: Echange): Promise<void> {
        const b = borner(e);
        this.echanges.push(b);
        this.ecriture = this.ecriture
            .then(() => this.stockage.ajouter(`${JSON.stringify(b)}\n`))
            .catch((err) => console.error('[hone] mémoire :', err));
        return this.ecriture;
    }
}
