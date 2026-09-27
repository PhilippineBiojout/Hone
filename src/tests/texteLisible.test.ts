import { describe, expect, it } from 'vitest';
import { PROFILS } from '../codex/profils';
import { MISSIONS } from '../cerveau/agents';
import { RegistreTraces } from '../interactions/registreTraces';
import { etiquetteDeReponse, nettoyerSujet, sansMarkdown, titreDeCarte, titreDuChat } from '../ui/texteLisible';

describe('sansMarkdown', () => {
    it('retire gras, italique, code, barré et surligné', () => {
        expect(sansMarkdown('En **1642**, la *Pascaline* fait `+` et ~~÷~~ ==vite==.')).toBe('En 1642, la Pascaline fait + et ÷ vite.');
        expect(sansMarkdown('le __cylindre__ _cannelé_')).toBe('le cylindre cannelé');
    });

    it('garde le texte des liens, des images et des liens wiki', () => {
        expect(sansMarkdown('voir [Leibniz](https://x.org) et ![schéma](a.png)')).toBe('voir Leibniz et schéma');
        expect(sansMarkdown('[[Chapitre 1|le chapitre]] puis [[Chapitre 2#Turing]]')).toBe('le chapitre puis Chapitre 2');
    });

    it('retire titres, citations, puces, cases et listes numérotées, sur une ligne', () => {
        const md = '## La Pascaline\n> une citation\n- premier\n* second\n1. un\n- [x] fait\n\n---\nfin';
        expect(sansMarkdown(md)).toBe('La Pascaline une citation premier second un fait fin');
    });

    it('laisse un tiret bas dans un mot, et nettoie une emphase coupée par le bord du passage', () => {
        expect(sansMarkdown('prompt_cache_key')).toBe('prompt_cache_key');
        expect(sansMarkdown('Pascaline** pour aider son père, **collecteur')).toBe('Pascaline pour aider son père, collecteur');
    });

    it('retire les balises HTML', () => {
        expect(sansMarkdown('a <mark>b</mark> <br/>c')).toBe('a b c');
    });
});

describe('les titres', () => {
    it('chat : le sujet s’il est là, sinon « Chat » (jamais le passage, qui changeait sous les yeux)', () => {
        expect(titreDuChat('le machine learning')).toBe('Question sur le machine learning');
        expect(titreDuChat(null)).toBe('Chat');
    });

    it('carte : l’outil, puis son sujet', () => {
        expect(titreDeCarte('Définir', null)).toBe('Définir');
        expect(titreDeCarte('Définir', 'la Pascaline')).toBe('Définir : la Pascaline');
    });

    it('nettoie un sujet rendu par le modèle', () => {
        expect(nettoyerSujet('« La Pascaline de Blaise Pascal ».')).toBe('la Pascaline de Blaise Pascal');
        expect(nettoyerSujet('**Le machine learning**')).toBe('le machine learning');
        expect(nettoyerSujet('Blaise Pascal')).toBe('Blaise Pascal');
        expect(nettoyerSujet('L’électronique')).toBe('l’électronique');
        expect(nettoyerSujet('le mot « perceptron »')).toBe('le mot « perceptron »');
        expect(nettoyerSujet('"le perceptron."')).toBe('le perceptron');
        expect(nettoyerSujet('   ')).toBeNull();
        expect(nettoyerSujet('x'.repeat(120))).toBeNull();
    });
});

describe('l’agent titre', () => {
    it('ne lit ni le vault ni le web, et rend un sujet', () => {
        expect(PROFILS.titre).toMatchObject({ vault: false, web: false, effort: 'low' });
        expect(JSON.stringify(PROFILS.titre.schema)).toContain('sujet');
        expect(MISSIONS.titre).toMatch(/groupe nominal/);
    });
});

describe('le sujet gardé avec la réponse', () => {
    const stockage = () => {
        let t: string | null = null;
        return { lire: async () => t, ecrire: async (x: string) => { t = x; } };
    };
    const trait = { id: 's1', pos: 0, points: [], color: '#000', width: 2, tool: 'crayon' as const };
    const zone = { chemin: 'a.md', from: 0, to: 20, texte: 'En **1642**, la Pascaline' };

    it('le registre l’écrit et le relit', async () => {
        const s = stockage();
        const r = new RegistreTraces(s);
        r.ajouter(zone, trait, { type: 'outil', outil: 'definir', texte: 'déf' }, null, 'la Pascaline');
        await r.vider();
        const relu = new RegistreTraces(s);
        await relu.charger();
        expect(relu.pour('a.md')[0].sujet).toBe('la Pascaline');
    });

    it('l’infobulle de l’icône dit le titre, sinon le passage lisible', () => {
        expect(etiquetteDeReponse('Définir', false, 'la Pascaline', zone.texte)).toBe('Définir : la Pascaline');
        expect(etiquetteDeReponse('Conversation', true, 'la Pascaline', zone.texte)).toBe('Question sur la Pascaline');
        expect(etiquetteDeReponse('Définir', false, null, zone.texte)).toBe('Définir : « En 1642, la Pascaline »');
    });
});
