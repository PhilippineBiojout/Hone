// Les gestes de l'agent, repris de Skiper sans React ni Motion : l'API Web
// Animations et un ressort calculé ici.

export interface Eclosion {
    /** Résolue quand tout est posé et nettoyé. */
    fini: Promise<void>;
    /** Arrête tout et laisse l'élément dans son état final. */
    annuler(): void;
}
export type Rallonge = Eclosion;

/** L'apparition d'un contenu : fondu, flou et échelle (rallonge, pilule). */
export const APPARITION: Keyframe[] = [
    { opacity: 0, scale: '0.5', filter: 'blur(4px)' },
    { opacity: 1, scale: '1', filter: 'blur(0px)' },
];

/** Un élément `tag` portant `classes`, ajouté à `parent` s'il y en a un. */
export function creer<K extends keyof HTMLElementTagNameMap>(parent: Element | null, tag: K, ...classes: string[]): HTMLElementTagNameMap[K] {
    const el = document.createElement(tag);
    el.classList.add(...classes);
    parent?.appendChild(el);
    return el;
}

let compteur = 0;

const px = (n: number): string => `${n}px`;
const sansMouvement = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const fait = (): Eclosion => ({ fini: Promise.resolve(), annuler: () => {} });

/** La translation client → repère du parent positionné de `el` (placé en left/top). */
function decalage(el: HTMLElement, r: DOMRect): { dx: number; dy: number } {
    return { dx: parseFloat(el.style.left || '0') - r.left, dy: parseFloat(el.style.top || '0') - r.top };
}

/**
 * Des animations annulables. `suite` s'enchaîne si rien n'est annulé ; à la fin
 * comme à l'annulation, toutes sont annulées et `nettoyer` passe.
 */
function annulable(animations: Animation[], nettoyer: () => void, suite?: () => unknown): Eclosion {
    let annule = false;
    const toutNettoyer = (): void => {
        for (const a of animations) a.cancel();
        nettoyer();
    };
    const fini = Promise.all(animations.map((a) => a.finished))
        .then(() => (annule ? undefined : suite?.()))
        .then(() => undefined)
        // Une animation annulée rejette `finished` : c'est la fermeture, pas une erreur.
        .catch(() => {})
        .finally(() => {
            if (!annule) toutNettoyer();
        });
    return {
        fini,
        annuler: () => {
            if (annule) return;
            annule = true;
            toutNettoyer();
        },
    };
}

/**
 * Le ressort en easing CSS `linear()` : x'' = −k(x − 1) − c·x', relevé toutes
 * les 10 ms jusqu'au repos, rebond compris. Défaut : le LOGO_SPRING de Skiper.
 */
export function ressort(raideur = 300, amortissement = 30): { easing: string; duree: number } {
    const dt = 1 / 1000;
    let x = 0;
    let v = 0;
    let t = 0;
    const releves: number[] = [0];
    for (let pas = 0; pas < 2000; pas++) {
        v += (-raideur * (x - 1) - amortissement * v) * dt;
        x += v * dt;
        t += dt;
        if (pas % 10 === 9) releves.push(x);
        if (Math.abs(x - 1) < 0.001 && Math.abs(v) < 0.01) break;
    }
    releves.push(1);
    return { easing: `linear(${releves.map((r) => Math.round(r * 1000) / 1000).join(', ')})`, duree: Math.round(t * 1000) };
}

/**
 * La bulle SORT du bouton comme une goutte (Skiper64) : dans un calque fantôme,
 * un rond reste sur le bouton, un autre file puis s'étire jusqu'à la bulle, et
 * le filtre goo les soude. Le fantôme, pas la bulle : le flou rendrait le texte
 * illisible. `bulle` doit être montée et placée.
 */
