import { describe, expect, it } from 'vitest';
import type { AccesVault } from '../cerveau/vault';
import { autour, blocDocument, plan } from '../memoire/contexte-doc';
import { blocMemoire, fenetre, PLAFOND_FENETRE, rappeler, semaineDe } from '../memoire/fenetre';
import { borner, Journal, reduireSvg, REPONSE_MAX, type Echange, type Stockage } from '../memoire/journal';
import { Memoire } from '../memoire/outils-memoire';
import { lirePreferences, Preferences, PREFERENCES_MAX } from '../memoire/preferences';

const MAINTENANT = new Date('2026-09-26T12:00:00Z');
const ilYa = (jours: number) => new Date(MAINTENANT.getTime() - jours * 86_400_000).toISOString();
const ech = (jours: number, note: string, demande = 'q', reponse = 'r'): Echange => ({
    date: ilYa(jours), agent: 'chat', note, passage: 'p', demande, reponse, outils: [],
});

function fauxStockage(initial: string | null = null): Stockage & { contenu: () => string } {
    let texte = initial;
    return {
        lire: async () => texte,
        ajouter: async (t) => {
            texte = (texte ?? '') + t;
        },
        contenu: () => texte ?? '',
    };
}

describe('journal', () => {
    it('relit le fichier et ignore une ligne corrompue', async () => {
        const bon = JSON.stringify(ech(1, 'a.md'));
        const j = new Journal(fauxStockage(`${bon}\n{pas du json\n${JSON.stringify({ date: 'hier' })}\n${bon}\n`));
        await j.charger();
        expect(j.tous()).toHaveLength(2);
    });

    it('ajoute une ligne par échange, dans l\'ordre', async () => {
        const s = fauxStockage();
        const j = new Journal(s);
        await j.charger();
        void j.noter(ech(0, 'a.md', 'un'));
        await j.noter(ech(0, 'a.md', 'deux'));
        expect(s.contenu().trim().split('\n').map((l) => JSON.parse(l).demande)).toEqual(['un', 'deux']);
    });

    it('réduit un SVG et borne la réponse', () => {
        const svg = '<svg viewBox="0 0 10 10"><title>Frise</title><rect/><circle/><text>a</text></svg>';
        expect(reduireSvg(svg)).toBe('[schéma SVG « Frise », 3 éléments]');
        expect(borner({ ...ech(0, 'a.md'), reponse: svg }).reponse).toBe('[schéma SVG « Frise », 3 éléments]');
        expect(borner({ ...ech(0, 'a.md'), reponse: 'x'.repeat(5000) }).reponse.length).toBe(REPONSE_MAX + 1);
    });
});

describe('fenêtre', () => {
    const echanges = [ech(30, 'cours.md', 'vieux sur ce cours'), ech(20, 'autre.md', 'vieux ailleurs'),
        ech(3, 'autre.md', 'récent ailleurs'), ech(1, 'cours.md', 'récent sur ce cours')];

    it('prend tout ce document, quel que soit l\'âge, puis le récent ailleurs', () => {
        const f = fenetre(echanges, 'cours.md', MAINTENANT);
        expect(f.document.map((e) => e.demande)).toEqual(['vieux sur ce cours', 'récent sur ce cours']);
        expect(f.recent.map((e) => e.demande)).toEqual(['récent ailleurs']);
    });

    it('sans document, seulement les 7 derniers jours', () => {
        const f = fenetre(echanges, '', MAINTENANT);
        expect(f.document).toEqual([]);
        expect(f.recent.map((e) => e.demande)).toEqual(['récent ailleurs', 'récent sur ce cours']);
    });

    it('sous le plafond, coupe le récent avant le document, et le plus ancien d\'abord', () => {
        const long = 'x'.repeat(2500);
        const e = [ech(40, 'cours.md', 'doc ancien', long), ech(2, 'cours.md', 'doc récent', long), ech(1, 'autre.md', 'ailleurs', long)];
        const f = fenetre(e, 'cours.md', MAINTENANT, PLAFOND_FENETRE);
        expect(f.document.map((x) => x.demande)).toEqual(['doc ancien', 'doc récent']);
        expect(f.recent).toEqual([]);
        const serre = fenetre(e, 'cours.md', MAINTENANT, 3000);
        expect(serre.document.map((x) => x.demande)).toEqual(['doc récent']);
    });

    it('le bloc met le récent d\'abord et ce document juste avant la demande', () => {
        const bloc = blocMemoire(fenetre(echanges, 'cours.md', MAINTENANT));
        expect(bloc.indexOf('d\'autres notes')).toBeLessThan(bloc.indexOf('ce document'));
        expect(bloc).toMatch(/DONNÉE/);
        expect(blocMemoire({ document: [], recent: [] })).toBe('');
    });
});

