import { describe, expect, it } from 'vitest';
import { CONSIGNE_IMAGE, PROFILS, bornesDe } from '../codex/profils';
import { ServeurCodex, type FabriqueTransport } from '../codex/serveur';
import type { TransportHandlers } from '../codex/transport';
import type { AccesVault } from '../cerveau/vault';
import { CONSIGNES_ATELIER } from '../atelier/consignes';
import { Journal } from '../memoire/journal';
import { Memoire } from '../memoire/outils-memoire';
import { Preferences } from '../memoire/preferences';

// Un faux `codex app-server` : il répond aux requêtes, et `scenario` joue le tour
// (notifications, appel d'outil) quand `turn/start` arrive.

type Msg = { id?: number; method?: string; params?: Record<string, unknown>; result?: Record<string, unknown> };

function fauxCodex(scenario: (emettre: (m: Msg) => void, attendreReponse: (id: number) => Promise<Msg>) => Promise<void>) {
    const envoyes: Msg[] = [];
    let h: TransportHandlers;
    const attentes = new Map<number, (m: Msg) => void>();
    // Nos réponses aux requêtes de Codex : elles peuvent partir avant qu'on les attende.
    const recues = new Map<number, Msg>();
    const emettre = (m: Msg) => h.onLine(JSON.stringify(m));
    const fabrique: FabriqueTransport = (handlers) => {
        h = handlers;
        return {
            start: () => {},
            stop: () => {},
            send: (brut: unknown) => {
                const m = brut as Msg;
                envoyes.push(m);
                if (m.method === undefined && m.id !== undefined) {
                    recues.set(m.id, m);
                    attentes.get(m.id)?.(m);
                    return;
                }
                if (m.id === undefined) return;
                const id = m.id;
                queueMicrotask(() => {
                    if (m.method === 'thread/start') emettre({ id, result: { thread: { id: 'fil-1' } } });
                    else emettre({ id, result: {} });
                    if (m.method === 'turn/start') {
                        void scenario(emettre, (rid) => (recues.has(rid) ? Promise.resolve(recues.get(rid)!) : new Promise((r) => attentes.set(rid, r))));
                    }
                });
            },
        };
    };
    return { fabrique, envoyes };
}

const vaultVide: AccesVault = { fichiers: () => ['poly.md'], lire: async () => 'Le cours entier.', taille: () => 10 };

