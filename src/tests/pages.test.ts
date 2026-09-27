import { describe, expect, it } from 'vitest';
import { imageName, pageLine, putPage } from '../scan/pages';

// La note d'un document scanné : une ligne d'image par page, à la suite.
const BASE = 'scan-2026-09-27T01-00-00';
const ligne = (page: number, stamp: string) => pageLine(imageName(BASE, page, stamp));

describe('putPage', () => {
    it('crée la première page dans une note vide', () => {
        expect(putPage('', BASE, 1, ligne(1, 'a'))).toBe(`${ligne(1, 'a')}\n`);
    });

    it('ajoute les pages suivantes à la suite, séparées par une ligne vide', () => {
        let note = putPage('', BASE, 1, ligne(1, 'a'));
        note = putPage(note, BASE, 2, ligne(2, 'b'));
        note = putPage(note, BASE, 3, ligne(3, 'c'));
        expect(note).toBe(`${ligne(1, 'a')}\n\n${ligne(2, 'b')}\n\n${ligne(3, 'c')}\n`);
    });

    it('remplace la page mise à jour sans toucher aux autres', () => {
        const note = `${ligne(1, 'a')}\n\n${ligne(2, 'b')}\n\n${ligne(3, 'c')}\n`;
        expect(putPage(note, BASE, 2, ligne(2, 'z')))
            .toBe(`${ligne(1, 'a')}\n\n${ligne(2, 'z')}\n\n${ligne(3, 'c')}\n`);
    });

    it("ne confond pas la page 2 avec la page 20", () => {
        const note = `${ligne(20, 'a')}\n`;
        expect(putPage(note, BASE, 2, ligne(2, 'b'))).toBe(`${ligne(20, 'a')}\n\n${ligne(2, 'b')}\n`);
    });

    it("ne touche pas aux images d'un autre document", () => {
        const autre = pageLine(imageName('scan-2026-09-27T02-00-00', 1, 'x'));
        const note = `${autre}\n`;
        expect(putPage(note, BASE, 1, ligne(1, 'a'))).toBe(`${autre}\n\n${ligne(1, 'a')}\n`);
    });

    it('marche avec les noms lisibles de scan.ts (espaces, heure locale)', () => {
        const base = 'Scan 27-09-2026 02h36m01';
        const l = (page: number, h: string) => pageLine(imageName(base, page, h));
        const note = `${l(1, '02h36m01')}\n\n${l(2, '02h37m15')}\n`;
        expect(putPage(note, base, 1, l(1, '02h40m00')))
            .toBe(`${l(1, '02h40m00')}\n\n${l(2, '02h37m15')}\n`);
    });

    it('garde le texte écrit à la main autour des pages', () => {
        const note = `# Mon cours\n\n${ligne(1, 'a')}\n\nUne remarque\n\n${ligne(2, 'b')}\n`;
        expect(putPage(note, BASE, 1, ligne(1, 'z')))
            .toBe(`# Mon cours\n\n${ligne(1, 'z')}\n\nUne remarque\n\n${ligne(2, 'b')}\n`);
    });
});
