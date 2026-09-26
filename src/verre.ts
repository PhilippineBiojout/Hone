import { Component } from 'fragment';

// ═══════════════════════════════════════════════════════════════════════════
//  La lentille de verre des barres d'outils (la barre d'annotation comme celle
//  de l'agent).
//
//  Une seule goutte, posée au-dessus des boutons, qui suit le survol : elle
//  glisse d'un bouton à l'autre en s'étirant pendant le trajet, puis se pose et
//  réfracte ce qui est dessous (l'icône paraît grossie, les bords la courbent).
//
//  ★ POURQUOI un filtre SVG et pas liquid-glass-js : la bibliothèque photographie
//    le <body> avec html2canvas au montage et réfracte cette photo. Ici la barre
//    change sans arrêt (outil armé, couleur choisie), la photo serait périmée au
//    premier clic. `backdrop-filter: url(#…)` réfracte le VRAI rendu, à chaque
//    image, sans dépendance. Il n'existe que dans Chromium : c'est le cas
//    d'Electron, pas forcément d'un navigateur.
//
//  ★ POURQUOI un observateur du DOM : le cœur ne se modifie pas, et il n'expose
//    aucun signal « une Toolbar vient d'apparaître ». On guette donc les
//    `.toolbar` posées dans la page, et chacune reçoit sa lentille, retirée
//    quand la barre quitte le DOM. Venue de `core/toolbarGlass.ts` (branche
//    `feat/toolbar-verre`), à l'identique hors ce branchement.
//
//  Retrait : supprimer ce fichier, la ligne `poserLeVerre` de main.ts et la
//  section « lentille de verre » de styles.css. Le survol gris revient seul.
// ═══════════════════════════════════════════════════════════════════════════

/** Ce que la lentille suit : un bouton, une pastille, la poignée. */
const CIBLES = '.toolbar-option, .toolbar-item:not(.mod-options):not(.is-disabled), .toolbar-handle';

/** Grossissement au centre de la lentille (0,12 = 12 %). */
const LOUPE = 0.12;
/**
 * Largeur, en px, du bord qui courbe la lumière, et son déplacement maximal.
 * Plafonnés à une fraction du petit côté : sur une pastille de 24 px, un bord de
 * 5 px tordait le rond coloré en carré.
 */
const BORD = 5;
const BORD_FORCE = 5;
const BORD_MAX = 0.15;
/** Déplacement maximal du filtre, en px : doit couvrir loupe + bord. */
const ECHELLE = 18;

const DUREE_GLISSE = 340;
const DUREE_APPARITION = 180;

let compteur = 0;

interface Boite {
    left: number;
    top: number;
    width: number;
    height: number;
}

export class ToolbarGlass extends Component {

    private toolbarEl: HTMLElement;
    private lentille!: HTMLElement;
    private carte!: SVGFEImageElement;
    private cible: HTMLElement | null = null;
    private suivi = 0;
    /** La carte de déplacement déjà calculée, par taille (« 24x24 »). */
    private cartes = new Map<string, string>();

    constructor(toolbarEl: HTMLElement) {
        super();
        this.toolbarEl = toolbarEl;
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
            const el = (e.target as HTMLElement).closest<HTMLElement>(CIBLES);
            // ★ Entre deux boutons (un gap, un séparateur) la lentille RESTE où
            //   elle est : la faire disparaître et revenir la ferait clignoter à
            //   chaque passage d'un bouton au suivant.
            if (el && this.toolbarEl.contains(el)) this.allerSur(el);
        });
        this.registerDomEvent(this.toolbarEl, 'pointerleave', () => this.cacher());
        // Le drag de la poignée déplace toute la barre : la lentille n'a plus
        // rien à suivre pendant le geste.
        this.registerDomEvent(this.toolbarEl, 'pointerdown', (e) => {
            if ((e.target as HTMLElement).closest('.toolbar-handle')) this.cacher();
        });
    }

    // ── interne ────────────────────────────────────────────────────────────

    private allerSur(el: HTMLElement): void {
        if (el === this.cible) return;
        const arrivee = this.boiteDe(el);
        const depart = this.cible ? this.boiteActuelle() : null;
        this.cible = el;

        this.poserCarte(arrivee);
        for (const a of this.lentille.getAnimations()) a.cancel();
        this.appliquer(arrivee);
        this.lentille.classList.add('is-visible');

        if (reduitLeMouvement()) return;

        if (!depart) {
            this.lentille.animate(
                [
                    { transform: 'scale(0.6)', opacity: 0 },
                    { transform: 'scale(1)', opacity: 1 },
                ],
                { duration: DUREE_APPARITION, easing: 'cubic-bezier(.2,.9,.3,1.2)' },
            );
            return;
        }

        // ★ L'étirement : à mi-course la goutte est plus LONGUE dans le sens du
        //   trajet et plus FINE en travers, comme une goutte qu'on tire. Elle
        //   n'est jamais plus longue que l'espace entre les deux boutons, pour
        //   qu'un saut de bouton voisin reste un petit geste.
        const dx = centreX(arrivee) - centreX(depart);
        const dy = centreY(arrivee) - centreY(depart);
        const vertical = Math.abs(dy) >= Math.abs(dx);
        const trajet = Math.hypot(dx, dy);
        const milieu: Boite = {
            left: 0, top: 0,
            width: (depart.width + arrivee.width) / 2,
            height: (depart.height + arrivee.height) / 2,
        };
        if (vertical) {
            milieu.height += trajet * 0.55;
            milieu.width *= 0.84;
        } else {
            milieu.width += trajet * 0.55;
            milieu.height *= 0.84;
        }
        milieu.left = (centreX(depart) + centreX(arrivee)) / 2 - milieu.width / 2;
        milieu.top = (centreY(depart) + centreY(arrivee)) / 2 - milieu.height / 2;

        this.lentille.animate(
            [
                { ...enPx(depart), easing: 'cubic-bezier(.4,0,.6,1)' },
                { ...enPx(milieu), offset: 0.45, easing: 'cubic-bezier(.2,.9,.25,1.25)' },
                enPx(arrivee),
            ],
            { duration: DUREE_GLISSE },
        );
        this.suivreLaTaille();
    }

    /**
     * ★ La carte est posée en PIXELS : en `100%`, Chromium ne l'aligne pas sur
     *   la lentille dans un backdrop-filter (mesuré : la réfraction part dans un
     *   coin). Pendant le glissement la goutte change de taille à chaque image ;
     *   la carte la suit, étirée, sinon la partie qui dépasse lirait un pixel
     *   transparent, c'est-à-dire un décalage maximal.
     */
    private suivreLaTaille(): void {
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

    private appliquer(b: Boite): void {
        Object.assign(this.lentille.style, enPx(b));
    }

    /** La boîte d'un élément, dans le repère de la toolbar (bordure exclue). */
    private boiteDe(el: HTMLElement): Boite {
        const r = el.getBoundingClientRect();
        const t = this.toolbarEl.getBoundingClientRect();
        return {
            left: r.left - t.left - this.toolbarEl.clientLeft,
            top: r.top - t.top - this.toolbarEl.clientTop,
            width: r.width,
            height: r.height,
        };
    }

    /** Où est la lentille À CET INSTANT, animation en cours comprise. */
    private boiteActuelle(): Boite {
        return this.boiteDe(this.lentille);
    }

    private poserCarte(b: Boite): void {
        const w = Math.round(b.width);
        const h = Math.round(b.height);
        const cle = `${w}x${h}`;
        let url = this.cartes.get(cle);
        if (!url) {
            url = carteDeDeplacement(w, h, rayonDe(this.lentille));
            this.cartes.set(cle, url);
        }
        this.carte.setAttribute('href', url);
        this.tailleCarte(b.width, b.height);
    }
}

