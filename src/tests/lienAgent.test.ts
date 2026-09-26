import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Demande, Retour } from '../pont/protocole';

// Un faux processus de l'agent : on lui fait envoyer ce qu'on veut, quand on veut.
const enfant = Object.assign(new EventEmitter(), { connected: true, send: vi.fn(), kill: vi.fn() });
vi.mock('child_process', () => ({ fork: () => enfant }));

const { LienAgent } = await import('../pont/lienAgent');

const demande: Demande = { agent: 'chat', passage: { texte: 'x', chemin: '' }, question: 'q', historique: [] };
const retour = (r: Retour) => enfant.emit('message', r);

describe('LienAgent, limite de temps', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('un chat qui s\'écrit plus de 90 s n\'est pas coupé tant que les morceaux arrivent', async () => {
        const reponse = new LienAgent('/vault', '/plugin').demander(demande);
        for (let i = 0; i < 4; i++) {
            vi.advanceTimersByTime(80_000);
            retour({ id: 1, type: 'morceau', texte: 'a' });
        }
        retour({ id: 1, type: 'fin', sortie: { texte: 'aaaa', source: 'modele' } });
        await expect(reponse).resolves.toEqual({ texte: 'aaaa', source: 'modele' });
    });

    it('90 s de silence après un morceau font échouer la demande', async () => {
        const reponse = new LienAgent('/vault', '/plugin').demander(demande);
        vi.advanceTimersByTime(50_000);
        retour({ id: 1, type: 'morceau', texte: 'a' });
        vi.advanceTimersByTime(90_000);
        await expect(reponse).rejects.toThrow('trop de temps');
    });
});