export function eclore(bouton: HTMLElement | DOMRect, bulle: HTMLElement): Eclosion {
    const parent = bulle.parentElement;
    if (sansMouvement() || !parent) {
        bulle.style.opacity = '';
        return fait();
    }
    const rb = bulle.getBoundingClientRect();
    // Une boîte : le bouton a pu être retiré (la tête de chat d'une carte qui devient le chat).
    const rk = bouton instanceof DOMRect ? bouton : bouton.getBoundingClientRect();
    const { dx, dy } = decalage(bulle, rb);
    const cible = { x: rb.left + dx, y: rb.top + dy, w: rb.width, h: rb.height };
    const d = Math.min(rk.width, rk.height);
    const depuis = { x: rk.left + dx + (rk.width - d) / 2, y: rk.top + dy + (rk.height - d) / 2, w: d, h: d };
    // Le point de la bulle le plus proche du bouton : la goutte y file, puis s'ouvre.
    const ax = Math.min(Math.max(depuis.x + d / 2, cible.x + d / 2), cible.x + cible.w - d / 2);
    const ay = Math.min(Math.max(depuis.y + d / 2, cible.y + d / 2), cible.y + cible.h - d / 2);
    const depart = { x: ax - d / 2, y: ay - d / 2, w: d, h: d };

    // Le flou déborde des formes : 24 px de marge pour que le filtre ne le rogne pas.
    const gauche = Math.min(depuis.x, cible.x) - 24;
    const haut = Math.min(depuis.y, cible.y) - 24;
    const id = `agent-goo-${++compteur}`;
    const fantome = creer(null, 'div', 'agent-eclosion');
    Object.assign(fantome.style, {
        left: px(gauche),
        top: px(haut),
        width: px(Math.max(depuis.x + d, cible.x + cible.w) + 24 - gauche),
        height: px(Math.max(depuis.y + d, cible.y + cible.h) + 24 - haut),
        filter: `url(#${id})`,
    });
    // Un flou, puis l'alpha poussé (×20 − 7) : deux formes proches se soudent.
    fantome.innerHTML = `<svg width="0" height="0" style="position:absolute"><defs><filter id="${id}">`
        + '<feGaussianBlur in="SourceGraphic" stdDeviation="4.4" result="blur"/>'
        + '<feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -7" result="goo"/>'
        + '<feBlend in="SourceGraphic" in2="goo"/></filter></defs></svg>';
    const forme = (r: { x: number; y: number; w: number; h: number }): HTMLElement => {
        const el = creer(fantome, 'div', 'agent-eclosion-forme');
        Object.assign(el.style, { left: px(r.x - gauche), top: px(r.y - haut), width: px(r.w), height: px(r.h), borderRadius: '50%' });
        return el;
    };
    forme(depuis);
    const goutte = forme(depart);
    bulle.style.opacity = '0';
    parent.appendChild(fantome);

    const { easing, duree } = ressort();
    // L'étirement part 150 ms après le rond (Skiper), et prend la teinte de la bulle.
    const etire = { duration: duree, delay: 150, fill: 'both' as const };
    const animations = [
        goutte.animate([{ translate: `${depuis.x - depart.x}px ${depuis.y - depart.y}px` }, { translate: '0px 0px' }],
            { duration: duree, easing, fill: 'both' }),
        goutte.animate([
            { left: px(depart.x - gauche), top: px(depart.y - haut), width: px(d), height: px(d), borderRadius: px(d / 2) },
            { left: px(cible.x - gauche), top: px(cible.y - haut), width: px(cible.w), height: px(cible.h), borderRadius: '12px' },
        ], { ...etire, easing }),
        // Couleurs résolues ici : l'interpolation se fait en rgb, sans éclair au fondu.
        goutte.animate([{ backgroundColor: getComputedStyle(goutte).backgroundColor }, { backgroundColor: getComputedStyle(bulle).backgroundColor }],
            { ...etire, easing: 'ease-in' }),
    ];
    return annulable(animations, () => {
        fantome.remove();
        bulle.style.opacity = '';
    }, () => {
        const fondu = { duration: 140, easing: 'ease-out' };
        const fin = [
            bulle.animate([{ opacity: 0 }, { opacity: 1 }], fondu),
            fantome.animate([{ opacity: 1 }, { opacity: 0 }], { ...fondu, fill: 'forwards' }),
        ];
        animations.push(...fin);
        bulle.style.opacity = '';
        return Promise.all(fin.map((a) => a.finished));
    });
}

/**
 * « … » : la barre s'allonge vers le bas (Dynamic Toggle de Skiper). Elle prend
 * sa taille finale, et on anime sa hauteur depuis l'ancienne.
 */
export function rallonger(barre: HTMLElement, plus: HTMLElement, nouveaux: HTMLElement[]): Rallonge {
    const avant = barre.offsetHeight;
    plus.style.display = 'none';
    for (const el of nouveaux) el.hidden = false;
    const apres = barre.offsetHeight;
    if (sansMouvement() || apres <= avant) return fait();

    // Le `{ type: "spring", bounce: 0.16 }` de Motion.
    const { easing, duree } = ressort(520, 38);
    barre.style.boxSizing = 'border-box';
    barre.style.overflow = 'hidden';
    return annulable([
        barre.animate([{ height: px(avant) }, { height: px(apres) }], { duration: duree, easing }),
        ...nouveaux.map((el, i) => el.animate(APPARITION,
            { duration: 220, delay: 70 + i * 35, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'backwards' })),
    ], () => {
        barre.style.boxSizing = '';
        barre.style.overflow = '';
    });
}

/**
 * La barre (ou la pilule) se résorbe en rond : une forme part de `depuis` et se
 * pose sur `cercle`, qui apparaît alors. `fini` : le rond est montré.
 */
export function resorber(depuis: DOMRect, cercle: HTMLElement): Eclosion {
    const montrer = (): void => { cercle.style.opacity = ''; };
    const parent = cercle.parentElement;
    if (sansMouvement() || !parent) {
        montrer();
        return fait();
    }
    const rc = cercle.getBoundingClientRect();
    const { dx, dy } = decalage(cercle, rc);
    const forme = creer(parent, 'div', 'agent-action-forme');
    const { easing, duree } = ressort(700, 48);
    return annulable([forme.animate([
        { left: px(depuis.left + dx), top: px(depuis.top + dy), width: px(depuis.width), height: px(depuis.height), borderRadius: '10px' },
        { left: px(rc.left + dx), top: px(rc.top + dy), width: px(rc.width), height: px(rc.height), borderRadius: px(rc.width / 2) },
    ], { duration: duree, easing, fill: 'both' })], () => {
        forme.remove();
        montrer();
    }, () => {
        // L'icône sort du rond d'un petit pop.
        cercle.firstElementChild?.animate([{ opacity: 0, scale: '0.5' }, { opacity: 1, scale: '1' }],
            { duration: 140, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1.2)' });
    });
}