/**
 * La carte de déplacement d'une lentille w×h aux coins de rayon r.
 *
 * feDisplacementMap lit, pour chaque pixel, le rouge (décalage en x) et le vert
 * (décalage en y) : 128 = ne pas bouger. Deux effets s'y additionnent :
 *   - la loupe : chaque pixel va chercher plus près du centre, l'icône grossit ;
 *   - le bord : dans une bande de BORD px, la lumière est tirée vers l'intérieur,
 *     de plus en plus fort vers l'arête. C'est ce qui fait « verre épais ».
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
    const force = Math.min(BORD_FORCE, Math.min(w, h) * BORD_MAX);

    // Distance signée au bord d'un rectangle arrondi : positive à l'intérieur.
    const dedans = (x: number, y: number): number => {
        const qx = Math.abs(x - cx) - (cx - rayon);
        const qy = Math.abs(y - cy) - (cy - rayon);
        const dehors = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0);
        return rayon - dehors;
    };

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const px = x + 0.5;
            const py = y + 0.5;
            let ox = -(px - cx) * LOUPE;
            let oy = -(py - cy) * LOUPE;

            const d = dedans(px, py);
            if (d < bord) {
                // La normale vers l'intérieur, par le gradient de la distance.
                const nx = dedans(px + 0.5, py) - dedans(px - 0.5, py);
                const ny = dedans(px, py + 0.5) - dedans(px, py - 0.5);
                const n = Math.hypot(nx, ny) || 1;
                const f = force * (1 - Math.max(d, 0) / bord) ** 2;
                ox += (nx / n) * f;
                oy += (ny / n) * f;
            }

            const i = (y * w + x) * 4;
            img.data[i] = 128 + Math.max(-127, Math.min(127, (ox / demi) * 127));
            img.data[i + 1] = 128 + Math.max(-127, Math.min(127, (oy / demi) * 127));
            img.data[i + 2] = 128;
            img.data[i + 3] = 255;
        }
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL();
}

function rayonDe(el: HTMLElement): number {
    return parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
}

function reduitLeMouvement(): boolean {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function centreX(b: Boite): number {
    return b.left + b.width / 2;
}

function centreY(b: Boite): number {
    return b.top + b.height / 2;
}

function enPx(b: Boite): Record<'left' | 'top' | 'width' | 'height', string> {
    return {
        left: `${b.left}px`,
        top: `${b.top}px`,
        width: `${b.width}px`,
        height: `${b.height}px`,
    };
}

/**
 * Pose une lentille sur chaque `.toolbar` présente ou à venir, et la retire
 * quand sa barre quitte la page. Tout meurt avec `parent` (le plugin).
 */
export function poserLeVerre(parent: Component): void {
    const lentilles = new Map<HTMLElement, ToolbarGlass>();

    const poser = (el: HTMLElement) => {
        if (lentilles.has(el)) return;
        lentilles.set(el, parent.addChild(new ToolbarGlass(el)));
    };

    const balayer = (racine: ParentNode) => {
        if (racine instanceof HTMLElement && racine.classList.contains('toolbar')) poser(racine);
        racine.querySelectorAll<HTMLElement>('.toolbar').forEach(poser);
    };

    const observateur = new MutationObserver((mutations) => {
        for (const m of mutations) {
            for (const n of m.addedNodes) if (n instanceof HTMLElement) balayer(n);
        }
        // Une barre retirée, directement ou avec un ancêtre : sa lentille part.
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
