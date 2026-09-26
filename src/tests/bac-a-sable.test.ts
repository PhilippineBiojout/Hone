import { Worker } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
import { executer, RESULTAT_MAX, type Courtier, type Fabrique, type PortWorker } from '../atelier/bac-a-sable';

// Node n'a pas de Web Worker : un worker_threads joue le rôle, derrière une petite
// couche qui lui donne `self`, `postMessage` et `addEventListener`. Node a un fetch
// global, un require et un process : c'est un vrai test de la liste blanche.
// L'import() n'y est pas contrôlé (Node l'autorise, en page c'est la CSP du cœur).
const fabriqueNode: Fabrique = (source) => {
    const couche = `
        const { parentPort } = require('node:worker_threads');
        globalThis.self = globalThis;
        globalThis.postMessage = (m) => parentPort.postMessage(m);
        globalThis.addEventListener = (type, f) => parentPort.on('message', (data) => f({ data }));
    `;
    const w = new Worker(couche + source, { eval: true });
    const port: PortWorker = {
        onmessage: null,
        postMessage: (m) => w.postMessage(m),
        terminate: () => void w.terminate(),
    };
    w.on('message', (data) => port.onmessage?.({ data }));
    return port;
};

const aucun: Courtier = async (op) => {
    throw new Error(`inattendu : ${op}`);
};
const lancer = (code: string, args: unknown = {}, courtier: Courtier = aucun, delai = 5000) =>
    executer(code, args, courtier, { fabrique: fabriqueNode, verifierImport: false, delai });

describe('bac à sable', () => {
    it('exécute le code et rend sa valeur', async () => {
        const r = await lancer('return args.a + args.b;', { a: 2, b: 3 });
        expect(r).toEqual({ ok: true, valeur: 5, journal: [] });
    });

    it('efface le réseau, Node et le reste du monde', async () => {
        const r = await lancer(`return [typeof fetch, typeof require, typeof process, typeof WebSocket, typeof XMLHttpRequest,
            typeof importScripts, typeof globalThis, typeof self, typeof eval, typeof Function('return this')().fetch];`);
        expect(r.ok).toBe(true);
        expect(new Set(r.valeur as string[])).toEqual(new Set(['undefined']));
    });

    it('arrête une boucle infinie', async () => {
        const debut = Date.now();
        const r = await lancer('while (true) {}', {}, aucun, 500);
        expect(r.ok).toBe(false);
        expect(r.erreur).toMatch(/Temps dépassé/);
        expect(Date.now() - debut).toBeLessThan(1500);
    });

    it('rend le message d\'une exception', async () => {
        const r = await lancer('throw new Error("raté");');
        expect(r).toMatchObject({ ok: false, erreur: 'raté' });
    });

    it('tronque un résultat trop gros', async () => {
        const r = await lancer(`return 'a'.repeat(${RESULTAT_MAX + 50});`);
        expect(String(r.valeur)).toMatch(/tronqué/);
    });

    it('passe par le courtier pour hone.*, et garde le journal', async () => {
        const courtier: Courtier = async (op, params) => (op === 'vault.lire' ? `contenu de ${params.chemin}` : null);
        const r = await lancer('hone.journal("lu"); return await hone.vault.lire(args.c);', { c: 'a.md' }, courtier);
        expect(r).toEqual({ ok: true, valeur: 'contenu de a.md', journal: ['lu'] });
    });

    it('rend au code le refus du courtier', async () => {
        const courtier: Courtier = async () => {
            throw new Error('Refusé : non');
        };
        const r = await lancer('try { await hone.commandes.lancer("x"); } catch (e) { return e.message; }', {}, courtier);
        expect(r.valeur).toBe('Refusé : non');
    });

    it('refuse un code vide ou trop long', async () => {
        expect((await lancer('  ')).ok).toBe(false);
        expect((await lancer('x'.repeat(7000))).erreur).toMatch(/trop long/);
    });

    it('n\'exécute rien si une fuite subsiste', async () => {
        // Un monde où fetch ne peut pas être effacé : le prélude doit refuser.
        const fuyante: Fabrique = (source) => fabriqueNode(`Object.defineProperty(globalThis, 'fetch', { value: () => 1, configurable: false, writable: false });\n${source}`);
        const r = await executer('return 1;', {}, aucun, { fabrique: fuyante, verifierImport: false });
        expect(r.ok).toBe(false);
        expect(r.erreur).toMatch(/non étanche.*fetch/);
    });
});
