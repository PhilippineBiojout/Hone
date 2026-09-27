import type { Stroke } from './annotation';
import type { Cadre } from '../positionnement/fenetre';
import type { Message } from '../pont/protocole';
import type { ContexteQuestion, Outil, ReponseOutil } from '../pont/repondre';

/** Une réponse d'outil, une conversation (née d'un outil ou non), ou une discussion orale et son bilan. */
export type Contenu =
    | ({ type: 'outil'; outil: Outil } & ReponseOutil)
    | { type: 'chat'; messages: Message[]; outil?: Outil }
    | { type: 'oral'; messages: Message[]; bilan: string };

export interface Trace {
    readonly id: number;
    /** Remappé à l'édition, comme la zone de l'agent. */
    zone: ContexteQuestion;
    trait: Stroke;
    /** L'écart entre le trait et le début du passage, pour recaler le trait à la réouverture. */
    decalageTrait: number;
    contenu: Contenu;
    cadre: Cadre | null;
    /** Le sujet écrit par Hone pour les têtes (« Question sur … ») : rouverte, la réponse le garde. */
    sujet?: string;
}

export interface StockageTraces {
    lire(): Promise<string | null>;
    ecrire(texte: string): Promise<void>;
}

/** Ce que le registre lit d'un document pour recaler un passage. */
export interface TexteDocument {
    lineCount(): number;
    getLine(n: number): string;
}

/**
 * Un trait relu du disque n'existe plus dans le cœur (ses traits vivent en mémoire), et ses id
 * repartent de s1 à chaque lancement : sans ce préfixe, la poubelle effacerait le trait d'un autre.
 */
export const TRAIT_PERDU = 'perdu-';

const DELAI_SAUVEGARDE = 300;

/**
 * L'historique de l'agent, par document. Il appartient au plugin et non au calque : le cœur
 * remonte les calques à chaque ouverture de fichier, et le carnet d'une vue mourait avec elle
 * (même frontière que l'AnnotationSource du cœur). Écrit dans traces.json : une réponse ne part
 * que par la poubelle.
 */
export class RegistreTraces {

    private readonly parDocument = new Map<string, Trace[]>();
    private readonly abonnes = new Set<(chemin: string) => void>();
    /** Les vues montées par document : deux onglets du même document ne remappent qu'une fois. */
    private readonly vues = new Map<string, number>();
    private prochainId = 1;
    private minuterie: ReturnType<typeof setTimeout> | null = null;

    constructor(private readonly stockage: StockageTraces) {}

    async charger(): Promise<void> {
        let brut: unknown;
        try {
            brut = JSON.parse((await this.stockage.lire()) ?? '{}');
        } catch {
            return;
        }
        const docs = (brut as { documents?: unknown } | null)?.documents;
        if (!docs || typeof docs !== 'object') return;
        for (const [chemin, liste] of Object.entries(docs as Record<string, unknown>)) {
            if (!Array.isArray(liste)) continue;
            const traces = liste.filter(estTrace).map((t) => ({
                ...t,
                zone: { ...t.zone, chemin },
                trait: t.trait.id.startsWith(TRAIT_PERDU) ? t.trait : { ...t.trait, id: `${TRAIT_PERDU}${t.trait.id}` },
            }));
            if (traces.length > 0) this.parDocument.set(chemin, traces);
            for (const t of traces) this.prochainId = Math.max(this.prochainId, t.id + 1);
        }
        // Les vues déjà montées (la note ouverte au démarrage) placent leurs icônes maintenant.
        for (const chemin of this.parDocument.keys()) for (const cb of this.abonnes) cb(chemin);
    }

    pour(chemin: string): readonly Trace[] {
        return this.parDocument.get(chemin) ?? [];
    }

    trouver(id: number): Trace | undefined {
        for (const liste of this.parDocument.values()) {
            const t = liste.find((x) => x.id === id);
            if (t) return t;
        }
        return undefined;
    }

    ajouter(zone: ContexteQuestion, trait: Stroke, contenu: Contenu, cadre: Cadre | null, sujet?: string | null): Trace {
        const trace: Trace = {
            id: this.prochainId++, zone, trait, decalageTrait: trait.pos - zone.from, contenu, cadre, ...(sujet ? { sujet } : {}),
        };
        this.liste(zone.chemin).push(trace);
        this.changer(zone.chemin, true);
        return trace;
    }

    mettreAJour(id: number, contenu: Contenu, cadre: Cadre | null, sujet?: string | null): void {
        const t = this.trouver(id);
        if (!t) return;
        Object.assign(t, { contenu, cadre, ...(sujet ? { sujet } : {}) });
        this.changer(t.zone.chemin, true);
    }

    supprimer(id: number): Trace | null {
        for (const [chemin, liste] of this.parDocument) {
            const i = liste.findIndex((t) => t.id === id);
            if (i < 0) continue;
            const [trace] = liste.splice(i, 1);
            if (liste.length === 0) this.parDocument.delete(chemin);
            this.changer(chemin, true);
            return trace;
        }
        return null;
    }

