import { setIcon } from 'fragment';

// ═══════════════════════════════════════════════════════════════════════════
//  Les petits morceaux de DOM que la bulle, la carte et la pilule ont en
//  commun : le bouton à icône (la croix, le micro, la poubelle…) et l'arc qui
//  tourne pendant que l'agent réfléchit.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Un bouton à icône Lucide, ajouté à `parent`. Le libellé sert d'infobulle et
 * de nom pour le lecteur d'écran. `onClick` null : un bouton d'envoi de
 * formulaire, dont le `submit` fait le travail.
 */
export function boutonIcone(
    parent: HTMLElement,
    icone: string,
    libelle: string,
    onClick: (() => void) | null,
    ...classes: string[]
): HTMLButtonElement {
    const el = parent.appendChild(document.createElement('button'));
    el.type = onClick ? 'button' : 'submit';
    el.classList.add(...classes);
    el.setAttribute('aria-label', libelle);
    el.title = libelle;
    setIcon(el, icone);
    if (onClick) el.addEventListener('click', onClick);
    return el;
}

/** L'arc qui tourne autour d'un rond : un quart de cercle, en SVG (styles.css, `.agent-action-arc`). */
export function arc(parent: HTMLElement): void {
    parent.insertAdjacentHTML('beforeend',
        '<svg class="agent-action-arc" viewBox="0 0 60 60" aria-hidden="true">'
        + '<circle cx="30" cy="30" r="28" pathLength="100"/></svg>');
}
