// Les pages d'un document scanné, rangées dans une seule note : une ligne d'image
// par page, dans l'ordre (page 1, puis 2, puis 3…). Pas de repère caché : Fragment
// affiche les commentaires HTML en clair. C'est le NOM de l'image qui sert de repère,
// il contient le numéro de page : `scan-<date>-p2-<date>.jpg` est l'image de la page 2.
// Fonctions pures (texte → texte), testées dans src/tests/pages.test.ts.

/** Le nom de l'image d'une page. `stamp` la rend unique : createBinary refuse d'écraser. */
export function imageName(noteBase: string, page: number, stamp: string): string {
    return `${noteBase}-p${page}-${stamp}.jpg`;
}

/** La ligne de la note qui affiche une image. */
export function pageLine(image: string): string {
    return `![[${image}]]`;
}

/**
 * Range la ligne `line` de la page `page` dans le texte de la note : elle remplace
 * la ligne de cette page si elle existe déjà (mise à jour), sinon elle s'ajoute à la
 * fin (nouvelle page). Tout le reste du texte (ce qu'on a écrit à la main autour)
 * est conservé tel quel.
 */
export function putPage(text: string, noteBase: string, page: number, line: string): string {
    // La ligne d'image de CETTE page : `-p2-` ne confond pas la page 2 avec la 20,
    // et le préfixe `noteBase` ne prend pas les images d'un autre document.
    const existing = new RegExp(`^!\\[\\[${escapeRegExp(noteBase)}-p${page}-[^\\]]*\\]\\]$`, 'm');
    if (existing.test(text)) {
        // Une fonction plutôt qu'une chaîne : un `$` dans le nom ne serait pas interprété
        return text.replace(existing, () => line);
    }
    const body = text.replace(/\s+$/, '');
    return body === '' ? `${line}\n` : `${body}\n\n${line}\n`;
}

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
