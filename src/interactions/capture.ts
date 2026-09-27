import type { Stroke } from './annotation';
import type { Pt } from './zoneDuTrait';

// Un trait sur un PDF : on découpe les pages peintes sous lui et on y redessine le
// trait ; Codex lit l'image. Sur une page sans texte (carnet reMarkable écrit à la main,
// PDF scanné), elle est tout le passage ; ailleurs, elle montre ce que le texte perd
// (formules, schémas, annotations à la main).
// Toutes les coordonnées sont celles de l'écran (clientX, clientY).

/** L'air laissé autour du trait, pour que l'écriture qu'il frôle reste entière. */
const MARGE = 16;

/** Le PNG (base64, sans préfixe) de la zone du trait, ou null s'il n'y a aucune page peinte dessous. */
export function captureDuTrait(pane: HTMLElement, points: readonly Pt[], trait: Pick<Stroke, 'color' | 'width' | 'tool'>): string | null {
    if (points.length < 2) return null;
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const zone = { left: Math.min(...xs) - MARGE, top: Math.min(...ys) - MARGE, right: Math.max(...xs) + MARGE, bottom: Math.max(...ys) + MARGE };

    const pages = [...pane.querySelectorAll<HTMLCanvasElement>('.pdf-page canvas')]
        .map((canvas) => ({ canvas, r: canvas.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 0 && r.left < zone.right && zone.left < r.right && r.top < zone.bottom && zone.top < r.bottom);
    if (pages.length === 0) return null;

    // À la résolution du canvas (écran Retina : deux pixels par pixel CSS), sinon l'écriture fine s'efface.
    const echelle = Math.max(...pages.map(({ canvas, r }) => canvas.width / r.width));
    const sortie = document.createElement('canvas');
    sortie.width = Math.round((zone.right - zone.left) * echelle);
    sortie.height = Math.round((zone.bottom - zone.top) * echelle);
    const g = sortie.getContext('2d');
    if (!g) return null;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, sortie.width, sortie.height);

    for (const { canvas, r } of pages) {
        const k = canvas.width / r.width;
        const left = Math.max(zone.left, r.left);
        const top = Math.max(zone.top, r.top);
        const right = Math.min(zone.right, r.right);
        const bottom = Math.min(zone.bottom, r.bottom);
        g.drawImage(
            canvas,
            (left - r.left) * k, (top - r.top) * k, (right - left) * k, (bottom - top) * k,
            (left - zone.left) * echelle, (top - zone.top) * echelle, (right - left) * echelle, (bottom - top) * echelle,
        );
    }

    // Le trait par-dessus : c'est lui qui dit ce qui est visé. Une sélection n'en a pas (largeur 0).
    if (trait.width === 0) return sortie.toDataURL('image/png').slice('data:image/png;base64,'.length);
    g.strokeStyle = trait.color || '#e03131';
    g.globalAlpha = trait.tool === 'surligneur' ? 0.35 : 1;
    g.lineWidth = Math.max(2, trait.width) * echelle;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    points.forEach((p, i) => (i === 0 ? g.moveTo : g.lineTo).call(g, (p.x - zone.left) * echelle, (p.y - zone.top) * echelle));
    g.stroke();

    return sortie.toDataURL('image/png').slice('data:image/png;base64,'.length);
}
