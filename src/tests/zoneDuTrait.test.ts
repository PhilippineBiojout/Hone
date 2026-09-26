import { describe, expect, it } from 'vitest';
import { dansPolygone, formeDuTrait, plageDuTrait, type Mesure, type Pt } from '../interactions/zoneDuTrait';

/**
 * Une grille de caractères : 8 px de large, 20 px de haut, comme une police
 * monospace. Assez pour vérifier la géométrie sans éditeur.
 */
const L = 8;
const H = 20;

function grille(lignes: string[]): { mesure: Mesure; texte: string } {
    const texte = lignes.join('\n');
    const debuts: number[] = [];
    let o = 0;
    for (const l of lignes) {
        debuts.push(o);
        o += l.length + 1;
    }
    const ligneDe = (off: number): number => {
        let n = 0;
        while (n + 1 < debuts.length && debuts[n + 1] <= off) n++;
        return n;
    };
    const mesure: Mesure = {
        posAt(x, y) {
            if (y < 0 || y >= lignes.length * H) return null;
            const n = Math.floor(y / H);
            const col = Math.max(0, Math.min(lignes[n].length, Math.round(x / L)));
            return debuts[n] + col;
        },
        coordsAt(off) {
            const n = ligneDe(off);
            const col = off - debuts[n];
            const plein = col < lignes[n].length;
            return { left: col * L, right: col * L + (plein ? L : 0), top: n * H, bottom: (n + 1) * H };
        },
        charAt: (off) => texte.charAt(off),
    };
    return { mesure, texte };
}

/** Une ellipse de centre (cx, cy), fermée ou non selon `ouverture` (en radians). */
function ellipse(cx: number, cy: number, rx: number, ry: number, ouverture = 0.3): Pt[] {
    const pts: Pt[] = [];
    for (let a = 0; a <= Math.PI * 2 - ouverture; a += 0.2) pts.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
    return pts;
}

const LIGNES = [
    'La Révolution française commence en 1789.',
    'Elle se termine en 1799 avec le Consulat.',
    'Napoléon devient empereur en 1804.',
];

describe('formeDuTrait', () => {
    it('reconnaît un cercle presque fermé', () => {
        expect(formeDuTrait(ellipse(100, 30, 60, 25), 'crayon')).toBe('entoure');
    });
    it('un trait plat au crayon est un soulignement', () => {
        expect(formeDuTrait([{ x: 0, y: 22 }, { x: 80, y: 24 }, { x: 160, y: 21 }], 'crayon')).toBe('souligne');
    });
    it('un gribouillis ouvert au crayon ne couvre rien', () => {
        expect(formeDuTrait([{ x: 0, y: 0 }, { x: 60, y: 80 }, { x: 120, y: 0 }, { x: 180, y: 90 }], 'crayon')).toBeNull();
    });
    it('un trait ouvert au surligneur est un surlignage', () => {
        expect(formeDuTrait([{ x: 0, y: 10 }, { x: 200, y: 10 }], 'surligneur')).toBe('surligne');
    });
    it('une boucle minuscule n\'entoure rien', () => {
        expect(formeDuTrait(ellipse(50, 10, 5, 5), 'crayon')).toBeNull();
    });
});

describe('plageDuTrait', () => {
    const { mesure, texte } = grille(LIGNES);
    const extrait = (p: { from: number; to: number } | null): string | null => (p ? texte.slice(p.from, p.to) : null);

    it('un cercle autour de « 1789 » rend exactement ce mot', () => {
        // « 1789 » occupe les colonnes 36 à 39 de la ligne 0 (288 à 320 px) ; le
        // cercle va de 285 à 323 px, entre le centre de l'espace et celui du point.
        const p = plageDuTrait(ellipse(38 * L, 10, 2.4 * L, 16), 'crayon', mesure);
        expect(extrait(p)).toBe('1789');
    });

    it('un cercle sur deux lignes rend le texte des deux', () => {
        const p = plageDuTrait(ellipse(20 * L, 20, 8 * L, 26), 'crayon', mesure);
        const t = extrait(p)!;
        expect(t).toContain('\n');
        expect(t.startsWith(' ')).toBe(false);
    });

    it('un surlignage le long de la ligne 1 rend cette ligne', () => {
        const p = plageDuTrait([{ x: 0, y: 30 }, { x: 23 * L, y: 30 }], 'surligneur', mesure);
        expect(extrait(p)).toBe('Elle se termine en 1799');
    });

    it('un soulignement sous « Napoléon » vise le texte au-dessus', () => {
        // Le trait est sous la ligne 2 (qui va de 40 à 60 px), dans la ligne suivante.
        const p = plageDuTrait([{ x: 0, y: 59 }, { x: 4 * L, y: 60 }, { x: 8 * L, y: 59 }], 'crayon', mesure);
        expect(extrait(p)).toBe('Napoléon');
    });

    it('un cercle dans le vide, sous le texte, ne rend rien', () => {
        expect(plageDuTrait(ellipse(100, 200, 40, 20), 'crayon', mesure)).toBeNull();
    });

    it('les espaces des bords sont retirés', () => {
        // De la fin de « La » au début de « Révolution », espace compris.
        const p = plageDuTrait([{ x: 2 * L, y: 10 }, { x: 13 * L, y: 10 }], 'surligneur', mesure);
        expect(extrait(p)).toBe('Révolution');
    });
});

describe('dansPolygone', () => {
    const carre: Pt[] = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    it('dedans et dehors', () => {
        expect(dansPolygone({ x: 5, y: 5 }, carre)).toBe(true);
        expect(dansPolygone({ x: 15, y: 5 }, carre)).toBe(false);
    });
});
