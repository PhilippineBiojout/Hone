import { describe, expect, it } from 'vitest';
import { base64Pcm16, finDePhrase, pcm16Base64 } from '../cerveau/gradium';

const pas = (p: number) => [{ inactivity_prob: 0.1 }, { inactivity_prob: p }];

describe('gradium', () => {
    it('une phrase finit après trois pas de silence de suite, sur l\'horizon le plus long', () => {
        const fin = finDePhrase();
        expect([pas(0.9), pas(0.9)].map(fin)).toEqual([false, false]);
        // Un pas de parole remet le compte à zéro.
        expect(fin(pas(0.2))).toBe(false);
        expect([pas(0.6), pas(0.7), pas(0.8)].map(fin)).toEqual([false, false, true]);
        expect(fin([])).toBe(false);
    });

    it('le PCM 16 bits fait l\'aller-retour, bornes comprises', () => {
        const avant = new Float32Array([0, 0.5, -0.5, 1, -1, 2]);
        const apres = base64Pcm16(pcm16Base64(avant));
        expect(apres).toHaveLength(6);
        for (const [i, v] of [0, 0.5, -0.5, 1, -1, 1].entries()) expect(apres[i]).toBeCloseTo(v, 3);
    });
});
