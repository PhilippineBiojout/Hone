// Le passage tel qu'on le lit, pas tel qu'on l'écrit : les têtes et les infobulles montraient
// le Markdown brut (`**Pascaline**`, `## Titre`), désagréable à lire sur une ligne.

/** Le texte d'un passage Markdown, sans sa syntaxe, sur une seule ligne. */
export function sansMarkdown(texte: string): string {
    return texte
        // Blocs de code : seules les clôtures partent, le code reste lisible.
        .replace(/^\s*(```|~~~).*$/gm, '')
        // Images, puis liens : on garde le texte montré.
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        // Liens wiki : l'alias s'il y en a un, sinon le nom de la note (sans son titre de section).
        .replace(/!?\[\[([^\]|#]*)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_, cible: string, alias?: string) => alias ?? cible)
        // Débuts de ligne : titres, citations, puces, cases, listes numérotées.
        .replace(/^\s{0,3}#{1,6}\s+/gm, '')
        .replace(/^\s*>+\s?/gm, '')
        .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/gm, '')
        // Filets horizontaux.
        .replace(/^\s*([-*_])(\s*\1){2,}\s*$/gm, '')
        // Balises HTML.
        .replace(/<\/?[a-zA-Z][^>]*>/g, '')
        // Emphases : gras, italique, barré, surligné, code en ligne. Un `_` dans un mot reste.
        .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2')
        .replace(/(^|[^\w*])\*(?=\S)([^*]*?\S)\*(?!\w)/g, '$1$2')
        .replace(/(^|[^\w])_(?=\S)([^_]*?\S)_(?!\w)/g, '$1$2')
        .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '$1')
        .replace(/==(?=\S)([\s\S]*?\S)==/g, '$1')
        .replace(/`([^`]*)`/g, '$1')
        // Ce qui reste d'une emphase coupée par le bord du passage.
        .replace(/(^|\s)(\*\*|__|\*)(?=\S)/g, '$1')
        .replace(/(?<=\S)(\*\*|__|\*)(?=\s|$)/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/** La tête du chat : le sujet écrit par Hone, sinon le passage lisible. */
export function titreDuChat(sujet: string | null, passage: string): string {
    return sujet ? `Question sur ${sujet}` : sansMarkdown(passage);
}

/** La tête d'une carte : l'outil, puis son sujet quand Hone l'a écrit. */
export function titreDeCarte(libelle: string, sujet: string | null): string {
    return sujet ? `${libelle} : ${sujet}` : libelle;
}

/** Un sujet rendu par le modèle, remis en forme : une ligne, sans guillemets ni point final. */
export function nettoyerSujet(brut: string): string | null {
    let s = sansMarkdown(brut).replace(/[\s.!?:;,]+$/, '').trim();
    // Des guillemets qui entourent tout le sujet partent ; ceux d'un mot cité à l'intérieur restent.
    const paire = /^(?:«\s*([\s\S]*?)\s*»|"([\s\S]*)"|“([\s\S]*)”)$/.exec(s);
    if (paire) s = (paire[1] ?? paire[2] ?? paire[3]).replace(/[\s.!?:;,]+$/, '').trim();
    if (!s || s.length > 80) return null;
    // « La Pascaline » suit « Question sur » : l'article passe en minuscule, un nom propre non.
    return s.replace(/^(Le|La|Les|L'|L’|Un|Une|Des|Du|De la|De l'|The|A|An)(?=\s|$|(?<=['’]))/, (a) => a.toLowerCase());
}

/** L'infobulle d'une icône de la marge : le titre de la réponse, ou son outil et le passage lisible. */
export function etiquetteDeReponse(libelle: string, estChat: boolean, sujet: string | null, passage: string): string {
    if (sujet) return estChat ? titreDuChat(sujet, passage) : titreDeCarte(libelle, sujet);
    const extrait = sansMarkdown(passage);
    return `${libelle} : « ${extrait.length > 60 ? `${extrait.slice(0, 60)}…` : extrait} »`;
}
