// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { rendreEnDirect, rendreMarkdown } from '../ui/rendu';

const rendu = (texte: string, o = {}) => {
    const el = document.createElement('div');
    rendreMarkdown(el, texte, o);
    return el;
};

describe('rendu du texte des agents', () => {
    it('met en forme le Markdown : plus aucune syntaxe visible', () => {
        const el = rendu('## Résumé\n\n**Rydberg** et *circulaire* :\n\n- un\n- deux\n\n| n | l |\n|---|---|\n| 12 | 11 |');
        expect(el.querySelector('h2')?.textContent).toBe('Résumé');
        expect(el.querySelector('strong')?.textContent).toBe('Rydberg');
        expect(el.querySelector('em')?.textContent).toBe('circulaire');
        expect(el.querySelectorAll('li')).toHaveLength(2);
        expect(el.querySelector('td')?.textContent).toBe('12');
        expect(el.textContent).not.toMatch(/\*\*|##|\|---/);
        expect(el.classList.contains('hone-rendu')).toBe(true);
    });

    it('dessine les formules en MathML, sous les quatre écritures', () => {
        for (const texte of ['Donc \\(n\'=0\\).', 'Donc $n\'=0$.', '$$n\' = n - \\ell - 1$$', '\\[Y_{\\ell,\\ell}\\]']) {
            const el = rendu(texte);
            expect(el.querySelector('math'), texte).not.toBeNull();
            expect(el.textContent, texte).not.toMatch(/\\\(|\$\$|\\\[/);
        }
        // Des prix ne sont pas une formule.
        expect(rendu('Entre 5 $ et 6 $.').querySelector('math')).toBeNull();
        // Une formule illisible reste écrite, sans casser le reste.
        expect(rendu('Voir \\(\\frac{1}\\).').querySelector('code')?.textContent).toBe('\\(\\frac{1}\\)');
    });

    it('affiche un dessin SVG, en bloc ou écrit à nu, et jamais comme du code', () => {
        const svg = '<svg viewBox="0 0 10 10"><ellipse cx="5" cy="5" rx="4" ry="2" stroke="#39444c"/></svg>';
        for (const texte of [`Voici :\n\n\`\`\`svg\n${svg}\n\`\`\``, `Voici : ${svg} voilà.`]) {
            const el = rendu(texte);
            expect(el.querySelector('.hone-svg svg ellipse'), texte).not.toBeNull();
            expect(el.textContent, texte).not.toContain('<ellipse');
        }
        // Pendant le direct, un dessin pas encore fini n'est pas montré en code.
        const enCours = rendu('Voici : <svg viewBox="0 0 10 10"><ellipse cx="5"');
        expect(enCours.querySelector('.hone-svg.is-attente')?.textContent).toBe('Dessin en cours…');
    });

    it('n\'interprète aucun HTML du modèle, ne suit que les liens sûrs', () => {
        const el = rendu('<script>alert(1)</script>\n\nTexte <img src=x onerror=alert(1)> [clic](javascript:alert(1)) [web](https://example.com)');
        expect(el.querySelector('script, img')).toBeNull();
        expect(el.textContent).toContain('<script>');
        const liens = [...el.querySelectorAll('a')];
        expect(liens.map((a) => a.getAttribute('href'))).toEqual(['https://example.com']);
    });

    it('un [[lien]] ouvre la note quand on sait le faire, sinon reste du texte', () => {
        const ouvrirNote = vi.fn();
        const el = rendu('Voir [[cours/poly|le poly]].', { ouvrirNote });
        el.querySelector('a')!.click();
        expect(ouvrirNote).toHaveBeenCalledWith('cours/poly');
        expect(rendu('Voir [[cours/poly]].').querySelector('a')).toBeNull();
    });

    it('en direct, un rendu par image, et le dernier texte gagne', async () => {
        const el = document.createElement('div');
        const afficher = rendreEnDirect(el);
        afficher('**un');
        afficher('**un deux**');
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        expect(el.querySelector('strong')?.textContent).toBe('un deux');
        afficher('perdu');
        afficher.annuler();
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        expect(el.textContent?.trim()).toBe('un deux');
    });
});
