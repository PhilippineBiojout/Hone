import { AppServerTransport, type TransportHandlers } from './transport';
import { JsonRpcClient, type Json } from './rpc';

// Un seul `codex app-server` pour toute la page, que la bulle et les outils de la barre
// partagent (le panneau du dock garde le sien). Chaque demande ouvre un fil éphémère,
// borné par son profil : ses consignes, SES outils (fournis par nous, `dynamicTools`),
// le web ou non, et aucun accès à la machine (`environments: []`, ni shell ni fichiers).

/** Un outil qu'on fournit à Codex : il le voit, l'appelle, et c'est nous qui l'exécutons. */
export interface OutilFourni {
    name: string;
    description: string;
    inputSchema: Json;
    executer(args: Record<string, unknown>): Promise<string>;
}

/** Ce qui borne un fil. */
export interface Bornes {
    consignes: string;
    outils: OutilFourni[];
    web: boolean;
    /** Génération d'images permise (Visualiser seulement) ; sinon coupée, Codex l'ayant d'office. */
    image?: boolean;
}

export interface Tour {
    /** Le format imposé de la réponse (JSON Schema strict) ; sans lui, du texte libre. */
    schema?: Json;
    effort?: 'low' | 'medium' | 'high';
    /** Le texte de la réponse finale, en direct. */
    morceau?: (texte: string) => void;
    /** Chaque outil appelé (les nôtres, ou une recherche web). */
    surOutil?: (nom: string, args: Record<string, unknown>) => void;
}

export interface FinDeTour {
    texte: string;
    /** Les outils appelés, dans l'ordre (`web` pour une recherche web, `image` pour une image). */
    outils: string[];
    /** Les images générées pendant le tour, en base64. */
    images: string[];
}

/** Le transport, remplaçable dans les tests. */
export type FabriqueTransport = (handlers: TransportHandlers) => Pick<AppServerTransport, 'start' | 'send' | 'stop'>;

const DELAI_MAX = 120_000;

interface EnCours {
    outils: Map<string, OutilFourni>;
    tour: Tour;
    appeles: string[];
    finales: Set<string>;
    texte: string;
    images: string[];
    fini: (r: FinDeTour) => void;
    echec: (e: Error) => void;
}

export class ServeurCodex {
    private rpc: JsonRpcClient | null = null;
    private transport: ReturnType<FabriqueTransport> | null = null;
    private pret: Promise<void> | null = null;
    private readonly fils = new Map<string, EnCours>();
    private dernierStderr = '';

    constructor(private readonly cwd: string, private readonly fabrique: FabriqueTransport) {}

    /** Lance le processus et fait la poignée de main, une fois ; relancé s'il est mort. */
    private demarrer(): Promise<void> {
        this.pret ??= (async () => {
            const transport = this.fabrique({
                onLine: (l) => this.rpc?.handleLine(l),
                onStderr: (l) => { this.dernierStderr = l; },
                onExit: (code) => this.mort(`Codex s'est arrêté (${code ?? '?'}). ${this.dernierStderr}`.trim()),
            });
            this.transport = transport;
            this.rpc = new JsonRpcClient(
                transport as AppServerTransport,
                (m, p) => this.notification(m, p),
                (id, m, p) => void this.requete(id, m, p),
            );
            transport.start();
            await this.rpc.request('initialize', {
                clientInfo: { name: 'hone', title: 'Hone', version: '0.1.0' },
                capabilities: { experimentalApi: true },
            });
            this.rpc.notify('initialized');
        })().catch((err) => {
            this.pret = null;
            throw err;
        });
        return this.pret;
    }

    private mort(raison: string): void {
        this.rpc?.rejectAll(new Error(raison));
        for (const f of this.fils.values()) f.echec(new Error(raison));
        this.fils.clear();
        this.rpc = null;
        this.transport = null;
        this.pret = null;
    }