describe('ServeurCodex', () => {
    it('borne le fil, exécute nos outils, refuse les permissions, et rend la réponse finale', async () => {
        const { fabrique, envoyes } = fauxCodex(async (emettre, reponse) => {
            emettre({ method: 'item/started', params: { threadId: 'fil-1', item: { type: 'dynamicToolCall', tool: 'read_document', arguments: { chemin: 'poly.md' } } } });
            emettre({ id: 900, method: 'item/tool/call', params: { threadId: 'fil-1', tool: 'read_document', arguments: { chemin: 'poly.md' } } });
            const outil = await reponse(900);
            expect(outil.result).toEqual({ success: true, contentItems: [{ type: 'inputText', text: 'Le cours entier.' }] });
            emettre({ id: 901, method: 'item/commandExecution/requestApproval', params: { threadId: 'fil-1' } });
            expect((await reponse(901)).result).toEqual({ decision: 'decline' });
            emettre({ method: 'item/started', params: { threadId: 'fil-1', item: { type: 'agentMessage', id: 'c', phase: 'commentary' } } });
            emettre({ method: 'item/agentMessage/delta', params: { threadId: 'fil-1', itemId: 'c', delta: 'Je vais lire…' } });
            emettre({ method: 'item/started', params: { threadId: 'fil-1', item: { type: 'agentMessage', id: 'f', phase: 'final_answer' } } });
            emettre({ method: 'item/agentMessage/delta', params: { threadId: 'fil-1', itemId: 'f', delta: 'Bon' } });
            emettre({ method: 'item/agentMessage/delta', params: { threadId: 'fil-1', itemId: 'f', delta: 'jour' } });
            emettre({ method: 'item/completed', params: { threadId: 'fil-1', item: { type: 'agentMessage', id: 'f', phase: 'final_answer', text: 'Bonjour' } } });
            emettre({ method: 'turn/completed', params: { threadId: 'fil-1', turn: { status: 'completed', error: null } } });
        });
        const serveur = new ServeurCodex('/vault', fabrique);
        const morceaux: string[] = [];
        const outils: string[] = [];
        const passage = 'Document ouvert : poly.md\nPassage sélectionné :\n"""\nLe texte entouré\n"""';
        const fin = await serveur.demander(bornesDe('resumer', vaultVide), passage, {
            morceau: (t) => morceaux.push(t), surOutil: (nom) => outils.push(nom),
        });

        expect(fin).toEqual({ texte: 'Bonjour', outils: ['read_document'], images: [] });
        expect(morceaux.join('')).toBe('Bonjour'); // le « commentary » ne s'affiche pas
        expect(outils).toEqual(['read_document']);

        const fil = envoyes.find((m) => m.method === 'thread/start')!.params!;
        expect(fil.environments).toEqual([]); // ni shell ni fichiers
        expect(fil.approvalPolicy).toBe('never');
        expect(fil.config).toEqual({ web_search: 'disabled', features: { image_generation: false } });
        expect((fil.dynamicTools as { name: string }[]).map((t) => t.name)).toEqual(['search_vault', 'read_document']);

        // Le passage entouré voyage mot pour mot dans la demande.
        const tour = envoyes.find((m) => m.method === 'turn/start')!.params!;
        expect(tour.input).toEqual([{ type: 'text', text: passage }]);
    });

    it('une zone écrite à la main voyage en image jointe, après le texte', async () => {
        const { fabrique, envoyes } = fauxCodex(async (emettre) => {
            emettre({ method: 'turn/completed', params: { threadId: 'fil-1', turn: { status: 'completed', error: null } } });
        });
        await new ServeurCodex('/v', fabrique).demander(bornesDe('definir', vaultVide), 'x', { images: ['/v/capture.png'] });

        const tour = envoyes.find((m) => m.method === 'turn/start')!.params!;
        expect(tour.input).toEqual([{ type: 'text', text: 'x' }, { type: 'localImage', path: '/v/capture.png' }]);
    });

    it('Visualiser peut générer une image : elle revient en base64 et l\'étape se voit', async () => {
        const { fabrique, envoyes } = fauxCodex(async (emettre) => {
            emettre({ method: 'item/started', params: { threadId: 'fil-1', item: { type: 'imageGeneration', id: 'i', status: 'in_progress', result: '' } } });
            emettre({ method: 'item/completed', params: { threadId: 'fil-1', item: { type: 'imageGeneration', id: 'i', status: 'completed', result: 'iVBORw0KGgo' } } });
            emettre({ method: 'item/started', params: { threadId: 'fil-1', item: { type: 'agentMessage', id: 'f', phase: 'final_answer' } } });
            emettre({ method: 'item/completed', params: { threadId: 'fil-1', item: { type: 'agentMessage', id: 'f', phase: 'final_answer', text: '{}' } } });
            emettre({ method: 'turn/completed', params: { threadId: 'fil-1', turn: { status: 'completed', error: null } } });
        });
        const etapes: string[] = [];
        const fin = await new ServeurCodex('/v', fabrique).demander(bornesDe('visualiser', vaultVide), 'x', { surOutil: (nom) => etapes.push(nom) });

        expect(fin.images).toEqual(['iVBORw0KGgo']);
        expect(fin.outils).toEqual(['image']);
        expect(etapes).toEqual(['image']);
        const fil = envoyes.find((m) => m.method === 'thread/start')!.params!;
        expect(fil.config).toEqual({ web_search: 'disabled', features: { image_generation: true } });
    });

    it('un échec du tour remonte', async () => {
        const { fabrique } = fauxCodex(async (emettre) => {
            emettre({ method: 'turn/completed', params: { threadId: 'fil-1', turn: { status: 'failed', error: { message: 'usage limit' } } } });
        });
        await expect(new ServeurCodex('/v', fabrique).demander(bornesDe('chat', vaultVide), 'x')).rejects.toThrow('usage limit');
    });
});

