import type { ContenuOutil } from '../codex/serveur';
import { EXTENSIONS_DOCUMENTS, extension, RefusChemin, TAILLE_MAX, TAILLE_MAX_PDF, verifierChemin } from './garde';
import { lirePdf, texteDuPdf } from './pdf';
import type { AccesVault } from './vault';

// Deux outils de lecture, aucun d'écriture. Un refus est RENDU au modèle, pas levé.
// Ils lisent les notes et les PDF : un PDF rend son texte, et ses pages écrites à la
// main (carnets reMarkable, scans) reviennent en image, que Codex lit.

export const CARACTERES_MAX = 20_000;
/** Les pages rendues en image par appel : au-delà, Codex redemande les pages qu'il veut. */
export const IMAGES_MAX = 6;

/** Le texte des PDF déjà lus, tant que leur taille ne change pas : chercher ne relit pas tout à chaque fois. */
const textesPdf = new Map<string, { taille: number | null; texte: string }>();

async function texteDuPdfEnCache(acces: AccesVault, rel: string): Promise<string | null> {
    const taille = acces.taille(rel);
    if (taille != null && taille > TAILLE_MAX_PDF) return null;
    const connu = textesPdf.get(rel);
    if (connu && connu.taille === taille) return connu.texte;
    const donnees = await acces.lirePdf?.(rel);
    if (!donnees) return null;
    const texte = await texteDuPdf(donnees).catch(() => '');
    textesPdf.set(rel, { taille, texte });
    return texte;
}

/** Minuscules et sans accents. */
const plier = (texte: string) => texte.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export async function chercherDansLeVault(acces: AccesVault, requete: string): Promise<string> {
    const q = plier(requete.trim());
    if (!q) return 'Requête vide.';
    const trouves: { chemin: string; extrait: string }[] = [];
    const notes = acces.fichiers().map((rel) => ({ rel, lire: () => acces.lire(rel) }));
    const pdfs = (acces.pdfs?.() ?? []).map((rel) => ({ rel, lire: () => texteDuPdfEnCache(acces, rel) }));
    for (const { rel, lire } of [...notes, ...pdfs]) {
        // Le nom suffit à retenir un fichier (un carnet écrit à la main n'a pas de texte) : pas besoin de le lire avant.
        const parNom = plier(rel).includes(q);
        const texte = (await lire()) ?? (parNom ? '' : null);
        if (texte == null) continue;
        const plie = plier(texte);
        const i = plie.indexOf(q);
        if (i === -1 && !parNom) continue;
        // Même longueur une fois plié : l'extrait se prend dans le vrai texte, accents compris.
        const source = plie.length === texte.length ? texte : plie;
        trouves.push({ chemin: rel, extrait: i === -1 ? texte.slice(0, 300) : source.slice(Math.max(0, i - 200), i + 300) });
        if (trouves.length >= 8) break;
    }
    return trouves.length > 0 ? JSON.stringify(trouves) : 'Aucun résultat dans le vault.';
}

/** `pages` : « 3 », « 2-5 »… (PDF seulement) ; `enImage` : rendre ces pages en image même si elles ont du texte. */
export async function lireDocument(
    acces: AccesVault, rel: string, o: { pages?: string | null; enImage?: boolean } = {},
): Promise<string | ContenuOutil[]> {
    try {
        verifierChemin(rel, EXTENSIONS_DOCUMENTS);
    } catch (err) {
        return err instanceof RefusChemin ? `Refusé : ${err.message}` : 'Lecture impossible.';
    }
    if (extension(rel) === '.pdf') return lireLePdf(acces, rel, o);
    const taille = acces.taille(rel);
    if (taille != null && taille > TAILLE_MAX) return 'Refusé : fichier trop gros pour être lu.';
    const texte = await acces.lire(rel);
    if (texte == null) return `Aucun fichier à ce chemin : ${rel}`;
    return texte.length > CARACTERES_MAX
        ? `${texte.slice(0, CARACTERES_MAX)}\n[… document tronqué à ${CARACTERES_MAX} caractères]`
        : texte;
}

/** Un PDF, page par page : son texte, et l'image de chaque page écrite à la main (ou demandée en image). */
async function lireLePdf(acces: AccesVault, rel: string, o: { pages?: string | null; enImage?: boolean }): Promise<string | ContenuOutil[]> {
    const taille = acces.taille(rel);
    if (taille != null && taille > TAILLE_MAX_PDF) return 'Refusé : PDF trop gros pour être lu.';
    const donnees = await acces.lirePdf?.(rel);
    if (!donnees) return `Aucun PDF à ce chemin : ${rel}`;
    let lu: Awaited<ReturnType<typeof lirePdf>>;
    try {
        lu = await lirePdf(donnees, { pages: o.pages, enImage: o.enImage, imagesMax: IMAGES_MAX });
    } catch (err) {
        return `PDF illisible : ${String((err as Error)?.message ?? err)}`;
    }
    const contenu: ContenuOutil[] = [{
        type: 'inputText',
        text: `PDF « ${rel} », ${lu.total} page${lu.total > 1 ? 's' : ''}. Pages lues : ${lu.pages.map((p) => p.numero).join(', ')}. `
            + 'Une page sans texte (écrite à la main, scannée) est jointe en image : lis-la.',
    }];
    let reste = CARACTERES_MAX;
    for (const page of lu.pages) {
        const texte = page.texte.slice(0, Math.max(0, reste));
        reste -= texte.length;
        const tronque = texte.length < page.texte.length ? '\n[… texte tronqué]' : '';
        const corps = texte ? `${texte}${tronque}` : page.image ? '(pas de texte : voir l\'image)' : '(pas de texte)';
        contenu.push({ type: 'inputText', text: `--- Page ${page.numero} ---\n${corps}` });
        if (page.image) contenu.push({ type: 'inputImage', imageUrl: `data:image/png;base64,${page.image}` });
    }
    if (lu.sansImage.length > 0) {
        contenu.push({
            type: 'inputText',
            text: `Pages à voir en image, pas encore rendues (${IMAGES_MAX} images au plus par appel) : ${lu.sansImage.join(', ')}. `
                + 'Rappelle read_document avec ces pages pour les voir.',
        });
    }
    return contenu;
}
