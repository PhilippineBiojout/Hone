import { WidgetLayer, type OverlayHost, type TextSurface, type WidgetAnchor, type WidgetHandle } from 'fragment';
import type { Stroke } from './annotation';
import { aCote, type Boite } from './placement';

// ═══════════════════════════════════════════════════════════════════════════
//  Le repère de l'agent sur UNE vue : le WidgetLayer du cœur, et le trait
//  autour duquel tout se pose.
//
//  Tout ce que l'agent montre sur la page (la barre, le chat, les cartes, la
//  pilule, les icônes de la marge) est un widget du cœur : `addWidget` avec
//  une ancre document, calée sur le glyphe du trait. Le plan document vit dans
//  le scroller : le widget défile avec le texte et suit l'édition sans un
//  écouteur (app/documentation/api-ancrage-widgets.md, §2 et §6).
//
//  ★ C'EST ICI, et seulement ici, que l'agent convertit une coordonnée client
//    en coordonnée document (règle 5 des invariants : ne jamais comparer deux
//    nombres de repères différents). Les pièces reçoivent une ancre.
// ═══════════════════════════════════════════════════════════════════════════

export class Repere {

    readonly widgets: WidgetLayer;

    private readonly editor: TextSurface;
    private readonly overlays: OverlayHost;
    private readonly paneEl: HTMLElement;
    private readonly trait: () => Stroke | null;
    private readonly barreAnnotation: () => DOMRect | null;

    constructor(
        editor: TextSurface,
        overlays: OverlayHost,
        paneEl: HTMLElement,
        trait: () => Stroke | null,
        barreAnnotation: () => DOMRect | null,
    ) {
        this.editor = editor;
        this.overlays = overlays;
        this.paneEl = paneEl;
        this.trait = trait;
        this.barreAnnotation = barreAnnotation;
        this.widgets = new WidgetLayer(editor, overlays);
    }

    detruire(): void {
        this.widgets.destroy();
    }

    // ── Conversions ────────────────────────────────────────────────────────

    /** Une boîte CLIENT (getBoundingClientRect) en coordonnées document. */
    versDocument(r: { left: number; top: number; right: number; bottom: number }): Boite | null {
        const a = this.overlays.clientToDocument(r.left, r.top);
        const b = this.overlays.clientToDocument(r.right, r.bottom);
        return a && b ? { left: a.x, top: a.y, right: b.x, bottom: b.y } : null;
    }

    /** Un déplacement CLIENT (un geste de pointeur) en déplacement document. */
    ecartDocument(dx: number, dy: number): { dx: number; dy: number } {
        const o = this.overlays.clientToDocument(0, 0);
        const p = this.overlays.clientToDocument(dx, dy);
        return o && p ? { dx: p.x - o.x, dy: p.y - o.y } : { dx, dy };
    }

    /**
     * Un point document en coordonnées client, pour `posAtCoords` qui les
     * attend. L'inverse de `clientToDocument`, déduit de deux points : le
     * cœur ne l'expose pas, et l'échelle du document y est comprise.
     */
    versClient(x: number, y: number): { x: number; y: number } | null {
        const o = this.overlays.clientToDocument(0, 0);
        const p = this.overlays.clientToDocument(1, 1);
        if (!o || !p || p.x === o.x || p.y === o.y) return null;
        return { x: (x - o.x) / (p.x - o.x), y: (y - o.y) / (p.y - o.y) };
    }

    /** Le pane visible, en coordonnées client : un geste y reste. */
    paneClient(): DOMRect {
        return this.paneEl.getBoundingClientRect();
    }

    // ── Le trait ───────────────────────────────────────────────────────────

    /**
     * La boîte du trait, en coordonnées document : ses points sont des écarts
     * au glyphe de `pos`, et l'encre en déborde de la moitié de son épaisseur.
     *
     * ★ POURQUOI le trait et pas le texte couvert : un cercle qui mord sur cinq
     *   lignes couvre un texte qui va d'une marge à l'autre. Posée à côté de ce
     *   rectangle, la barre n'avait de place ni à droite ni à gauche.
     */
    boiteTrait(): Boite | null {
        const t = this.trait();
        if (!t) return null;
        const g = this.editor.coordsAtPos(t.pos);
        if (!g) return null;
        const m = t.width / 2;
        const xs = t.points.map((p) => g.left + p.dx);
        const ys = t.points.map((p) => g.top + p.dy);
        return {
            left: Math.min(...xs) - m,
            top: Math.min(...ys) - m,
            right: Math.max(...xs) + m,
            bottom: Math.max(...ys) + m,
        };
    }

    /** L'ancre document qui met le coin haut gauche d'un widget en (x, y). */
    ancre(x: number, y: number): WidgetAnchor | null {
        const t = this.trait();
        const g = t ? this.editor.coordsAtPos(t.pos) : null;
        if (!t || !g) return null;
        return { mode: 'document', pos: t.pos, dx: x - g.left, dy: y - g.top };
    }

    /** L'ancre d'un cadre gardé (fenetre.ts) : un écart au glyphe du trait. */
    ancreDuCadre(c: { dx: number; dy: number }): WidgetAnchor | null {
        const t = this.trait();
        return t ? { mode: 'document', pos: t.pos, dx: c.dx, dy: c.dy } : null;
    }

    // ── Poser un widget la première fois ───────────────────────────────────

    /**
     * L'ancre qui pose `el` à côté de `ref` (le trait par défaut), hors de la
     * barre d'annotation et des `evites`. `el` doit être monté : on le mesure.
     */
    aCote(
        el: HTMLElement,
        options: { ref?: Boite | null; haut?: number | 'centre'; ecart?: number; evites?: (Boite | null)[] } = {},
    ): WidgetAnchor | null {
        const ref = options.ref ?? this.boiteTrait();
        const cadre = this.versDocument(this.paneClient());
        if (!ref || !cadre) return null;
        const annotation = this.barreAnnotation();
        const obstacles = [annotation ? this.versDocument(annotation) : null, ...(options.evites ?? [])]
            .filter((b): b is Boite => b !== null);
        const taille = this.ecartDocument(el.offsetWidth, el.offsetHeight);
        const { x, y } = aCote({
            ref,
            largeur: taille.dx,
            hauteur: taille.dy,
            haut: options.haut ?? 'centre',
            ecart: options.ecart ?? 12,
            cadre,
            obstacles,
        });
        return this.ancre(x, y);
    }

    /**
     * Monte `el` comme widget, puis le pose avec `placer` : il faut être monté
     * pour se mesurer. Le premier placement et le second ont lieu dans la même
     * tâche, avant tout rendu : on ne voit jamais la position provisoire.
     */
    monter(el: HTMLElement, placer: (el: HTMLElement) => WidgetAnchor | null): WidgetHandle | null {
        const provisoire = this.ancre(0, 0);
        if (!provisoire) return null;
        const handle = this.widgets.addWidget(el, provisoire);
        const a = placer(el);
        if (a) handle.setAnchor(a);
        return handle;
    }

    /** La boîte document d'un élément monté. */
    boiteDe(el: HTMLElement): Boite | null {
        return this.versDocument(el.getBoundingClientRect());
    }
}
