import { Scope, type App } from 'fragment';

// ═══════════════════════════════════════════════════════════════════════════
//  Le clavier dans le chat, la carte et la pilule.
//
//  Le Keymap du cœur écoute `keydown` en CAPTURE sur window et ne regarde pas
//  si l'on tape dans un champ (core/keymap/Keymap.ts) : un `stopPropagation`
//  posé sur nos éléments arrive trop tard, Mod+W fermerait l'onglet au milieu
//  d'une question. La seule prise est sa pile de portées.
//
//  ★ POURQUOI `Scope.echap` : parent nul, donc aucun raccourci de l'app ne
//    passe tant que le focus est chez nous, et une frappe ordinaire, qu'aucune
//    liaison ne reconnaît, arrive intacte au champ. Échap est consommé : il
//    quitte le champ, il ne ferme rien (le chat et la carte ne se ferment
//    qu'à leur croix, décision 0013).
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Empile une portée tant que le focus est dans `el`. `surEchap` passe d'abord :
 * il rend `true` s'il a traité la touche (la confirmation du pied se replie).
 * Rend le dépilement, à appeler au démontage : un élément retiré du DOM avec
 * le focus dedans ne reçoit pas toujours son `focusout`.
 */
export function proteger(app: App, el: HTMLElement, surEchap: () => boolean = () => false): () => void {
    let portee: Scope | null = null;
    const lacher = (): void => {
        if (portee) app.keymap.popScope(portee);
        portee = null;
    };
    el.addEventListener('focusin', () => {
        if (portee) return;
        portee = Scope.echap(() => {
            if (surEchap()) return;
            const actif = document.activeElement;
            if (actif instanceof HTMLElement && el.contains(actif)) actif.blur();
        });
        app.keymap.pushScope(portee);
    });
    el.addEventListener('focusout', (e) => {
        if (!el.contains(e.relatedTarget as Node | null)) lacher();
    });
    return lacher;
}
