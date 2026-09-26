/** Une boîte en coordonnées document (celles de `coordsAtPos` et des ancres). */
export interface Boite {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

/** Le retrait gardé aux bords du pane, celui de la Toolbar du cœur. */
export const MARGE = 8;

export interface Demande {
    ref: Boite;
    largeur: number;
    hauteur: number;
    /** Le haut voulu, ou `centre` : centré sur `ref`. */
    haut: number | 'centre';
    ecart: number;
    cadre: Boite;
    obstacles: readonly Boite[];
}

const croise = (a: Boite, b: Boite): boolean =>
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/**
 * Le coin haut gauche d'un widget posé à côté de `ref` : à droite, à gauche, puis décalé
 * sous ou au-dessus de l'obstacle qui gêne. Si rien ne va, la droite, rentrée dans le pane.
 */
export function aCote(d: Demande): { x: number; y: number } {
    const { ref, largeur: w, hauteur: h, cadre } = d;
    const hautMin = cadre.top + MARGE;
    const borneY = (y: number): number => Math.max(hautMin, Math.min(y, cadre.bottom - MARGE - h));
    const y0 = borneY(d.haut === 'centre' ? (ref.top + ref.bottom) / 2 - h / 2 : d.haut);
    const droite = ref.right + d.ecart;
    const gauche = ref.left - d.ecart - w;

    const boite = (x: number, y: number): Boite => ({ left: x, top: y, right: x + w, bottom: y + h });
    const tient = (x: number, y: number): boolean => {
        const b = boite(x, y);
        return b.left >= cadre.left + MARGE && b.right <= cadre.right - MARGE
            && b.top >= hautMin - 0.5 && b.bottom <= cadre.bottom - MARGE + 0.5
            && !d.obstacles.some((o) => croise(b, o));
    };

    const candidats = [{ x: droite, y: y0 }, { x: gauche, y: y0 }];
    for (const x of [droite, gauche]) {
        for (const o of d.obstacles) {
            if (croise(boite(x, y0), o)) candidats.push({ x, y: borneY(o.bottom + MARGE) }, { x, y: borneY(o.top - MARGE - h) });
        }
    }
    return candidats.find((c) => tient(c.x, c.y))
        ?? { x: Math.max(cadre.left + MARGE, Math.min(droite, cadre.right - MARGE - w)), y: y0 };
}
