import { describe, expect, it, vi } from 'vitest';

// reglages.ts importe Modal de l'hôte, absent sous Node.
vi.mock('fragment', () => ({ Modal: class {} }));
const { fusionner } = await import('../reglages/reglages');

describe('réglages', () => {
    it('la bibliothèque (clé atelier) ne rallume pas l\'interrupteur', () => {
        expect(fusionner({ atelier: { version: 1, fonctions: {} }, atelierActif: false }).atelierActif).toBe(false);
        expect(fusionner({ atelier: { version: 1, fonctions: {} } }).atelierActif).toBe(true);
        expect(fusionner(null).atelierActif).toBe(true);
    });

    it('un ancien data.json (clé OpenAI, modèles) se lit sans ses champs disparus', () => {
        const r = fusionner({ cle: 'sk-x', modeleFort: 'gpt-5.4', plafond: 1, gradiumCle: 'gd_x' });
        expect(r).not.toHaveProperty('cle');
        expect(r).not.toHaveProperty('modeleFort');
        expect(r.gradiumCle).toBe('gd_x');
    });
});
