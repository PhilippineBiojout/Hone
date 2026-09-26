import { Component } from 'fragment';

// La lentille de verre qui suit le survol des barres d'outils. Un filtre SVG en
// `backdrop-filter` réfracte le vrai rendu à chaque image (Chromium seulement).
// Retrait : ce fichier, `poserLeVerre` dans main.ts, sa section de styles.css.

const CIBLES = '.toolbar-option, .toolbar-item:not(.mod-options):not(.is-disabled), .toolbar-handle';
const LOUPE = 0.12;
/** Le bord qui courbe la lumière (px), plafonné à une fraction du petit côté. */
const BORD = 5;
const BORD_MAX = 0.15;
const ECHELLE = 18;

interface Boite { left: number; top: number; width: number; height: number }

let compteur = 0;

class ToolbarGlass extends Component {
    private lentille!: HTMLElement;
    private carte!: SVGFEImageElement;
    private cible: HTMLElement | null = null;
    private suivi = 0;
    private cartes = new Map<string, string>();

    constructor(private toolbarEl: HTMLElement) {
        super();
    }

    onload(): void {
        const id = `toolbar-glass-${++compteur}`;
        this.lentille = document.createElement('div');
        this.lentille.classList.add('toolbar-glass');
        this.lentille.style.setProperty('--toolbar-glass-filtre', `url(#${id})`);
        this.lentille.innerHTML = `
            <svg class="toolbar-glass-defs" aria-hidden="true">
                <filter id="${id}" color-interpolation-filters="sRGB">
                    <feImage result="carte" x="0" y="0" preserveAspectRatio="none" />
                    <feDisplacementMap in="SourceGraphic" in2="carte" scale="${ECHELLE}"
                                       xChannelSelector="R" yChannelSelector="G" />
                </filter>
            </svg>`;
        this.carte = this.lentille.querySelector('feImage')!;
        this.toolbarEl.appendChild(this.lentille);
        this.register(() => this.lentille.remove());
        this.register(() => cancelAnimationFrame(this.suivi));

        this.registerDomEvent(this.toolbarEl, 'pointerover', (e) => {
            if (this.toolbarEl.classList.contains('is-dragging')) return;
            // Entre deux boutons, la lentille reste où elle est : sinon elle clignote.
            const el = (e.target as HTMLElement).closest<HTMLElement>(CIBLES);
            if (el && this.toolbarEl.contains(el)) this.allerSur(el);
        });
        this.registerDomEvent(this.toolbarEl, 'pointerleave', () => this.cacher());
        this.registerDomEvent(this.toolbarEl, 'pointerdown', (e) => {
            if ((e.target as HTMLElement).closest('.toolbar-handle')) this.cacher();
        });
    }

