import type { TextSurface } from 'fragment';
import type { Annotation, Stroke } from './annotation';
import type { Repere } from './repere';
import type { ContexteQuestion } from './repondre';
import { texteEntre } from './traces';
import { plageDuTrait, type Mesure } from './zoneDuTrait';

// ═══════════════════════════════════════════════════════════════════════════
//  Ce qui fait apparaître la barre : un passage désigné.
//
//  - Un trait d'annotation neuf qui entoure, surligne ou souligne du texte
//    (zoneDuTrait.ts). Un gribouillis ou un trait dans la marge vide reste
//    une annotation, pas une question.
//  - Une sélection à la souris, avec le curseur de base. Le clavier ne
//    déclenche rien : Maj+flèches sert à éditer, pas à questionner.
//
//  ★ POURQUOI un faux trait pour la sélection : la barre, la bulle, les cartes
//    et la marge se tiennent toutes à côté d'un `Stroke` (Repere.boiteTrait).
//    On en fabrique un qui épouse les rectangles de la sélection, comme le
//    ferait un surligneur. Son id le distingue : la poubelle n'a aucun trait
//    d'encre à effacer.
// ═══════════════════════════════════════════════════════════════════════════

/** Le préfixe d'id du faux trait posé par une sélection à la souris. */
export const SELECTION = 'selection-';

export function brancherDeclencheurs(
    editor: TextSurface,
    repere: Repere,
    annotation: Annotation,
    chemin: () => string,
    /** Chat, carte ou pilule ouverts : on est dans la conversation, rien ne se déclenche. */
    occupe: () => boolean,
    surPassage: (zone: ContexteQuestion, trait: Stroke) => void,
): () => void {

    /** Ce que `zoneDuTrait` demande à l'éditeur, en coordonnées document. */
    const mesure: Mesure = {
        posAt: (x, y) => {
            const c = repere.versClient(x, y);
            return c ? editor.posAtCoords(c.x, c.y) : null;
        },
        coordsAt: (off) => {
            const rects = editor.coordsForRange(off, off + 1);
            return rects.length === 1 ? rects[0] : null;
        },
        charAt: (off) => texteEntre(editor, off, off + 1),
    };

    // ── Un trait d'annotation ──────────────────────────────────────────────

    annotation.surTraitPose((path, stroke) => {
        // Chat ou carte ouverts : la saisie est suspendue, le trait n'existe
        // pas. La garde reste pour un trait venu d'ailleurs que du pointeur.
        if (path !== chemin() || occupe()) return;
        const glyphe = editor.coordsAtPos(stroke.pos);
        if (!glyphe) return;
        const points = stroke.points.map((p) => ({ x: glyphe.left + p.dx, y: glyphe.top + p.dy }));
        const plage = plageDuTrait(points, stroke.tool, mesure);
        if (!plage) return;
        surPassage({ texte: texteEntre(editor, plage.from, plage.to), chemin: path, ...plage }, stroke);
    });

    // ── Une sélection à la souris ──────────────────────────────────────────

    let pointeurEnfonce = false;
    let minuterie = 0;

    const surSelection = (): void => {
        if (occupe()) return;
        const { from, to } = editor.getSelection();
        // Un simple clic réduit la sélection à un curseur : on ne ferme rien.
        if (from === to) return;
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

    const surPointerDown = (): void => {
        pointeurEnfonce = true;
        window.clearTimeout(minuterie);
    };
    // Sur le document : on relâche souvent hors du texte en fin de glissé. La
    // sélection de l'éditeur n'est à jour qu'après le pointerup.
    const surPointerUp = (): void => {
        if (!pointeurEnfonce) return;
        pointeurEnfonce = false;
        minuterie = window.setTimeout(surSelection, 0);
    };
    // Une touche frappée avant la lecture : la sélection est celle du clavier.
    const surTouche = (): void => window.clearTimeout(minuterie);

    editor.contentEl.addEventListener('pointerdown', surPointerDown);
    document.addEventListener('pointerup', surPointerUp);
    document.addEventListener('keydown', surTouche, true);

    return () => {
        editor.contentEl.removeEventListener('pointerdown', surPointerDown);
        document.removeEventListener('pointerup', surPointerUp);
        document.removeEventListener('keydown', surTouche, true);
        window.clearTimeout(minuterie);
    };
}