describe('mémoire et atelier sur Codex', () => {
    it('le fil reçoit les outils de la mémoire et de l\'atelier, et Codex retient une préférence', async () => {
        const preferences = new Preferences([], () => undefined);
        const memoire = new Memoire(new Journal({ lire: async () => null, ajouter: async () => undefined }), preferences, vaultVide);
        const atelier = [{ name: 'call_function', description: 'x', inputSchema: {}, executer: async () => 'ok' }];
        const bornes = bornesDe('chat', vaultVide, { outils: [...memoire.outils('chat', 'poly.md'), ...atelier], atelier: true });
        expect(bornes.consignes).toContain(CONSIGNES_ATELIER);
        expect(bornesDe('chat', vaultVide).consignes).not.toContain(CONSIGNES_ATELIER);

        const { fabrique, envoyes } = fauxCodex(async (emettre, reponse) => {
            emettre({ method: 'item/started', params: { threadId: 'fil-1', item: { type: 'dynamicToolCall', tool: 'note_preference', arguments: {} } } });
            emettre({ id: 900, method: 'item/tool/call', params: { threadId: 'fil-1', tool: 'note_preference', arguments: { preference: 'Plus court.', retirer: false } } });
            await reponse(900);
            emettre({ method: 'item/completed', params: { threadId: 'fil-1', item: { type: 'agentMessage', id: 'f', phase: 'final_answer', text: 'Noté.' } } });
            emettre({ method: 'turn/completed', params: { threadId: 'fil-1', turn: { status: 'completed', error: null } } });
        });
        const fin = await new ServeurCodex('/v', fabrique).demander(bornes, 'x');
        const fil = envoyes.find((m) => m.method === 'thread/start')!.params as { dynamicTools: { name: string }[] };
        expect(fil.dynamicTools.map((t) => t.name)).toEqual(['search_vault', 'read_document', 'remember', 'note_preference', 'call_function']);
        expect(fin.outils).toContain('note_preference');
        expect(preferences.toutes()).toEqual(['Plus court.']);
    });
});

describe('un outil qui rend des images', () => {
    it('ses pages partent telles quelles à Codex, texte et images', async () => {
        const pages = [{ type: 'inputText' as const, text: '--- Page 1 ---' }, { type: 'inputImage' as const, imageUrl: 'data:image/png;base64,AAAA' }];
        const lire = { name: 'read_document', description: 'x', inputSchema: {}, executer: async () => pages };
        const { fabrique } = fauxCodex(async (emettre, reponse) => {
            emettre({ id: 900, method: 'item/tool/call', params: { threadId: 'fil-1', tool: 'read_document', arguments: { chemin: 'DM.pdf' } } });
            expect((await reponse(900)).result).toEqual({ success: true, contentItems: pages });
            emettre({ method: 'item/completed', params: { threadId: 'fil-1', item: { type: 'agentMessage', id: 'f', phase: 'final_answer', text: 'Lu.' } } });
            emettre({ method: 'turn/completed', params: { threadId: 'fil-1', turn: { status: 'completed', error: null } } });
        });
        expect((await new ServeurCodex('/v', fabrique).demander({ consignes: '', outils: [lire], web: false }, 'x')).texte).toBe('Lu.');
    });
});

describe('profils', () => {
    it('Traduire n\'a que le web ; aucun autre agent n\'a le vault sans en avoir besoin', () => {
        const t = bornesDe('traduire', vaultVide);
        expect(t.outils).toEqual([]);
        expect(t.web).toBe(true);
        expect(bornesDe('resumer', vaultVide).web).toBe(false);
        expect(bornesDe('visualiser', vaultVide).web).toBe(false);
        expect(bornesDe('aider', vaultVide).web).toBe(false);
        expect(bornesDe('bilan', vaultVide).outils).toEqual([]);
    });

    it('seul Visualiser peut générer une image, et seule sa consigne le dit', () => {
        for (const nom of Object.keys(PROFILS) as (keyof typeof PROFILS)[]) {
            const b = bornesDe(nom, vaultVide);
            expect(b.image, nom).toBe(nom === 'visualiser');
            expect(b.consignes.includes(CONSIGNE_IMAGE), nom).toBe(nom === 'visualiser');
        }
    });

    it('chaque sortie structurée est un schéma strict', () => {
        for (const [nom, p] of Object.entries(PROFILS)) {
            if (!p.schema) continue;
            const s = p.schema as { required: string[]; properties: object; additionalProperties: boolean };
            expect(s.additionalProperties, nom).toBe(false);
            expect(s.required.sort(), nom).toEqual(Object.keys(s.properties).sort());
        }
    });
});