    private allerSur(el: HTMLElement): void {
        if (el === this.cible) return;
        const arrivee = this.boiteDe(el);
        const depart = this.cible ? this.boiteDe(this.lentille) : null;
        this.cible = el;

        this.poserCarte(arrivee);
        for (const a of this.lentille.getAnimations()) a.cancel();
        Object.assign(this.lentille.style, enPx(arrivee));
        this.lentille.classList.add('is-visible');

        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        if (!depart) {
            this.lentille.animate([{ transform: 'scale(0.6)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }],
                { duration: 180, easing: 'cubic-bezier(.2,.9,.3,1.2)' });
            return;
        }

        // À mi-course, la goutte s'allonge dans le sens du trajet et s'affine en travers.
        const cx = (b: Boite) => b.left + b.width / 2;
        const cy = (b: Boite) => b.top + b.height / 2;
        const trajet = Math.hypot(cx(arrivee) - cx(depart), cy(arrivee) - cy(depart));
        const vertical = Math.abs(cy(arrivee) - cy(depart)) >= Math.abs(cx(arrivee) - cx(depart));
        let width = (depart.width + arrivee.width) / 2;
        let height = (depart.height + arrivee.height) / 2;
        if (vertical) [height, width] = [height + trajet * 0.55, width * 0.84];
        else [width, height] = [width + trajet * 0.55, height * 0.84];
        const milieu = {
            left: (cx(depart) + cx(arrivee)) / 2 - width / 2, top: (cy(depart) + cy(arrivee)) / 2 - height / 2, width, height,
        };
        this.lentille.animate([
            { ...enPx(depart), easing: 'cubic-bezier(.4,0,.6,1)' },
            { ...enPx(milieu), offset: 0.45, easing: 'cubic-bezier(.2,.9,.25,1.25)' },
            enPx(arrivee),
        ], { duration: 340 });

        // La carte suit la taille de la goutte à chaque image : posée en %, Chromium la décale.
        cancelAnimationFrame(this.suivi);
        const image = () => {
            this.tailleCarte(this.lentille.offsetWidth, this.lentille.offsetHeight);
            if (this.lentille.getAnimations().length > 0) this.suivi = requestAnimationFrame(image);
        };
        image();
    }

    private tailleCarte(w: number, h: number): void {
        this.carte.setAttribute('width', String(w));
        this.carte.setAttribute('height', String(h));
    }

    private cacher(): void {
        if (!this.cible) return;
        this.cible = null;
        for (const a of this.lentille.getAnimations()) a.cancel();
        this.lentille.classList.remove('is-visible');
    }

    /** Dans le repère de la toolbar, bordure exclue. */
    private boiteDe(el: HTMLElement): Boite {
        const r = el.getBoundingClientRect();
        const t = this.toolbarEl.getBoundingClientRect();
        return { left: r.left - t.left - this.toolbarEl.clientLeft, top: r.top - t.top - this.toolbarEl.clientTop, width: r.width, height: r.height };
    }

    private poserCarte(b: Boite): void {
        const cle = `${Math.round(b.width)}x${Math.round(b.height)}`;
        if (!this.cartes.has(cle)) {
            const rayon = parseFloat(getComputedStyle(this.lentille).borderTopLeftRadius) || 0;
            this.cartes.set(cle, carteDeDeplacement(Math.round(b.width), Math.round(b.height), rayon));
        }
        this.carte.setAttribute('href', this.cartes.get(cle)!);
        this.tailleCarte(b.width, b.height);
    }
}

/**
 * La carte de feDisplacementMap (rouge : x, vert : y, 128 immobile) : la loupe
 * tire vers le centre, et le bord tire vers l'intérieur, plus fort vers l'arête.
 */
function carteDeDeplacement(w: number, h: number, r: number): string {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(w, h);
    const cx = w / 2;
    const cy = h / 2;
    const rayon = Math.min(r, cx, cy);
    const demi = ECHELLE / 2;
    const bord = Math.min(BORD, Math.min(w, h) * BORD_MAX);
    // Distance signée au bord d'un rectangle arrondi, positive à l'intérieur.
    const dedans = (x: number, y: number): number => {
        const qx = Math.abs(x - cx) - (cx - rayon);
        const qy = Math.abs(y - cy) - (cy - rayon);
        return rayon - (Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0));
    };
    const canal = (o: number) => 128 + Math.max(-127, Math.min(127, (o / demi) * 127));

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const px = x + 0.5;
            const py = y + 0.5;
            let ox = -(px - cx) * LOUPE;
            let oy = -(py - cy) * LOUPE;
            const d = dedans(px, py);
            if (d < bord) {
                const nx = dedans(px + 0.5, py) - dedans(px - 0.5, py);
                const ny = dedans(px, py + 0.5) - dedans(px, py - 0.5);
                const n = Math.hypot(nx, ny) || 1;
                const f = bord * (1 - Math.max(d, 0) / bord) ** 2;
                ox += (nx / n) * f;
                oy += (ny / n) * f;
            }
            img.data.set([canal(ox), canal(oy), 128, 255], (y * w + x) * 4);
        }
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL();
}

const enPx = (b: Boite) => ({ left: `${b.left}px`, top: `${b.top}px`, width: `${b.width}px`, height: `${b.height}px` });

/** Une lentille sur chaque `.toolbar` présente ou à venir, retirée avec sa barre ; tout meurt avec `parent`. */
export function poserLeVerre(parent: Component): void {
    const lentilles = new Map<HTMLElement, ToolbarGlass>();
    const balayer = (racine: ParentNode) => {
        const barres = [...racine.querySelectorAll<HTMLElement>('.toolbar')];
        if (racine instanceof HTMLElement && racine.classList.contains('toolbar')) barres.unshift(racine);
        for (const el of barres) if (!lentilles.has(el)) lentilles.set(el, parent.addChild(new ToolbarGlass(el)));
    };
    const observateur = new MutationObserver((mutations) => {
        for (const m of mutations) for (const n of m.addedNodes) if (n instanceof HTMLElement) balayer(n);
        for (const [el, verre] of lentilles) {
            if (el.isConnected) continue;
            parent.removeChild(verre);
            lentilles.delete(el);
        }
    });
    balayer(document.body);
    observateur.observe(document.body, { childList: true, subtree: true });
    parent.register(() => observateur.disconnect());
}
