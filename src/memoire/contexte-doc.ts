// La première priorité de la mémoire : le document lui-même. Jusqu'ici seuls son
// chemin et le passage partaient, et l'agent dépensait un tour (read_document) pour
// savoir de quoi parle la note. On envoie d'office son plan (les titres) et le texte
// autour du passage ; read_document reste là pour lire le reste.

export const PLAN_MAX = 800;
export const AUTOUR_MAX = 2_000;

/** Les titres Markdown du document, dans l'ordre, sous un plafond. */
export function plan(texte: string): string {
    const titres = texte.split('\n').filter((l) => /^#{1,6}\s+\S/.test(l)).map((l) => l.trim());
    const garde: string[] = [];
    let n = 0;
    for (const t of titres) {
        if (n + t.length + 1 > PLAN_MAX) break;
        garde.push(t);
        n += t.length + 1;
    }
    return garde.join('\n');
}

/** Le texte autour du passage, centré sur lui ; le début du document s'il est introuvable. */
export function autour(texte: string, passage: string, taille = AUTOUR_MAX): string {
    if (texte.length <= taille) return texte;
    const i = passage ? texte.indexOf(passage.slice(0, 200)) : -1;
    const centre = i >= 0 ? i + Math.min(passage.length, 200) / 2 : 0;
    const debut = Math.max(0, Math.min(texte.length - taille, Math.floor(centre - taille / 2)));
    return `${debut > 0 ? '…' : ''}${texte.slice(debut, debut + taille)}${debut + taille < texte.length ? '…' : ''}`;
}

/** Le bloc « document » de la demande, ou '' si le texte n'est pas lisible. */
export function blocDocument(texte: string | null, passage: string): string {
    if (!texte) return '';
    const p = plan(texte);
    return `${p ? `Plan du document :\n${p}\n\n` : ''}Autour du passage :\n"""\n${autour(texte, passage)}\n"""`;
}
