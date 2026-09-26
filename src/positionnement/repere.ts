import { WidgetLayer, type OverlayHost, type TextSurface, type WidgetAnchor, type WidgetHandle } from 'fragment';
import type { Stroke } from '../interactions/annotation';
import { aCote, auDessus, type Boite } from './placement';

/**
 * Le repère de l'agent sur une vue : le WidgetLayer du cœur et le trait autour duquel
 * tout se pose. Seul endroit où l'on convertit du client en document.
 */
export class Repere {

    readonly widgets: WidgetLayer;

    constructor(
        private readonly editor: TextSurface,
        private readonly overlays: OverlayHost,
        private readonly paneEl: HTMLElement,
        private readonly trait: () => Stroke | null,
        private readonly barreAnnotation: () => DOMRect | null,
    ) {
        this.widgets = new WidgetLayer(editor, overlays);
    }

    detruire(): void {
        this.widgets.destroy();
    }

    /** Une boîte client en coordonnées document. */
    versDocument(r: { left: number; top: number; right: number; bottom: number }): Boite | null {
        const a = this.overlays.clientToDocument(r.left, r.top);
        const b = this.overlays.clientToDocument(r.right, r.bottom);
        return a && b ? { left: a.x, top: a.y, right: b.x, bottom: b.y } : null;
    }

    /** Un déplacement client en déplacement document. */
    ecartDocument(dx: number, dy: number): { dx: number; dy: number } {
        const o = this.overlays.clientToDocument(0, 0);
        const p = this.overlays.clientToDocument(dx, dy);
        return o && p ? { dx: p.x - o.x, dy: p.y - o.y } : { dx, dy };
    }

    /** Un point document en client, pour `posAtCoords` : l'inverse que le cœur n'expose pas. */
    versClient(x: number, y: number): { x: number; y: number } | null {
        const o = this.overlays.clientToDocument(0, 0);
        const p = this.overlays.clientToDocument(1, 1);
        if (!o || !p || p.x === o.x || p.y === o.y) return null;
        return { x: (x - o.x) / (p.x - o.x), y: (y - o.y) / (p.y - o.y) };
    }

    /** Le panneau de la note, pour qui doit suivre sa taille. */
    get pane(): HTMLElement {
        return this.paneEl;
    }

    paneClient(): DOMRect {
        return this.paneEl.getBoundingClientRect();
    }

    /** La boîte document du trait (ses points plus la demi-épaisseur de l'encre). */
    boiteTrait(): Boite | null {
        const t = this.trait();
        const g = t && this.editor.coordsAtPos(t.pos);
        if (!t || !g) return null;
        const m = t.width / 2;
        const xs = t.points.map((p) => g.left + p.dx);
        const ys = t.points.map((p) => g.top + p.dy);
        return { left: Math.min(...xs) - m, top: Math.min(...ys) - m, right: Math.max(...xs) + m, bottom: Math.max(...ys) + m };
    }

    /** L'ancre d'un cadre gardé (fenetre.ts) : un écart au glyphe du trait. */
    ancreDuCadre(c: { dx: number; dy: number }): WidgetAnchor | null {
        const t = this.trait();
        return t ? { mode: 'document', pos: t.pos, dx: c.dx, dy: c.dy } : null;
    }

    /** L'ancre qui pose `el` (monté, on le mesure) à côté de `ref`, hors de la barre d'annotation. */
    aCote(
        el: HTMLElement,
        options: { ref?: Boite | null; haut?: number | 'centre'; ecart?: number; evites?: (Boite | null)[] } = {},
    ): WidgetAnchor | null {
        const ref = options.ref ?? this.boiteTrait();
        const cadre = this.versDocument(this.paneClient());
        if (!ref || !cadre) return null;
        const annotation = this.barreAnnotation();
        const obstacles = [annotation && this.versDocument(annotation), ...(options.evites ?? [])]
            .filter((b): b is Boite => !!b);
        const taille = this.ecartDocument(el.offsetWidth, el.offsetHeight);
        const { x, y } = aCote({
            ref, largeur: taille.dx, hauteur: taille.dy, haut: options.haut ?? 'centre',
            ecart: options.ecart ?? 12, cadre, obstacles,
        });
        return this.ancre(x, y);
    }

    /** L'ancre qui pose `el` (monté, on le mesure) au-dessus de `ref`, ou dessous, hors de la barre d'annotation. */
    auDessus(el: HTMLElement, options: { ref?: Boite | null; ecart?: number } = {}): WidgetAnchor | null {
        const ref = options.ref ?? this.boiteTrait();
        const cadre = this.versDocument(this.paneClient());
        if (!ref || !cadre) return null;
        const annotation = this.barreAnnotation();
        const obstacles = annotation ? [this.versDocument(annotation)].filter((b): b is Boite => !!b) : [];
        const taille = this.ecartDocument(el.offsetWidth, el.offsetHeight);
        const { x, y } = auDessus({ ref, largeur: taille.dx, hauteur: taille.dy, ecart: options.ecart ?? 8, cadre, obstacles });
        return this.ancre(x, y);
    }

    /**
     * L'ancre qui pose `el` (monté, on le mesure) centré en bas du panneau, à `marge` px du bord.
     * Ancre `viewport` : elle ne suit pas le défilement, la barre reste en bas pendant qu'on lit.
     */
    enBas(el: HTMLElement, marge = 24): WidgetAnchor | null {
        const pane = this.paneClient();
        const x = pane.left + (pane.width - el.offsetWidth) / 2;
        const y = pane.bottom - el.offsetHeight - marge;
        return this.widgets.viewportAnchorAt(x, y);
    }

    /** Monte `el` puis le pose avec `placer`, dans la même tâche : la place provisoire ne se voit pas. */
    monter(el: HTMLElement, placer: (el: HTMLElement) => WidgetAnchor | null): WidgetHandle | null {
        const provisoire = this.ancre(0, 0);
        if (!provisoire) return null;
        const handle = this.widgets.addWidget(el, provisoire);
        const a = placer(el);
        if (a) handle.setAnchor(a);
        return handle;
    }

    boiteDe(el: HTMLElement): Boite | null {
        return this.versDocument(el.getBoundingClientRect());
    }

    /** L'ancre document qui met le coin haut gauche en (x, y). */
    private ancre(x: number, y: number): WidgetAnchor | null {
        const t = this.trait();
        const g = t && this.editor.coordsAtPos(t.pos);
        return t && g ? { mode: 'document', pos: t.pos, dx: x - g.left, dy: y - g.top } : null;
    }
}
