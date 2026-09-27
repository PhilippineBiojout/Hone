import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Stroke } from '../interactions/annotation';
import { RegistreTraces, TRAIT_PERDU, type Contenu, type StockageTraces } from '../interactions/registreTraces';

function fauxStockage(initial: string | null = null): StockageTraces & { contenu: () => string | null } {
    let texte = initial;
    return {
        lire: async () => texte,
        ecrire: async (t) => {
            texte = t;
        },
        contenu: () => texte,
    };
}

const trait = (id = 's1', pos = 3): Stroke => ({ id, pos, points: [{ dx: 0, dy: 0 }], color: '#000', width: 2, tool: 'crayon' });
const definition: Contenu = { type: 'outil', outil: 'definir', texte: 'une définition' };
const zone = (chemin: string, from: number, to: number, texte: string) => ({ chemin, from, to, texte });
const doc = (texte: string) => {
    const lignes = texte.split('\n');
    return { lineCount: () => lignes.length, getLine: (n: number) => lignes[n] };
};

describe('registre des traces', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('garde les traces de chaque document, quel que soit celui qui est affiché', () => {
        const r = new RegistreTraces(fauxStockage());
        r.ajouter(zone('a.md', 0, 5, 'Alpha'), trait(), definition, null);
        r.ajouter(zone('b.md', 0, 4, 'Beta'), trait('s2'), definition, null);
        expect(r.pour('a.md').map((t) => t.zone.texte)).toEqual(['Alpha']);
        expect(r.pour('b.md').map((t) => t.zone.texte)).toEqual(['Beta']);
    });

    it('écrit sur disque et relit au lancement suivant', async () => {
        const s = fauxStockage();
        const r = new RegistreTraces(s);
        const t = r.ajouter(zone('a.md', 2, 7, 'lpha '), trait('s4', 1), definition, { dx: 1, dy: 2, width: 300, height: 200 });
        vi.advanceTimersByTime(400);
        await Promise.resolve();
        expect(s.contenu()).not.toBeNull();

        const relu = new RegistreTraces(s);
        await relu.charger();
        const [u] = relu.pour('a.md');
        expect(u).toMatchObject({ id: t.id, zone: t.zone, contenu: definition, cadre: t.cadre, decalageTrait: -1 });
        // Le cœur a oublié ce trait : son id ne doit plus désigner celui d'un autre.
        expect(u.trait.id).toBe(`${TRAIT_PERDU}s4`);
        // Les id repartent après les anciens.
        expect(relu.ajouter(zone('a.md', 0, 1, 'x'), trait(), definition, null).id).toBeGreaterThan(t.id);
    });

    it('écrit une réponse posée sans attendre, et diffère le remappage', async () => {
        const s = fauxStockage();
        const r = new RegistreTraces(s);
        r.ajouter(zone('a.md', 5, 6, 'x'), trait(), definition, null);
        await Promise.resolve();
        expect(JSON.parse(s.contenu()!).documents['a.md'][0].zone.from).toBe(5);
        r.remapper('a.md', (p) => ({ pos: p + 1 }), () => 'x');
        await Promise.resolve();
        expect(JSON.parse(s.contenu()!).documents['a.md'][0].zone.from).toBe(5);
        vi.advanceTimersByTime(400);
        await Promise.resolve();
        expect(JSON.parse(s.contenu()!).documents['a.md'][0].zone.from).toBe(6);
    });

    it('vider écrit tout de suite ce qui attend', async () => {
        const s = fauxStockage();
        const r = new RegistreTraces(s);
        r.ajouter(zone('a.md', 0, 1, 'x'), trait(), definition, null);
        r.remapper('a.md', (p) => ({ pos: p + 2 }), () => 'x');
        await r.vider();
        expect(JSON.parse(s.contenu()!).documents['a.md'][0].zone.from).toBe(2);
        expect(JSON.parse(s.contenu()!).documents['a.md']).toHaveLength(1);
    });

    it('ignore un fichier illisible et les entrées mal formées', async () => {
        const casse = new RegistreTraces(fauxStockage('{pas du json'));
        await casse.charger();
        expect(casse.pour('a.md')).toEqual([]);
        const mixte = new RegistreTraces(fauxStockage(JSON.stringify({ documents: { 'a.md': [{ id: 'x' }, null] } })));
        await mixte.charger();
        expect(mixte.pour('a.md')).toEqual([]);
    });

    it('supprime une trace, et elle ne revient pas au lancement suivant', async () => {
        const s = fauxStockage();
        const r = new RegistreTraces(s);
        const t = r.ajouter(zone('a.md', 0, 1, 'x'), trait(), definition, null);
        expect(r.supprimer(t.id)?.id).toBe(t.id);
        await r.vider();
        const relu = new RegistreTraces(s);
        await relu.charger();
        expect(relu.pour('a.md')).toEqual([]);
    });

    it('met à jour une trace rouverte sans en créer une autre', () => {
        const r = new RegistreTraces(fauxStockage());
        const t = r.ajouter(zone('a.md', 0, 1, 'x'), trait(), definition, null);
        const chat: Contenu = { type: 'chat', messages: [{ auteur: 'agent', texte: 'suite' }] };
        r.mettreAJour(t.id, chat, null);
        expect(r.pour('a.md')).toHaveLength(1);
        expect(r.pour('a.md')[0].contenu).toEqual(chat);
    });

    it('remappe le passage à l’édition, et le retire quand il est effacé', () => {
        const r = new RegistreTraces(fauxStockage());
        const garde = r.ajouter(zone('a.md', 10, 15, 'ccccc'), trait(), definition, null);
        const efface = r.ajouter(zone('a.md', 0, 3, 'aaa'), trait('s2'), definition, null);
        // Les 5 premiers caractères supprimés.
        const retires = r.remapper('a.md', (p) => ({ pos: Math.max(0, p - 5) }), () => 'ccccc');
        expect(retires).toEqual([efface.id]);
        expect(r.pour('a.md').map((t) => [t.id, t.zone.from, t.zone.to])).toEqual([[garde.id, 5, 10]]);
    });

    it('recale un passage déplacé hors de la vue, au plus près de son ancienne place', () => {
        const r = new RegistreTraces(fauxStockage());
        r.ajouter(zone('a.md', 6, 11, 'monde'), trait(), definition, null);
        r.recaler('a.md', doc('Ajout.\nBonjour monde, et monde encore'));
        const [t] = r.pour('a.md');
        expect(t.zone).toMatchObject({ from: 15, to: 20, texte: 'monde' });
    });

    it('garde un passage introuvable, borné au document', () => {
        const r = new RegistreTraces(fauxStockage());
        r.ajouter(zone('a.md', 40, 45, 'perdu'), trait(), definition, null);
        r.recaler('a.md', doc('court'));
        const [t] = r.pour('a.md');
        expect(t.zone.from).toBeLessThan(t.zone.to);
        expect(t.zone.to).toBeLessThanOrEqual(5);
    });

    it('suit un document renommé, et oublie un document supprimé', () => {
        const r = new RegistreTraces(fauxStockage());
        r.ajouter(zone('a.md', 0, 1, 'x'), trait(), definition, null);
        r.renommer('a.md', 'dossier/a.md');
        expect(r.pour('a.md')).toEqual([]);
        expect(r.pour('dossier/a.md')[0].zone.chemin).toBe('dossier/a.md');
        r.oublierDocument('dossier/a.md');
        expect(r.pour('dossier/a.md')).toEqual([]);
    });

    it('deux vues du même document : seule celle qui a le focus remappe', () => {
        const r = new RegistreTraces(fauxStockage());
        const d1 = r.attacher('a.md');
        expect(r.doitRemapper('a.md', false)).toBe(true);
        const d2 = r.attacher('a.md');
        expect(r.doitRemapper('a.md', false)).toBe(false);
        expect(r.doitRemapper('a.md', true)).toBe(true);
        d2();
        expect(r.doitRemapper('a.md', false)).toBe(true);
        d1();
    });

    it('prévient les vues à chaque changement', () => {
        const r = new RegistreTraces(fauxStockage());
        const vus: string[] = [];
        const stop = r.onChange((c) => vus.push(c));
        r.ajouter(zone('a.md', 0, 1, 'x'), trait(), definition, null);
        stop();
        r.ajouter(zone('b.md', 0, 1, 'y'), trait(), definition, null);
        expect(vus).toEqual(['a.md']);
    });
});