    /**
     * Le passage suit le texte. Un passage effacé en entier disparaît avec sa trace ; les id
     * retirés sont rendus pour que la vue ôte leurs icônes.
     */
    remapper(chemin: string, mapPos: (pos: number, assoc: 1 | -1) => { pos: number }, texte: (from: number, to: number) => string): number[] {
        const liste = this.parDocument.get(chemin);
        if (!liste) return [];
        const retires: number[] = [];
        for (let i = liste.length - 1; i >= 0; i--) {
            const t = liste[i];
            const from = mapPos(t.zone.from, 1).pos;
            const to = mapPos(t.zone.to, -1).pos;
            if (to <= from) {
                retires.push(t.id);
                liste.splice(i, 1);
            } else t.zone = { ...t.zone, from, to, texte: texte(from, to) };
        }
        if (liste.length === 0) this.parDocument.delete(chemin);
        this.changer(chemin);
        return retires;
    }

    /**
     * Le document a pu changer hors de toute vue (autre app, autre lancement) : un passage qui ne
     * lit plus son texte le retrouve au plus près de son ancienne place. Introuvable, il reste où
     * il est, borné au document : rien ne se perd sans la poubelle.
     */
    recaler(chemin: string, doc: TexteDocument): void {
        const liste = this.parDocument.get(chemin);
        if (!liste) return;
        const lignes: string[] = [];
        for (let n = 0; n < doc.lineCount(); n++) lignes.push(doc.getLine(n));
        const tout = lignes.join('\n');
        // Un document vide est un document pas encore chargé : on ne recale rien sur lui.
        if (tout.length === 0) return;
        let change = false;
        for (const t of liste) {
            const { from, to, texte } = t.zone;
            if (tout.slice(from, to) === texte) continue;
            const pos = plusProche(tout, texte, from);
            const debut = pos ?? Math.min(from, Math.max(0, tout.length - 1));
            const fin = pos !== null ? pos + texte.length : Math.min(Math.max(to, debut + 1), tout.length);
            if (debut === from && fin === to) continue;
            t.zone = { ...t.zone, from: debut, to: fin, texte: pos !== null ? texte : tout.slice(debut, fin) };
            change = true;
        }
        if (change) this.changer(chemin);
    }

    /** Une vue du document se monte : elle rend de quoi se détacher. */
    attacher(chemin: string): () => void {
        this.vues.set(chemin, (this.vues.get(chemin) ?? 0) + 1);
        return () => {
            const n = (this.vues.get(chemin) ?? 1) - 1;
            if (n <= 0) this.vues.delete(chemin);
            else this.vues.set(chemin, n);
        };
    }

    /** Plusieurs vues d'un même document : seule celle qui a le focus remappe. */
    doitRemapper(chemin: string, aLeFocus: boolean): boolean {
        return (this.vues.get(chemin) ?? 0) <= 1 || aLeFocus;
    }

    renommer(ancien: string, nouveau: string): void {
        const liste = this.parDocument.get(ancien);
        if (!liste) return;
        this.parDocument.delete(ancien);
        for (const t of liste) t.zone = { ...t.zone, chemin: nouveau };
        this.parDocument.set(nouveau, [...(this.parDocument.get(nouveau) ?? []), ...liste]);
        this.changer(ancien);
        this.changer(nouveau, true);
    }

    oublierDocument(chemin: string): void {
        if (!this.parDocument.delete(chemin)) return;
        this.changer(chemin, true);
    }

    onChange(cb: (chemin: string) => void): () => void {
        this.abonnes.add(cb);
        return () => this.abonnes.delete(cb);
    }

    /** Écrit tout de suite ce qui attend (fermeture du plugin). */
    async vider(): Promise<void> {
        if (this.minuterie === null) return;
        clearTimeout(this.minuterie);
        this.minuterie = null;
        await this.stockage.ecrire(this.enJSON());
    }

    enJSON(): string {
        return JSON.stringify({ version: 1, documents: Object.fromEntries(this.parDocument) });
    }

    private liste(chemin: string): Trace[] {
        let l = this.parDocument.get(chemin);
        if (!l) this.parDocument.set(chemin, (l = []));
        return l;
    }

    /**
     * Une réponse posée, rouverte ou supprimée s'écrit tout de suite : l'app peut se fermer dans la
     * foulée. Le remappage, qui suit la frappe, attend une pause.
     */
    private changer(chemin: string, immediat = false): void {
        for (const cb of this.abonnes) cb(chemin);
        if (this.minuterie !== null) clearTimeout(this.minuterie);
        this.minuterie = null;
        if (immediat) {
            void this.stockage.ecrire(this.enJSON()).catch(() => {});
            return;
        }
        this.minuterie = setTimeout(() => {
            this.minuterie = null;
            void this.stockage.ecrire(this.enJSON()).catch(() => {});
        }, DELAI_SAUVEGARDE);
    }
}

/** L'occurrence de `aiguille` la plus proche de `pres`, ou null. */
function plusProche(meule: string, aiguille: string, pres: number): number | null {
    if (!aiguille) return null;
    let meilleure: number | null = null;
    for (let i = meule.indexOf(aiguille); i >= 0; i = meule.indexOf(aiguille, i + 1)) {
        if (meilleure === null || Math.abs(i - pres) < Math.abs(meilleure - pres)) meilleure = i;
    }
    return meilleure;
}

function estTrace(x: unknown): x is Trace {
    const t = x as Partial<Trace> | null;
    return !!t && typeof t.id === 'number' && !!t.zone && typeof t.zone.from === 'number' && typeof t.zone.to === 'number'
        && typeof t.zone.texte === 'string' && !!t.trait && typeof t.trait.id === 'string' && !!t.contenu
        && typeof t.decalageTrait === 'number';
}
