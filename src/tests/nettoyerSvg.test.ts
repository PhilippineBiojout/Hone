// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { nettoyerSvg, SVG_TAILLE_MAX } from '../ui/nettoyerSvg';

const sortie = (source: string): string => nettoyerSvg(source)?.outerHTML ?? 'null';

describe('nettoyerSvg', () => {
    it('garde un dessin ordinaire, sans taille fixe', () => {
        const svg = nettoyerSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50" width="800" height="400">'
            + '<line x1="0" y1="25" x2="100" y2="25" stroke="currentColor"/>'
            + '<text x="10" y="20" fill="var(--text-muted)">1944</text></svg>');
        expect(svg).not.toBeNull();
        expect(svg!.getAttribute('viewBox')).toBe('0 0 100 50');
        expect(svg!.hasAttribute('width')).toBe(false);
        expect(svg!.querySelector('line')?.getAttribute('stroke')).toBe('currentColor');
        expect(svg!.querySelector('text')?.textContent).toBe('1944');
    });

    it('retire script, foreignObject et image', () => {
        const html = sortie('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">'
            + '<script>alert(1)</script>'
            + '<foreignObject><div xmlns="http://www.w3.org/1999/xhtml"><img src="x" onerror="alert(1)"/></div></foreignObject>'
            + '<image href="https://exemple.com/pisteur.png"/><rect width="5" height="5"/></svg>');
        expect(html).not.toMatch(/<script|<foreignObject|<image|<img|alert|exemple/i);
        expect(html).toContain('<rect');
    });

    it('retire les attributs on* et les liens javascript:', () => {
        const html = sortie('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10" onload="alert(1)">'
            + '<a href="javascript:alert(1)"><rect width="5" height="5" onclick="alert(1)"/></a>'
            + '<circle r="2" xlink:href="javascript:alert(1)" fill="url(javascript:alert(1))"/></svg>');
        expect(html).not.toMatch(/onload|onclick|javascript|alert|href/i);
    });

    it('ne garde url() que vers un marqueur du même dessin', () => {
        const svg = nettoyerSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">'
            + '<line x2="5" marker-end="url(#fleche)"/><rect fill="url(https://exemple.com/x)"/></svg>');
        expect(svg!.querySelector('line')?.getAttribute('marker-end')).toBe('url(#fleche)');
        expect(svg!.querySelector('rect')?.hasAttribute('fill')).toBe(false);
    });

    it('refuse ce qui n\'est pas un SVG, ou trop gros', () => {
        expect(nettoyerSvg('<div>bonjour</div>')).toBeNull();
        expect(nettoyerSvg('pas du tout du XML <')).toBeNull();
        expect(nettoyerSvg(`<svg xmlns="http://www.w3.org/2000/svg">${' '.repeat(SVG_TAILLE_MAX)}</svg>`)).toBeNull();
    });

    it('ajoute l\'espace de noms SVG quand le modèle l\'a oublié', () => {
        expect(nettoyerSvg('<svg viewBox="0 0 10 10"><rect width="2"/></svg>')?.querySelector('rect')).not.toBeNull();
    });
});