    /** Un fil neuf borné par `bornes`, puis un tour ; rend la réponse finale. */
    async demander(bornes: Bornes, texte: string, tour: Tour = {}): Promise<FinDeTour> {
        await this.demarrer();
        const rpc = this.rpc!;
        const fil = await rpc.request<Json>('thread/start', {
            cwd: this.cwd,
            ephemeral: true,
            approvalPolicy: 'never',
            sandbox: 'read-only',
            environments: [],
            config: { web_search: bornes.web ? 'live' : 'disabled', features: { image_generation: bornes.image === true } },
            developerInstructions: bornes.consignes,
            dynamicTools: bornes.outils.map(({ name, description, inputSchema }) => ({ type: 'function', name, description, inputSchema })),
        });
        const id = idDuFil(fil);
        if (!id) throw new Error('Codex n\'a pas ouvert de fil.');

        const fin = new Promise<FinDeTour>((fini, echec) => {
            this.fils.set(id, {
                outils: new Map(bornes.outils.map((o) => [o.name, o])),
                tour, appeles: [], finales: new Set(), texte: '', images: [], fini, echec,
            });
        });
        let delai: ReturnType<typeof setTimeout> | undefined;
        const minuteur = new Promise<never>((_, echec) => {
            delai = setTimeout(() => echec(new Error('Codex n\'a pas répondu à temps.')), DELAI_MAX);
        });
        try {
            await rpc.request('turn/start', {
                threadId: id,
                input: [{ type: 'text', text: texte }],
                ...(tour.schema ? { outputSchema: tour.schema } : {}),
                ...(tour.effort ? { effort: tour.effort } : {}),
            });
            return await Promise.race([fin, minuteur]);
        } finally {
            clearTimeout(delai);
            this.fils.delete(id);
        }
    }

    private notification(methode: string, p: Json): void {
        const fil = typeof p.threadId === 'string' ? this.fils.get(p.threadId) : undefined;
        if (!fil) return;
        const item = p.item as Json | undefined;
        switch (methode) {
            case 'item/started':
                // Seule la réponse finale s'affiche ; les messages « commentary » (« Je vais lire… ») non.
                if (item?.type === 'agentMessage' && item.phase === 'final_answer') fil.finales.add(String(item.id));
                if (item?.type === 'dynamicToolCall') {
                    fil.appeles.push(String(item.tool));
                    fil.tour.surOutil?.(String(item.tool), (item.arguments ?? {}) as Record<string, unknown>);
                }
                if (item?.type === 'webSearch') {
                    fil.appeles.push('web');
                    fil.tour.surOutil?.('web', { requete: typeof item.query === 'string' ? item.query : '' });
                }
                if (item?.type === 'imageGeneration') {
                    fil.appeles.push('image');
                    fil.tour.surOutil?.('image', {});
                }
                break;
            case 'item/agentMessage/delta':
                if (fil.finales.has(String(p.itemId)) && typeof p.delta === 'string') fil.tour.morceau?.(p.delta);
                break;
            case 'item/completed':
                if (item?.type === 'agentMessage' && item.phase === 'final_answer') fil.texte = String(item.text ?? '');
                if (item?.type === 'imageGeneration' && item.status === 'completed' && typeof item.result === 'string' && item.result) {
                    fil.images.push(item.result);
                }
                break;
            case 'turn/completed': {
                const turn = (p.turn ?? {}) as Json;
                if (turn.status === 'failed' || turn.error) {
                    const e = turn.error as Json | null;
                    fil.echec(new Error(String(e?.message ?? 'Codex a échoué.')));
                } else {
                    fil.fini({ texte: fil.texte, outils: fil.appeles, images: fil.images });
                }
                break;
            }
        }
    }

    /** Codex nous demande quelque chose : exécuter un de nos outils, ou une permission (refusée). */
    private async requete(id: number | string, methode: string, p: Json): Promise<void> {
        const rpc = this.rpc;
        if (!rpc) return;
        if (methode !== 'item/tool/call') {
            rpc.respond(id, { decision: 'decline' });
            return;
        }
        const outil = typeof p.threadId === 'string' ? this.fils.get(p.threadId)?.outils.get(String(p.tool)) : undefined;
        let texte: string;
        let success = true;
        if (!outil) {
            texte = `Outil inconnu : ${String(p.tool)}`;
            success = false;
        } else {
            try {
                texte = await outil.executer((p.arguments ?? {}) as Record<string, unknown>);
            } catch (err) {
                texte = `Erreur : ${String((err as Error)?.message ?? err)}`;
                success = false;
            }
        }
        rpc.respond(id, { success, contentItems: [{ type: 'inputText', text: texte }] });
    }

    arreter(): void {
        this.transport?.stop();
        this.mort('Codex arrêté.');
    }
}

function idDuFil(r: Json): string | null {
    const thread = r.thread as Json | undefined;
    const id = thread?.id ?? r.threadId ?? r.id;
    return typeof id === 'string' ? id : null;
}

/** Le vrai transport : `codex app-server` lancé dans `cwd`. */
export const transportReel = (codexPath: string, cwd: string): FabriqueTransport =>
    (handlers) => new AppServerTransport(codexPath, cwd, handlers);
