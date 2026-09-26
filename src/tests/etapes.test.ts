import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunItem } from '@openai/agents';
import { etapeDe } from '../cerveau/moteur';
import type { Etape } from '../pont/protocole';
import { agir, type ContexteQuestion } from '../pont/repondre';
import { decrireEtape, resumerEtapes } from '../ui/etapes';

const etapes: Etape[] = [
    { outil: 'search_vault', detail: 'intégration par parties' },
    { outil: 'read_document', detail: 'cours/poly.md' },
    { outil: 'web', detail: '' },
    { outil: 'create_function', detail: 'compter_definitions' },
    { outil: 'call_function', detail: 'compter_definitions' },
];

describe('les étapes en mots', () => {
    it('au présent pendant l\'attente, au passé dans le parcours', () => {
        expect(decrireEtape(etapes[0], false)).toBe('Cherche « intégration par parties » dans tes notes');
        expect(decrireEtape(etapes[1], true)).toBe('Lu cours/poly.md');
        expect(decrireEtape(etapes[2], true)).toBe('Cherché sur le web');
        expect(decrireEtape(etapes[3], false)).toBe('Se fabrique la fonction « compter_definitions »');
        expect(decrireEtape({ outil: 'remember', detail: '' }, true)).toBe('Fouillé sa mémoire');
    });

    it('le parcours replié compte recherches, lectures et fonctions', () => {
        expect(resumerEtapes(etapes)).toBe('2 recherches, 1 lecture, 2 fonctions');
        expect(resumerEtapes([etapes[1]])).toBe('1 lecture');
    });
});

describe('etapeDe', () => {
    const appel = (name: string, args: object): RunItem => ({
        type: 'tool_call_item', rawItem: { type: 'function_call', name, arguments: JSON.stringify(args) },
    }) as unknown as RunItem;

    it('garde le champ qui dit ce que vise l\'outil', () => {
        expect(etapeDe(appel('search_vault', { requete: 'Jeanne' }))).toEqual({ outil: 'search_vault', detail: 'Jeanne' });
        expect(etapeDe(appel('create_function', { nom: 'f', code: 'x' }))).toEqual({ outil: 'create_function', detail: 'f' });
        expect(etapeDe(appel('remember', { semaine: '2026-W39', recherche: null }))).toEqual({ outil: 'remember', detail: '2026-W39' });
        expect(etapeDe(appel('run_code', { code: 'x' }))).toEqual({ outil: 'run_code', detail: '' });
        expect(etapeDe({ type: 'message_output_item' } as unknown as RunItem)).toBeNull();
    });
});

describe('agir, en factice', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    const contexte: ContexteQuestion = { texte: 'Calculer l\'intégrale de x e^x', chemin: 'exo.md', from: 0, to: 10 };

    it('montre ses étapes pendant l\'attente et les garde dans la réponse', async () => {
        const vues: Etape[] = [];
        const reponse = agir('aider', contexte, [], (e) => vues.push(e));
        await vi.runAllTimersAsync();
        const recue = await reponse;
        expect(vues.map((e) => e.outil)).toEqual(['search_vault', 'read_document']);
        expect(recue.etapes).toEqual(vues);
    });

    it('Traduire n\'a pas d\'étape factice', async () => {
        const reponse = agir('traduire', contexte);
        await vi.runAllTimersAsync();
        expect((await reponse).etapes).toBeUndefined();
    });
});
