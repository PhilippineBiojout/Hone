import type { WidgetAnchor, WidgetHandle } from 'fragment';
import { MARGE } from './placement';
import type { Repere } from './repere';
import { creer } from '../ui/ui';

/** Où un widget a été posé (écart au glyphe du trait) et sa taille, en px document. */
export interface Cadre {
    dx: number;
    dy: number;
    width: number;
    height: number;
}

/** En deçà, le titre, la croix et la saisie du chat ne tiennent plus. */
const LARGEUR_MIN = 220;
const HAUTEUR_MIN = 120;
/** Au-delà, un déplacement et plus un clic (le seuil de DocWidget et de Toolbar). */
const SEUIL = 4;
const BORDS = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const;
type Bord = typeof BORDS[number];
type Transformer = (dx: number, dy: number, depart: DOMRect) => DOMRect;

/**
 * Le chat ou une carte en widget du cœur : on le déplace par `poignee`, on
 * l'agrandit par ses bords. Le suivi du texte est celui de l'ancre document.
 * Le patron de DocWidget, dont les gestes sont privés.
 */
export class Fenetre {

    private handle: WidgetHandle | null = null;
    /** Déplacée ou agrandie : sa place devient un choix. */
    private touchee = false;

    constructor(private readonly el: HTMLElement, poignee: HTMLElement, private readonly repere: Repere) {
        el.classList.add('agent-widget');
        poignee.classList.add('agent-widget-poignee');
        this.geste(poignee, (e) =>
            // Les boutons de l'en-tête (la croix) restent des boutons.
            e.target instanceof Element && e.target.closest('button, input, textarea')
                ? null
                : (dx, dy, depart) => bornerAuPane(this.repere, dx, dy, depart));
        for (const bord of BORDS) {
            const b = creer(el, 'div', 'agent-widget-bord', `mod-${bord}`);
            b.setAttribute('aria-hidden', 'true');
            this.geste(b, () => (dx, dy, depart) => this.bornerTaille(bord, dx, dy, depart));
        }
    }

    estMontee(): boolean {
        return this.handle !== null;
    }

    /** Monte le widget : à la place et la taille d'un cadre gardé, sinon là où `placer` le pose. */
    monter(cadre: Cadre | null, placer: (el: HTMLElement) => WidgetAnchor | null): void {
        this.retirer();
        this.touchee = cadre !== null;
        if (cadre) this.appliquerTaille(this.plafonner(cadre));
        else {
            this.oublierTaille();
            // Jamais plus large que son pane : le parent du widget est le plan document, 0×0.
            this.el.style.maxWidth = `${this.repere.ecartDocument(this.repere.paneClient().width - 2 * MARGE, 0).dx}px`;
        }
        this.handle = this.repere.monter(this.el, cadre ? () => this.repere.ancreDuCadre(cadre) : placer);
    }

    ancrer(a: WidgetAnchor | null): void {
        if (a) this.handle?.setAnchor(a);
    }

    /** Le cadre à garder, null si on n'y a pas touché ou si son texte a disparu (ancre viewport). */
    cadre(): Cadre | null {
        const a = this.handle?.getAnchor();
        if (!this.touchee || !a || a.mode !== 'document') return null;
        const taille = this.repere.ecartDocument(this.el.offsetWidth, this.el.offsetHeight);
        return { dx: a.dx, dy: a.dy, width: taille.dx, height: taille.dy };
    }

    retirer(): void {
        this.handle?.remove();
        this.handle = null;
        this.el.remove();
    }

    /** Tirer le haut ou la gauche déplace le coin : le bord opposé ne bouge pas. */
    private bornerTaille(bord: Bord, dx: number, dy: number, d: DOMRect): DOMRect {
        const p = this.repere.paneClient();
        // Le minimum ne grandit jamais un widget déjà plus petit que lui.
        const lMin = Math.min(LARGEUR_MIN, d.width);
        const hMin = Math.min(HAUTEUR_MIN, d.height);
        let { left, top, right, bottom } = d;
        if (bord.includes('e')) right = Math.min(Math.max(left + lMin, right + dx), p.right - MARGE);
        if (bord.includes('s')) bottom = Math.min(Math.max(top + hMin, bottom + dy), p.bottom - MARGE);
        if (bord.includes('w')) left = Math.max(Math.min(right - lMin, left + dx), p.left + MARGE);
        if (bord.includes('n')) top = Math.max(Math.min(bottom - hMin, top + dy), p.top + MARGE);
        return new DOMRect(left, top, right - left, bottom - top);
    }

