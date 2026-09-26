// Le texte couvert par un trait d'annotation : géométrie pure, testable sans Electron.
// Toutes les coordonnées sont celles du document (le repère de `coordsAtPos`).

export interface Pt {
    x: number;
    y: number;
}

/** Ce que la géométrie demande à l'éditeur, qu'un test remplace par une grille. */
export interface Mesure {
    posAt(x: number, y: number): number | null;
    coordsAt(offset: number): { left: number; top: number; right: number; bottom: number } | null;
    charAt(offset: number): string;
}

export type Forme = 'entoure' | 'surligne' | 'souligne';

/** En deçà, une boucle n'entoure rien : c'est un point ou un tic. */
const COTE_MIN_CERCLE = 20;
/** Au-delà, un trait au crayon n'est plus un soulignement. */
const HAUTEUR_MAX_SOULIGNE = 14;
/** Le pas d'échantillonnage le long d'un trait ouvert. */
const PAS = 4;

/**
 * Fermé (départ et arrivée à moins d'un tiers du plus grand côté, 24 px au moins) : il entoure.
 * Sinon le surligneur surligne, et le crayon souligne s'il est plat.
 */
export function formeDuTrait(points: readonly Pt[], outil: 'crayon' | 'surligneur'): Forme | null {
    if (points.length < 2) return null;
    const b = boite(points);
    const largeur = b.maxX - b.minX;
    const hauteur = b.maxY - b.minY;
    const fin = points[points.length - 1];
    const ferme = Math.hypot(points[0].x - fin.x, points[0].y - fin.y) <= Math.max(24, Math.max(largeur, hauteur) / 3);
    if (ferme && largeur >= COTE_MIN_CERCLE && hauteur >= COTE_MIN_CERCLE) return 'entoure';
    if (outil === 'surligneur') return 'surligne';
    return hauteur <= HAUTEUR_MAX_SOULIGNE && largeur > hauteur * 2 ? 'souligne' : null;
}

/** La plage de texte couverte par le trait, sans espaces aux bords, ou `null`. */
export function plageDuTrait(points: readonly Pt[], outil: 'crayon' | 'surligneur', mesure: Mesure): { from: number; to: number } | null {
    const forme = formeDuTrait(points, outil);
    if (!forme) return null;
    const plage = forme === 'entoure' ? plageEntouree(points, mesure) : plageLeLong(points, forme, mesure);
    if (!plage) return null;
    let { from, to } = plage;
    while (from < to && /\s/.test(mesure.charAt(from))) from++;
    while (to > from && /\s/.test(mesure.charAt(to - 1))) to--;
    return from < to ? { from, to } : null;
}

/**
 * Les caractères dont le centre est dans le polygone. Les candidats viennent d'un balayage
 * de la boîte par bandes : les quatre coins d'un cercle qui déborde sont hors du document.
 */
function plageEntouree(points: readonly Pt[], mesure: Mesure): { from: number; to: number } | null {
    const b = boite(points);
    const bornes: number[] = [];
    for (let y = b.minY; y <= b.maxY + PAS; y += PAS) {
        for (const x of [b.minX, b.maxX]) {
            const off = mesure.posAt(x, Math.min(y, b.maxY));
            if (off !== null) bornes.push(off);
        }
    }
    if (bornes.length === 0) return null;
    let from = Infinity;
    let to = -Infinity;
    for (let off = Math.min(...bornes); off <= Math.max(...bornes); off++) {
        const r = mesure.coordsAt(off);
        if (!r || r.right <= r.left) continue;
        if (dansPolygone({ x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 }, points)) {
            from = Math.min(from, off);
            to = Math.max(to, off + 1);
        }
    }
    return from < to ? { from, to } : null;
}

/** Le long du trait ; un soulignement est sous le texte, on remonte d'une demi-ligne. */
function plageLeLong(points: readonly Pt[], forme: 'surligne' | 'souligne', mesure: Mesure): { from: number; to: number } | null {
    let remontee = 0;
    if (forme === 'souligne') {
        const p0 = mesure.posAt(points[0].x, points[0].y);
        const r = p0 === null ? null : mesure.coordsAt(p0);
        remontee = r ? (r.bottom - r.top) / 2 + 2 : 10;
    }
    let from = Infinity;
    let to = -Infinity;
    for (const p of echantillonner(points)) {
        const off = mesure.posAt(p.x, p.y - remontee);
        if (off === null) continue;
        from = Math.min(from, off);
        to = Math.max(to, off);
    }
    return from < to ? { from, to } : null;
}

/** Des points tous les `PAS` pixels le long de la polyligne, extrémités comprises. */
function echantillonner(points: readonly Pt[]): Pt[] {
    const out: Pt[] = [points[0]];
    for (let i = 1; i < points.length; i++) {
        const a = points[i - 1];
        const b = points[i];
        const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / PAS));
        for (let k = 1; k <= n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
    }
    return out;
}

function boite(points: readonly Pt[]): { minX: number; minY: number; maxX: number; maxY: number } {
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

/** Pair-impair, polygone fermé d'office : la main ne referme jamais pile. */
export function dansPolygone(p: Pt, poly: readonly Pt[]): boolean {
    let dedans = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i];
        const b = poly[j];
        if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) dedans = !dedans;
    }
    return dedans;
}
