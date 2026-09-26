// Le SVG de Visualiser vient du modèle, et la page a Node : on ne l'insère
// jamais tel quel, on reconstruit un SVG neuf depuis une liste blanche.

const SVG_NS = 'http://www.w3.org/2000/svg';
export const SVG_TAILLE_MAX = 60_000;
const ELEMENTS_MAX = 400;

const BALISES = new Set([
    'svg', 'g', 'rect', 'circle', 'ellipse', 'line', 'path', 'polyline', 'polygon',
    'text', 'tspan', 'marker', 'defs', 'title',
]);

const ATTRIBUTS = new Set([
    'viewBox', 'preserveAspectRatio',
    'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height',
    'd', 'points', 'transform', 'dx', 'dy',
    'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray',
    'stroke-linecap', 'stroke-linejoin', 'opacity',
    'font-family', 'font-size', 'font-weight', 'font-style', 'text-anchor', 'dominant-baseline',
    'id', 'marker-start', 'marker-mid', 'marker-end',
    'markerWidth', 'markerHeight', 'refX', 'refY', 'orient', 'markerUnits',
]);

/** Pas de `javascript:` ni d'expression, et `url()` seulement vers un id du même SVG. */
function valeurSure(valeur: string): boolean {
    const v = valeur.toLowerCase();
    if (/javascript:|data:|expression\(|@import/.test(v)) return false;
    return (v.match(/url\(([^)]*)\)/g) ?? []).every((u) => /^url\(\s*['"]?#[\w-]+['"]?\s*\)$/.test(u));
}

function copier(source: Element, compte: { n: number }): Element | null {
    const nom = source.localName;
    if (!BALISES.has(nom) || source.namespaceURI !== SVG_NS || ++compte.n > ELEMENTS_MAX) return null;
    const el = document.createElementNS(SVG_NS, nom);
    for (const attr of Array.from(source.attributes)) {
        // xlink:href, xml:base… tombent avec leur espace de noms.
        if ((attr.namespaceURI === null || attr.namespaceURI === SVG_NS) && ATTRIBUTS.has(attr.name) && valeurSure(attr.value)) {
            el.setAttribute(attr.name, attr.value);
        }
    }
    for (const enfant of Array.from(source.childNodes)) {
        if (enfant.nodeType === Node.TEXT_NODE) {
            if (nom === 'text' || nom === 'tspan' || nom === 'title') el.appendChild(document.createTextNode(enfant.textContent ?? ''));
        } else if (enfant.nodeType === Node.ELEMENT_NODE) {
            const copie = copier(enfant as Element, compte);
            if (copie) el.appendChild(copie);
        }
    }
    return el;
}

/** Un `<svg>` neuf, sûr à insérer, sans largeur ni hauteur ; null si illisible. */
export function nettoyerSvg(source: string): SVGSVGElement | null {
    if (source.length > SVG_TAILLE_MAX) return null;
    // Le modèle oublie souvent l'espace de noms.
    const avecNs = /<svg\b[^>]*\bxmlns=/.test(source) ? source : source.replace(/<svg\b/, `<svg xmlns="${SVG_NS}"`);
    const doc = new DOMParser().parseFromString(avecNs, 'image/svg+xml');
    const racine = doc.documentElement;
    if (!racine || racine.localName !== 'svg' || doc.getElementsByTagName('parsererror').length > 0) return null;
    const svg = copier(racine, { n: 0 }) as SVGSVGElement | null;
    svg?.removeAttribute('width');
    svg?.removeAttribute('height');
    svg?.setAttribute('role', 'img');
    return svg;
}
