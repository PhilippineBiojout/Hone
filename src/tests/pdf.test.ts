import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { lirePdf, pagesDemandees, texteDuPdf } from '../cerveau/pdf';
import { chercherDansLeVault, IMAGES_MAX, lireDocument } from '../cerveau/outils-vault';
import type { AccesVault } from '../cerveau/vault';
import type { ContenuOutil } from '../codex/serveur';

// Un PDF de deux pages : la première a du texte, la seconde n'a qu'un trait (un carnet écrit
// à la main n'a pas de texte non plus). Le rendu en image demande un canvas : sous Node, on
// vérifie le choix des pages à rendre avec imagesMax à 0, et le rendu se vérifie en e2e.
async function pdfDeTest(): Promise<ArrayBuffer> {
    const doc = await PDFDocument.create();
    const police = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage([400, 400]).drawText('La fonction radiale ne s\'annule pas sur ]0, +inf[.', { x: 20, y: 300, size: 12, font: police });
    doc.addPage([400, 400]).drawLine({ start: { x: 20, y: 20 }, end: { x: 300, y: 200 }, thickness: 2 });
    const octets = await doc.save();
    return octets.buffer.slice(octets.byteOffset, octets.byteOffset + octets.byteLength) as ArrayBuffer;
}

describe('pdf', () => {
    it('lit les pages demandées, bornées au document', () => {
        expect(pagesDemandees(null, 3)).toEqual([1, 2, 3]);
        expect(pagesDemandees('2', 3)).toEqual([2]);
        expect(pagesDemandees('1, 3-9', 5)).toEqual([1, 3, 4, 5]);
        expect(pagesDemandees('n\'importe quoi', 2)).toEqual([1, 2]);
    });

    it('rend le texte, et range en page à voir celle qui n\'en a pas', async () => {
        const donnees = await pdfDeTest();
        expect(await texteDuPdf(donnees)).toContain('fonction radiale');
        const lu = await lirePdf(donnees, { imagesMax: 0 });
        expect(lu.total).toBe(2);
        expect(lu.pages[0].texte).toContain('fonction radiale');
        expect(lu.sansImage).toEqual([2]);
    });

    it('read_document lit un PDF et le dit à Codex ; search_vault trouve dans son texte', async () => {
        const donnees = await pdfDeTest();
        const acces: AccesVault = {
            fichiers: () => [], lire: async () => null, taille: () => donnees.byteLength,
            pdfs: () => ['DM Phy Q.pdf'], lirePdf: async (rel) => (rel === 'DM Phy Q.pdf' ? donnees : null),
        };
        const rendu = await lireDocument(acces, 'DM Phy Q.pdf', { pages: '1' }) as ContenuOutil[];
        const textes = rendu.map((c) => (c.type === 'inputText' ? c.text : '')).join('\n');
        expect(textes).toMatch(/2 pages\. Pages lues : 1\./);
        expect(textes).toContain('--- Page 1 ---\nLa fonction radiale');
        expect(await lireDocument(acces, 'absent.pdf')).toBe('Aucun PDF à ce chemin : absent.pdf');
        expect(await lireDocument(acces, 'cours.docx')).toMatch(/Format non lu/);
        expect(await chercherDansLeVault(acces, 'fonction RADIALE')).toContain('DM Phy Q.pdf');
        expect(await chercherDansLeVault(acces, 'phy q')).toContain('DM Phy Q.pdf');
        expect(IMAGES_MAX).toBeGreaterThan(0);
    });
});
