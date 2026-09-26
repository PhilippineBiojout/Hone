import { describe, expect, it } from 'vitest';
import { aCote, MARGE, type Boite, type Demande } from '../positionnement/placement';

const pane: Boite = { left: 0, top: 0, right: 1000, bottom: 800 };
const trait: Boite = { left: 400, top: 300, right: 500, bottom: 340 };

const demande = (d: Partial<Demande> = {}): Demande => ({
    ref: trait, largeur: 40, hauteur: 200, haut: 'centre', ecart: 12, cadre: pane, obstacles: [], ...d,
});

describe('aCote', () => {
    it('pose à droite, centré sur la référence', () => {
        expect(aCote(demande())).toEqual({ x: 512, y: 220 });
    });

    it('passe à gauche quand la droite sort du pane', () => {
        const ref = { left: 900, top: 300, right: 980, bottom: 340 };
        expect(aCote(demande({ ref }))).toEqual({ x: 900 - 12 - 40, y: 220 });
    });

    it('passe à gauche quand un obstacle occupe la droite', () => {
        const obstacles = [{ left: 510, top: 0, right: 560, bottom: 800 }];
        expect(aCote(demande({ obstacles })).x).toBe(400 - 12 - 40);
    });

    it("descend sous l'obstacle quand les deux côtés sont pris", () => {
        const obstacles = [
            { left: 510, top: 200, right: 560, bottom: 400 },
            { left: 340, top: 200, right: 395, bottom: 400 },
        ];
        expect(aCote(demande({ obstacles }))).toEqual({ x: 512, y: 400 + MARGE });
    });

    it('reste dans le pane verticalement', () => {
        const ref = { left: 400, top: 20, right: 500, bottom: 40 };
        expect(aCote(demande({ ref })).y).toBe(MARGE);
    });

    it('respecte un haut imposé', () => {
        expect(aCote(demande({ haut: 310 })).y).toBe(310);
    });
});
