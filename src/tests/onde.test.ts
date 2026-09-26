import { describe, expect, it } from 'vitest';
import { niveaux, niveauVoix, TRAITS } from '../ui/onde';

/** Un spectre de 512 cases à 48 kHz, fftSize 1024 : 46,875 Hz par case. */
const HZ = 48000 / 1024;
const vide = (): Uint8Array => new Uint8Array(512);

describe('niveaux', () => {
    it('donne cinq niveaux', () => {
        expect(niveaux(vide(), HZ)).toHaveLength(TRAITS);
    });

    it('le silence laisse chaque trait à son plancher', () => {
        for (const n of niveaux(vide(), HZ)) expect(n).toBeCloseTo(0.2);
    });

    it('un son grave ne lève que le premier trait', () => {
        const spectre = vide();
        // 80 à 140 Hz : dans la première bande (80 à 175 Hz).
        for (let k = Math.floor(80 / HZ); k <= Math.floor(140 / HZ); k++) spectre[k] = 255;
        const n = niveaux(spectre, HZ);
        expect(n[0]).toBe(1);
        for (const autre of n.slice(1)) expect(autre).toBeCloseTo(0.2);
    });

    it('un son aigu ne lève que le dernier trait', () => {
        const spectre = vide();
        // 2,5 à 3,5 kHz : dans la dernière bande (1,8 à 4 kHz).
        for (let k = Math.floor(2500 / HZ); k <= Math.floor(3500 / HZ); k++) spectre[k] = 255;
        const n = niveaux(spectre, HZ);
        expect(n[TRAITS - 1]).toBeGreaterThan(0.6);
        for (const autre of n.slice(0, TRAITS - 1)) expect(autre).toBeCloseTo(0.2);
    });

    it('reste dans [0,2 ; 1] quand tout sature', () => {
        const n = niveaux(new Uint8Array(512).fill(255), HZ);
        for (const v of n) {
            expect(v).toBeGreaterThanOrEqual(0.2);
            expect(v).toBeLessThanOrEqual(1);
        }
    });
});

describe('niveauVoix', () => {
    it('le silence donne 0', () => {
        expect(niveauVoix(niveaux(vide(), HZ))).toBe(0);
    });

    it('une seule bande pleine suffit à donner 1', () => {
        expect(niveauVoix([0.2, 1, 0.2, 0.2, 0.2])).toBe(1);
    });

    it('suit la bande la plus forte, plancher retiré', () => {
        expect(niveauVoix([0.2, 0.6, 0.4, 0.2, 0.2])).toBeCloseTo(0.5);
    });
});
