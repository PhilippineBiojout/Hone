import { Worker } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
import type { Fabrique, PortWorker } from '../atelier/bac-a-sable';
import { Bibliotheque, egal, lireAtelier, PLAFOND_FONCTIONS, ressemblance, type Definition } from '../atelier/bibliotheque';
import { COMMANDES_AFFICHAGE, creerCourtier, type Commandes } from '../atelier/courtier';
import { Atelier, idCommande, PROFONDEUR_MAX } from '../atelier/outils-atelier';
import type { AccesVault } from '../cerveau/vault';

const fabriqueNode: Fabrique = (source) => {
    const couche = `
        const { parentPort } = require('node:worker_threads');
        globalThis.self = globalThis;
        globalThis.postMessage = (m) => parentPort.postMessage(m);
        globalThis.addEventListener = (type, f) => parentPort.on('message', (data) => f({ data }));
    `;
    const w = new Worker(couche + source, { eval: true });
    const port: PortWorker = { onmessage: null, postMessage: (m) => w.postMessage(m), terminate: () => void w.terminate() };
    w.on('message', (data) => port.onmessage?.({ data }));
    return port;
};

function fauxVault(fichiers: Record<string, string>): AccesVault {
    return {
        fichiers: () => Object.keys(fichiers).sort(),
        lire: async (rel) => (rel in fichiers ? fichiers[rel] : null),
        taille: (rel) => (rel in fichiers ? fichiers[rel].length : null),
    };
}

function fauxRegistre() {
    const lancees: string[] = [];
    const commandes: Commandes = {
        lister: () => [
            { id: 'workspace:new-tab', name: 'Nouvel onglet' },
            { id: 'app:delete-file', name: 'Supprimer le fichier actif' },
            { id: 'hone:cle-api', name: 'Hone : clé API…' },
        ],
        lancer: (id) => {
            lancees.push(id);
            return true;
        },
    };
    return { commandes, lancees };
}

const compter: Definition = {
    nom: 'compter_mots',
    description: 'Compte les mots d\'une note du vault, pour dire sa longueur.',
    parametres: { type: 'object', properties: { chemin: { type: 'string' } }, required: ['chemin'] },
    code: 'const t = await hone.vault.lire(args.chemin); return t.split(/\\s+/).filter(Boolean).length;',
    tests: [{ args: { chemin: 'a.md' }, attendu: 3 }, { args: { chemin: 'b.md' }, attendu: 1 }],
    argsCommande: { chemin: 'a.md' },
};

function monter(data: unknown = {}) {
    const ajoutees: string[] = [];
    const retirees: string[] = [];
    const notes: string[] = [];
    let sauvegardes = 0;
    const { commandes, lancees } = fauxRegistre();
    const atelier = new Atelier({
        bibliotheque: new Bibliotheque(lireAtelier(data)),
        acces: fauxVault({ 'a.md': 'un deux trois', 'b.md': 'seul', '.fragment/cle.md': 'secret' }),
        commandes,
        ui: { ouvrir: async () => undefined },
        hote: { addCommand: (c) => ajoutees.push(c.id), removeCommand: (id) => retirees.push(id) },
        sauver: () => sauvegardes++,
        notifier: (m) => notes.push(m),
        execution: { fabrique: fabriqueNode, verifierImport: false },
    });
    return { atelier, ajoutees, retirees, notes, lancees, sauvegardes: () => sauvegardes };
}

