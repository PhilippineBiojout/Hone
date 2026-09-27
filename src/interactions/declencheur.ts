import type { Component, TextSurface } from 'fragment';
import type { Annotation, Stroke } from './annotation';
import type { Repere } from '../positionnement/repere';
import type { ContexteQuestion } from '../pont/repondre';
import { texteEntre } from './traces';
import { plageDuTrait, type Mesure } from './zoneDuTrait';

/** Le préfixe d'id du faux trait posé par une sélection à la souris : il n'y a pas d'encre à effacer. */
export const SELECTION = 'selection-';

/**
 * Ce qui fait apparaître la barre : un trait d'annotation qui entoure, surligne ou souligne
 * du texte, ou une sélection à la souris (le clavier ne déclenche rien).
 */
export function brancherDeclencheurs(
    composant: Component,
    editor: TextSurface,
    repere: Repere,
    annotation: Annotation,
    chemin: () => string,
    /** Chat, carte ou pilule ouverts : rien ne se déclenche. */
    occupe: () => boolean,
    surPassage: (zone: ContexteQuestion, trait: Stroke) => void,
): void {
    const mesure: Mesure = {
        posAt: (x, y) => {
            const c = repere.versClient(x, y);
            const off = c ? editor.posAtCoords(c.x, c.y) : null;
            // Sur un PDF, un point sans caractère dessous (entre deux mots, la marge)
            // rend l'ancre de la page, qui n'est pas un caractère : le trait aurait
            // pris tout le haut de la page. Elle ne survit pas à l'aller-retour
            // offset → position → offset ; sur une note, tout offset y survit.
            return off !== null && editor.posToOffset(editor.offsetToPos(off)) === off ? off : null;
        },
        coordsAt: (off) => {
            const rects = editor.coordsForRange(off, off + 1);
            return rects.length === 1 ? rects[0] : null;
        },
        charAt: (off) => texteEntre(editor, off, off + 1),
    };

    annotation.surTraitPose((path, stroke) => {
        if (path !== chemin() || occupe()) return;
        const glyphe = editor.coordsAtPos(stroke.pos);
        if (!glyphe) return;
        const points = stroke.points.map((p) => ({ x: glyphe.left + p.dx, y: glyphe.top + p.dy }));
        // Sur un PDF, le cœur cherche le caractère sous un point par le navigateur
        // (`caretRangeFromPoint`) : c'est l'élément du dessus qui répond. Outil armé,
        // c'est la surface de dessin, et tout le trait tombait sur « la page », sans
        // texte. On l'efface du pointeur le temps de la mesure. Sur une note, le
        // calcul est géométrique et ne voit pas la différence.
        // Le cœur arme l'outil en posant `pointer-events` en ligne : on rend la valeur d'avant.
        const surfaces = [...repere.pane.querySelectorAll<HTMLElement>('.annotation-surface')].map((el) => ({ el, avant: el.style.pointerEvents }));
        for (const { el } of surfaces) el.style.pointerEvents = 'none';
        let plage: ReturnType<typeof plageDuTrait>;
        try {
            plage = plageDuTrait(points, stroke.tool, mesure);
        } finally {
            for (const { el, avant } of surfaces) el.style.pointerEvents = avant;
        }
        if (plage) surPassage({ texte: texteEntre(editor, plage.from, plage.to), chemin: path, ...plage }, stroke);
    });

    // La sélection devient un faux trait qui épouse ses rectangles, comme un surligneur.
    const surSelection = (): void => {
        const { from, to } = editor.getSelection();
        if (occupe() || from === to) return;
        const glyphe = editor.coordsAtPos(from);
        const rects = editor.coordsForRange(from, to);
        if (!glyphe || rects.length === 0) return;
        const left = Math.min(...rects.map((r) => r.left));
        const top = Math.min(...rects.map((r) => r.top));
        const right = Math.max(...rects.map((r) => r.right));
        const bottom = Math.max(...rects.map((r) => r.bottom));
        const coin = (x: number, y: number) => ({ dx: x - glyphe.left, dy: y - glyphe.top });
        surPassage({ texte: texteEntre(editor, from, to), chemin: chemin(), from, to }, {
            id: `${SELECTION}${Date.now()}`,
            pos: from,
            points: [coin(left, top), coin(right, top), coin(right, bottom), coin(left, bottom)],
            color: '',
            width: 0,
            tool: 'surligneur',
        });
    };

    let pointeurEnfonce = false;
    let minuterie = 0;
    composant.registerDomEvent(editor.contentEl, 'pointerdown', () => {
        pointeurEnfonce = true;
        window.clearTimeout(minuterie);
    });
    // Sur le document : on relâche souvent hors du texte. La sélection n'est à jour qu'après le pointerup.
    composant.registerDomEvent(document, 'pointerup', () => {
        if (!pointeurEnfonce) return;
        pointeurEnfonce = false;
        minuterie = window.setTimeout(surSelection, 0);
    });
    // Une touche frappée avant la lecture : la sélection est celle du clavier.
    composant.registerDomEvent(document, 'keydown', () => window.clearTimeout(minuterie), true);
    composant.register(() => window.clearTimeout(minuterie));
}