describe('remember', () => {
    const echanges = [ech(30, 'cours.md', 'la guerre de Cent Ans'), ech(3, 'autre.md', 'Révolution'), ech(1, 'cours.md', 'Jeanne d\'Arc')];

    it('sans argument, rend l\'index par semaine', () => {
        const r = rappeler(echanges, {});
        expect(r).toMatch(/Index/);
        expect(r).toContain(semaineDe(new Date(ilYa(30))));
    });

    it('rend les échanges bruts d\'une semaine, ou d\'une date', () => {
        expect(rappeler(echanges, { semaine: semaineDe(new Date(ilYa(30))) })).toMatch(/Cent Ans/);
        expect(rappeler(echanges, { semaine: ilYa(30).slice(0, 10) })).toMatch(/Cent Ans/);
        expect(rappeler(echanges, { semaine: 'bientôt' })).toMatch(/illisible/);
    });

    it('cherche un mot, sans accents ni casse, et filtre par note', () => {
        expect(rappeler(echanges, { recherche: 'revolution' })).toMatch(/Révolution/);
        expect(rappeler(echanges, { recherche: 'revolution', note: 'cours.md' })).toMatch(/Rien/);
    });

    it('calcule la semaine ISO', () => {
        expect(semaineDe(new Date('2026-09-26T12:00:00Z'))).toBe('2026-W39');
        expect(semaineDe(new Date('2027-01-01T12:00:00Z'))).toBe('2026-W53');
    });
});

describe('contexte du document', () => {
    it('rend le plan et le texte autour du passage', () => {
        const texte = `# Titre\n${'a'.repeat(3000)}\n## Partie\nLE PASSAGE ICI\n${'b'.repeat(3000)}`;
        expect(plan(texte)).toBe('# Titre\n## Partie');
        const a = autour(texte, 'LE PASSAGE ICI', 200);
        expect(a).toContain('LE PASSAGE ICI');
        expect(a.startsWith('…')).toBe(true);
        expect(blocDocument(null, 'x')).toBe('');
        expect(blocDocument('court', 'x')).toContain('court');
    });
});

describe('préférences', () => {
    it('ajoute, refuse un doublon, retire, et plafonne', () => {
        let sauvees = 0;
        const p = new Preferences([], () => sauvees++);
        expect(p.noter('Définitions plus courtes', false)).toMatch(/notée/);
        expect(p.noter('définitions plus COURTES', false)).toMatch(/Déjà/);
        expect(p.bloc()).toMatch(/Définitions plus courtes/);
        expect(p.noter('Définitions plus courtes', true)).toMatch(/retirée/);
        expect(sauvees).toBe(2);
        for (let i = 0; i < PREFERENCES_MAX; i++) p.noter(`préférence ${i}`, false);
        expect(p.noter('une de trop', false)).toMatch(/au plus/);
    });

    it('relit data.json proprement', () => {
        expect(lirePreferences({ preferences: [' a ', 'A', 3, '', 'b'] })).toEqual(['a', 'b']);
        expect(lirePreferences(null)).toEqual([]);
    });
});

describe('mémoire', () => {
    const acces: AccesVault = {
        fichiers: () => ['cours.md'],
        lire: async (rel) => (rel === 'cours.md' ? '# Cours\nLa suite.' : null),
        taille: () => 10,
    };

    it('note un échange et le rend à la demande suivante sur ce document', async () => {
        const m = new Memoire(new Journal(fauxStockage()), new Preferences([], () => undefined), acces);
        const demande = { agent: 'chat' as const, passage: { texte: 'La suite.', chemin: 'cours.md' }, question: 'Pourquoi ?', historique: [] };
        await m.noter(demande, { texte: 'Parce que.', source: 'modele' }, ['search_vault'], MAINTENANT);
        const avant = await m.avant(demande, MAINTENANT);
        expect(avant.memoire).toMatch(/Déjà dit sur ce document :\n.*« Pourquoi \? » → Parce que\./);
        expect(avant.document).toMatch(/Plan du document :\n# Cours/);
        expect(m.outils('chat', 'note.md').map((t) => t.name)).toEqual(['remember', 'note_preference']);
    });
});