describe('bibliothèque', () => {
    it('relit data.json et jette les entrées invalides', () => {
        const bon = { ...compter, usage: { appels: 2, reussites: 2, echecs: 0 }, creeLe: 'x', majLe: 'x' };
        const d = lireAtelier({ atelier: { fonctions: { chat: [bon, { nom: 'Pas Bon' }, bon], inconnu: [bon] } } });
        expect(d.fonctions.chat?.map((f) => f.nom)).toEqual(['compter_mots']);
        expect(d.fonctions.chat?.[0].usage.reussites).toBe(2);
        expect(Object.keys(d.fonctions)).toEqual(['chat']);
        expect(lireAtelier(null)).toEqual({ version: 1, fonctions: {} });
    });

    it('refuse un nom, un schéma ou des tests invalides', () => {
        const b = new Bibliotheque(lireAtelier({}));
        expect(b.admissible('chat', { ...compter, nom: 'Compter' })).toMatch(/Nom invalide/);
        expect(b.admissible('chat', { ...compter, parametres: { type: 'string' } })).toMatch(/type object/);
        expect(b.admissible('chat', { ...compter, tests: [compter.tests[0]] })).toMatch(/2 à 3 tests/);
        expect(b.admissible('chat', { ...compter, tests: [{ args: { chemin: 3 }, attendu: 1 }, compter.tests[1]] })).toMatch(/hors du schéma/);
        expect(b.admissible('chat', { ...compter, argsCommande: {} })).toMatch(/args_commande/);
    });

    it('refuse un doublon sous un autre nom, et renvoie vers le remplacement', () => {
        const b = new Bibliotheque(lireAtelier({}));
        expect(b.enregistrer('chat', compter).ok).toBe(true);
        const r = b.enregistrer('chat', { ...compter, nom: 'longueur_note' });
        expect(r.ok).toBe(false);
        expect(!r.ok && r.erreur).toMatch(/Ressemble trop à ta fonction « compter_mots »/);
        expect(b.enregistrer('chat', { ...compter, code: 'return 0;' })).toMatchObject({ ok: true, remplacee: true });
        expect(b.lister('chat')).toHaveLength(1);
    });

    it('applique le plafond et nomme la moins utile', () => {
        const b = new Bibliotheque(lireAtelier({}));
        const themes = ['astronomie', 'botanique', 'chimie', 'dynamique', 'economie', 'finance', 'geologie', 'histoire',
            'informatique', 'justice', 'kinesie', 'linguistique', 'musique'];
        for (let i = 0; i < PLAFOND_FONCTIONS; i++) {
            expect(b.enregistrer('chat', { ...compter, nom: `f_${i}_x`, description: `Outil de ${themes[i]}` }).ok).toBe(true);
        }
        b.noterUsage('chat', 'f_3_x', false);
        const r = b.enregistrer('chat', { ...compter, nom: 'f_neuve', description: 'Outil de musique' });
        expect(!r.ok && r.erreur).toMatch(/Plafond.*« f_3_x »/);
    });

    it('tient les bibliothèques séparées par agent, et le catalogue', () => {
        const b = new Bibliotheque(lireAtelier({}));
        b.enregistrer('definir', compter);
        expect(b.lister('chat')).toHaveLength(0);
        expect(b.catalogue('chat')).toMatch(/aucune/);
        expect(b.catalogue('definir')).toMatch(/compter_mots.*\n.*chemin/);
    });

    it('compare en profondeur et mesure la ressemblance', () => {
        expect(egal({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
        expect(egal({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
        expect(egal([1, 2], [2, 1])).toBe(false);
        expect(ressemblance('Compte les mots d\'une note', 'compte les MOTS de la note')).toBeGreaterThan(0.6);
        expect(ressemblance('Compte les mots', 'Trie les dates')).toBe(0);
    });
});

describe('courtier', () => {
    const { commandes, lancees } = fauxRegistre();
    const courtier = creerCourtier({ acces: fauxVault({ 'a.md': 'x' }), commandes, ui: { ouvrir: async () => undefined } });

    it('refuse les dossiers cachés et la sortie du vault', async () => {
        await expect(courtier('vault.lire', { chemin: '.fragment/cle.md' })).rejects.toThrow(/Refusé/);
        await expect(courtier('vault.lire', { chemin: '../x.md' })).rejects.toThrow(/Refusé/);
        await expect(courtier('vault.lire', { chemin: 'a.md' })).resolves.toBe('x');
    });

    it('n\'a aucune opération d\'écriture', async () => {
        await expect(courtier('vault.creer', { chemin: 'b.md' })).rejects.toThrow(/inconnue/);
        await expect(courtier('vault.ajouter', { chemin: 'a.md' })).rejects.toThrow(/inconnue/);
    });

    it('ne lance que les commandes d\'affichage, jamais celles de Hone', async () => {
        expect(await courtier('commandes.lister', {})).toEqual([{ id: 'workspace:new-tab', name: 'Nouvel onglet' }]);
        await expect(courtier('commandes.lancer', { id: 'app:delete-file' })).rejects.toThrow(/Refusé/);
        await expect(courtier('commandes.lancer', { id: 'hone:cle-api' })).rejects.toThrow(/Refusé/);
        await expect(courtier('commandes.lancer', { id: 'workspace:new-tab' })).resolves.toBe('Nouvel onglet');
        expect(lancees).toEqual(['workspace:new-tab']);
        expect(COMMANDES_AFFICHAGE.has('app:delete-file')).toBe(false);
    });

    it('ne lance rien en simulation', async () => {
        const reg = fauxRegistre();
        const sim = creerCourtier({ acces: fauxVault({}), commandes: reg.commandes, ui: { ouvrir: async () => undefined }, simulation: true });
        expect(await sim('commandes.lancer', { id: 'workspace:new-tab' })).toMatch(/simulé/);
        expect(reg.lancees).toEqual([]);
    });
});

describe('atelier', () => {
    it('teste, enregistre, déclare la commande et sauve', async () => {
        const m = monter();
        expect(await m.atelier.creer('chat', compter)).toMatch(/Enregistrée/);
        expect(m.ajoutees).toEqual([idCommande('chat', 'compter_mots')]);
        expect(m.sauvegardes()).toBe(1);
        expect(m.notes[0]).toMatch(/fabriqué « compter_mots »/);
    });

    it('n\'enregistre pas une fonction qui répond faux', async () => {
        const m = monter();
        const r = await m.atelier.creer('chat', { ...compter, tests: [{ args: { chemin: 'a.md' }, attendu: 4 }, compter.tests[1]] });
        expect(r).toMatch(/Pas enregistrée. Test 1 faux : attendu 4, obtenu 3/);
        expect(m.atelier.bibliotheque.lister('chat')).toHaveLength(0);
        expect(m.ajoutees).toEqual([]);
    });

    it('appelle une fonction, compte son usage, refuse des args hors schéma', async () => {
        const m = monter();
        await m.atelier.creer('chat', compter);
        expect(await m.atelier.appeler('chat', 'compter_mots', { chemin: 'a.md' })).toMatchObject({ ok: true, valeur: 3 });
        expect((await m.atelier.appeler('chat', 'compter_mots', { chemin: 42 })).erreur).toMatch(/hors du schéma/);
        expect((await m.atelier.appeler('chat', 'compter_mots', { chemin: 'absent.md' })).ok).toBe(false);
        expect(m.atelier.bibliotheque.trouver('chat', 'compter_mots')?.usage).toEqual({ appels: 2, reussites: 1, echecs: 1 });
        expect((await m.atelier.appeler('definir', 'compter_mots', { chemin: 'a.md' })).erreur).toMatch(/inconnue/);
    });

    it('les fonctions s\'appellent entre elles, à profondeur bornée', async () => {
        const m = monter();
        await m.atelier.creer('chat', compter);
        const double: Definition = {
            nom: 'double_longueur',
            description: 'Double la longueur mesurée par la fonction de comptage, exemple de composition.',
            parametres: compter.parametres,
            code: 'return 2 * await hone.fonctions.appeler("compter_mots", { chemin: args.chemin });',
            tests: [{ args: { chemin: 'a.md' }, attendu: 6 }, { args: { chemin: 'b.md' }, attendu: 2 }],
            argsCommande: { chemin: 'a.md' },
        };
        expect(await m.atelier.creer('chat', double)).toMatch(/Enregistrée/);
        const boucle: Definition = {
            ...double, nom: 'boucle_sans_fin', description: 'Une récursion volontaire pour éprouver la borne de profondeur.',
            code: 'return await hone.fonctions.appeler("boucle_sans_fin", args);',
            tests: [{ args: { chemin: 'a.md' }, attendu: 0 }, { args: { chemin: 'b.md' }, attendu: 0 }],
        };
        expect(await m.atelier.creer('chat', boucle)).toMatch(/Test 1 en erreur.*imbriqués \(3 niveaux/);
        expect(PROFONDEUR_MAX).toBe(3);
    });

    it('supprime une fonction et sa commande', async () => {
        const m = monter();
        await m.atelier.creer('chat', compter);
        expect(m.atelier.supprimer('chat', 'compter_mots')).toMatch(/Supprimée/);
        expect(m.retirees).toEqual([idCommande('chat', 'compter_mots')]);
        expect(m.atelier.supprimer('chat', 'compter_mots')).toMatch(/inconnue/);
    });

    it('au démarrage, déclare une commande par fonction apprise', () => {
        const bon = { ...compter, usage: { appels: 0, reussites: 0, echecs: 0 }, creeLe: 'x', majLe: 'x' };
        const m = monter({ atelier: { fonctions: { chat: [bon], definir: [bon] } } });
        m.atelier.declarerTout(['chat', 'definir']);
        expect(m.ajoutees).toEqual(['chat-compter_mots', 'definir-compter_mots']);
    });

    it('les méta-outils sont propres à chaque agent', () => {
        const m = monter();
        const a = m.atelier.outils('chat');
        const b = m.atelier.outils('definir');
        expect(a.map((t) => t.name)).toEqual(['list_commands', 'run_command', 'run_code', 'create_function', 'call_function', 'delete_function']);
        expect(a[0]).not.toBe(b[0]);
    });
});
