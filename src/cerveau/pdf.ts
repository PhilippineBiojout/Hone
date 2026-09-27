import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';

// Lire un PDF du vault pour Codex : le texte des pages qui en ont, une image des pages
// qui n'en ont pas (carnet reMarkable écrit à la main, feuille scannée). Sans ça, Codex
// ne voyait d'un carnet que la zone entourée, et demandait qu'on lui envoie une capture.
//
// pdf.js n'est pas exposé par le cœur (il le garde dans sa vue PDF) : Hone embarque le
// sien. Il tourne dans la page, sans worker : `globalThis.pdfjsWorker` lui donne le code
// du worker à exécuter sur place. Le lecteur du cœur n'est pas touché, il passe son
// propre port à pdf.js et n'en lit pas le global.

/** Une page lue : son texte, et sa capture (PNG en base64) quand on l'a rendue. */
export interface PageLue {
    numero: number;
    texte: string;
    image?: string;
}

/** En dessous, une page n'a pas de vrai texte : c'est de l'écriture à la main ou un scan. */
export const TEXTE_MIN = 30;
/** La largeur des captures : l'écriture fine reste lisible sans que l'image pèse trop. */
const LARGEUR_IMAGE = 1400;

let chargement: Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> | null = null;

function pdfjs(): Promise<typeof import('pdfjs-dist/legacy/build/pdf.mjs')> {
    chargement ??= (async () => {
        (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
        return import('pdfjs-dist/legacy/build/pdf.mjs');
    })();
    return chargement;
}

/** « 3 », « 2-5 » ou « 1, 3, 6-8 » → les numéros de page, bornés au document. Vide ou illisible : toutes. */
export function pagesDemandees(spec: string | null | undefined, total: number): number[] {
    const toutes = Array.from({ length: total }, (_, i) => i + 1);
    if (!spec?.trim()) return toutes;
    const choisies = new Set<number>();
    for (const bout of spec.split(',')) {
        const m = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(bout);
        if (!m) continue;
        const debut = Number(m[1]);
        const fin = m[2] ? Number(m[2]) : debut;
        for (let n = Math.max(1, debut); n <= Math.min(total, fin); n++) choisies.add(n);
    }
    return choisies.size > 0 ? [...choisies].sort((a, b) => a - b) : toutes;
}

const aDuTexte = (texte: string) => texte.replace(/\s/g, '').length >= TEXTE_MIN;

/** Ouvre le PDF, le passe à `lire`, puis le libère quoi qu'il arrive. */
async function avecLePdf<T>(donnees: ArrayBuffer, lire: (doc: PDFDocumentProxy) => Promise<T>): Promise<T> {
    const lib = await pdfjs();
    // Une copie : pdf.js transfère le tampon qu'on lui donne, et le vault peut le garder en cache.
    const tache = lib.getDocument({ data: new Uint8Array(donnees.slice(0)) });
    try {
        return await lire(await tache.promise);
    } finally {
        void tache.destroy();
    }
}

async function texteDeLaPage(doc: PDFDocumentProxy, n: number): Promise<string> {
    const contenu = await (await doc.getPage(n)).getTextContent();
    return contenu.items
        .map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : '') : ''))
        .join('')
        .trim();
}

async function imageDeLaPage(doc: PDFDocumentProxy, n: number): Promise<string | undefined> {
    const page = await doc.getPage(n);
    const echelle = Math.min(3, LARGEUR_IMAGE / page.getViewport({ scale: 1 }).width);
    const viewport = page.getViewport({ scale: echelle });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvas, viewport }).promise;
    page.cleanup();
    return canvas.toDataURL('image/png').slice('data:image/png;base64,'.length) || undefined;
}

/** Tout le texte d'un PDF (pour chercher dedans) ; les pages écrites à la main n'en ont pas. */
export async function texteDuPdf(donnees: ArrayBuffer): Promise<string> {
    return avecLePdf(donnees, async (doc) => {
        const pages: string[] = [];
        for (let n = 1; n <= doc.numPages; n++) pages.push(await texteDeLaPage(doc, n));
        return pages.join('\n\n');
    });
}

/**
 * Les pages demandées. Une page sans vrai texte est rendue en image ; avec `enImage`,
 * toutes le sont (formules, schémas, annotations à la main sur un PDF à texte).
 * `imagesMax` borne les rendus : les pages de trop gardent leur texte, sans image.
 */
export async function lirePdf(
    donnees: ArrayBuffer, o: { pages?: string | null; enImage?: boolean; imagesMax: number },
): Promise<{ total: number; pages: PageLue[]; sansImage: number[] }> {
    return avecLePdf(donnees, async (doc) => {
        const lues: PageLue[] = [];
        const sansImage: number[] = [];
        let images = 0;
        for (const n of pagesDemandees(o.pages, doc.numPages)) {
            const texte = await texteDeLaPage(doc, n);
            const lue: PageLue = { numero: n, texte };
            if (o.enImage || !aDuTexte(texte)) {
                if (images < o.imagesMax) {
                    lue.image = await imageDeLaPage(doc, n);
                    images++;
                } else {
                    sansImage.push(n);
                }
            }
            lues.push(lue);
        }
        return { total: doc.numPages, pages: lues, sansImage };
    });
}