    /**
     * Un geste sur `cible` : `debut` décide au pointerdown s'il a lieu et rend la
     * boîte client voulue. On décale l'ancre COURANTE, qu'une frappe a pu remapper.
     */
    private geste(cible: HTMLElement, debut: (e: PointerEvent) => Transformer | null): void {
        cible.addEventListener('pointerdown', (e) => {
            if (e.button !== 0 || !this.handle) return;
            const transformer = debut(e);
            if (!transformer) return;
            const depart = this.el.getBoundingClientRect();
            const a0 = this.handle.getAnchor();
            suivreGeste(e, cible, {
                debut: () => {
                    this.touchee = true;
                    this.el.classList.add('is-geste');
                },
                pas: (dx, dy) => {
                    const voulue = transformer(dx, dy, depart);
                    if (voulue.width !== depart.width || voulue.height !== depart.height) {
                        const taille = this.repere.ecartDocument(voulue.width, voulue.height);
                        this.appliquerTaille({ width: taille.dx, height: taille.dy });
                    }
                    decalerDepuis(this.handle, a0, this.repere, voulue.left - depart.left, voulue.top - depart.top);
                },
                fin: () => this.el.classList.remove('is-geste'),
            });
        });
    }

    /** Jamais plus grand que son pane, qui a pu rétrécir depuis. */
    private plafonner(c: Cadre): Cadre {
        const p = this.repere.paneClient();
        const max = this.repere.ecartDocument(p.width - 2 * MARGE, p.height - 2 * MARGE);
        return {
            ...c,
            width: Math.min(c.width, Math.max(Math.min(LARGEUR_MIN, c.width), max.dx)),
            height: Math.min(c.height, Math.max(Math.min(HAUTEUR_MIN, c.height), max.dy)),
        };
    }

    private appliquerTaille(t: { width: number; height: number }): void {
        // is-cadre : taille imposée, le contenu défile dedans.
        this.el.classList.add('is-cadre');
        Object.assign(this.el.style, { maxWidth: 'none', width: `${t.width}px`, height: `${t.height}px` });
    }

    private oublierTaille(): void {
        this.el.classList.remove('is-cadre');
        Object.assign(this.el.style, { width: '', height: '', maxWidth: '' });
    }
}

/** Déplacé, un widget reste dans son pane, à MARGE de ses bords. */
function bornerAuPane(repere: Repere, dx: number, dy: number, depart: DOMRect): DOMRect {
    const p = repere.paneClient();
    const x = Math.max(p.left + MARGE, Math.min(depart.left + dx, p.right - MARGE - depart.width));
    const y = Math.max(p.top + MARGE, Math.min(depart.top + dy, p.bottom - MARGE - depart.height));
    return new DOMRect(x, y, depart.width, depart.height);
}

/** Suit un geste au pointeur commencé par `e`, au-delà du SEUIL ; `pas` reçoit l'écart client. */
export function suivreGeste(
    e: PointerEvent,
    cible: HTMLElement,
    rappels: { debut?: () => void; pas: (dx: number, dy: number) => void; fin?: () => void },
): void {
    e.preventDefault();
    e.stopPropagation();
    const { clientX: x0, clientY: y0 } = e;
    let parti = false;
    cible.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent): void => {
        const dx = ev.clientX - x0;
        const dy = ev.clientY - y0;
        if (!parti && Math.abs(dx) < SEUIL && Math.abs(dy) < SEUIL) return;
        if (!parti) rappels.debut?.();
        parti = true;
        rappels.pas(dx, dy);
    };
    // Perdre le focus fenêtre ne délivre jamais de pointerup : lostpointercapture aussi.
    const fins = ['pointerup', 'pointercancel', 'lostpointercapture'] as const;
    const fin = (ev: PointerEvent): void => {
        cible.removeEventListener('pointermove', move);
        for (const f of fins) cible.removeEventListener(f, fin);
        if (cible.hasPointerCapture(ev.pointerId)) cible.releasePointerCapture(ev.pointerId);
        rappels.fin?.();
    };
    cible.addEventListener('pointermove', move);
    for (const f of fins) cible.addEventListener(f, fin);
}

/** Déplace un widget par une poignée : `boite` est ce qu'on voit et qu'on borne, `handle` l'ancre qu'on décale. */
export function deplacerParPoignee(e: PointerEvent, cible: HTMLElement, boite: HTMLElement, handle: WidgetHandle, repere: Repere): void {
    const depart = boite.getBoundingClientRect();
    const a0 = handle.getAnchor();
    suivreGeste(e, cible, {
        debut: () => boite.classList.add('is-dragging'),
        pas: (dx, dy) => {
            const voulue = bornerAuPane(repere, dx, dy, depart);
            decalerDepuis(handle, a0, repere, voulue.left - depart.left, voulue.top - depart.top);
        },
        fin: () => boite.classList.remove('is-dragging'),
    });
}

/** L'ancre courante de `handle`, décalée d'un écart client depuis l'ancre de départ `a0`. */
function decalerDepuis(handle: WidgetHandle | null, a0: WidgetAnchor, repere: Repere, dx: number, dy: number): void {
    const a = handle?.getAnchor();
    if (!handle || !a) return;
    const d = repere.ecartDocument(dx, dy);
    if (a.mode === 'viewport' && a0.mode === 'viewport') handle.setAnchor({ ...a, x: a0.x + d.dx, y: a0.y + d.dy });
    else if (a.mode === 'document' && a0.mode === 'document') handle.setAnchor({ ...a, dx: a0.dx + d.dx, dy: a0.dy + d.dy });
    else handle.setAnchor(a);
}
