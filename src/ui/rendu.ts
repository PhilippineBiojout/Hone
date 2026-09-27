import katex from 'katex';
import { Marked, type Tokens } from 'marked';
import { nettoyerSvg } from './nettoyerSvg';

// Le texte des agents tel qu'on le lit dans ChatGPT ou Claude, pas tel que le modèle l'écrit :
// Markdown mis en forme, formules dessinées, dessin SVG affiché. Fragment n'expose pas de
// moteur de rendu aux plugins : Hone embarque marked (Markdown) et KaTeX (formules).
//
// Le texte vient du modèle et la page a Node : rien de son HTML n'est interprété. Le HTML
// brut est échappé, un lien n'est suivi que vers le web (dans le navigateur) ou une note
// du vault, et un SVG passe par la liste blanche de Visualiser (nettoyerSvg.ts).
// Les formules sortent en MathML : Chromium les dessine sans police ni feuille à livrer.

/** Ce que le rendu sait faire de plus quand on le lui donne : ouvrir une note du vault. */
export interface OptionsRendu {
    ouvrirNote?: (chemin: string) => void;
}

const echapper = (texte: string) => texte
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Une formule en MathML ; illisible, elle reste écrite telle quelle. */
function formule(tex: string, bloc: boolean, brut: string): string {
    try {
        return katex.renderToString(tex.trim(), { output: 'mathml', displayMode: bloc, throwOnError: true, strict: 'ignore' });
    } catch {
        return `<code>${echapper(brut)}</code>`;
    }
}

/** Les quatre façons d'écrire une formule ; `$…$` exige un bord collé au texte (pas « 5 $ et 6 $ »). */
const FORMULES: { motif: RegExp; bloc: boolean }[] = [
    { motif: /^\$\$([\s\S]+?)\$\$/, bloc: true },
    { motif: /^\\\[([\s\S]+?)\\\]/, bloc: true },
    { motif: /^\\\(([\s\S]+?)\\\)/, bloc: false },
    { motif: /^\$(?![\s$])((?:\\.|[^\\$\n])+?)(?<!\s)\$(?!\d)/, bloc: false },
];

const marked = new Marked({ gfm: true, breaks: true });
marked.use({
    extensions: [
        {
            name: 'formule',
            level: 'inline',
            start: (src: string) => {
                const i = src.search(/\$|\\\(|\\\[/);
                return i < 0 ? undefined : i;
            },
            tokenizer(src: string) {
                for (const { motif, bloc } of FORMULES) {
                    const m = motif.exec(src);
                    if (m) return { type: 'formule', raw: m[0], tex: m[1], bloc };
                }
                return undefined;
            },
            renderer: (t) => formule(String(t.tex), t.bloc === true, String(t.raw)),
        },
        {
            name: 'lienNote',
            level: 'inline',
            start: (src: string) => {
                const i = src.indexOf('[[');
                return i < 0 ? undefined : i;
            },
            tokenizer(src: string) {
                const m = /^\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/.exec(src);
                return m ? { type: 'lienNote', raw: m[0], cible: m[1].trim(), texte: (m[2] ?? m[1]).trim() } : undefined;
            },
            renderer: (t) => `<a class="hone-lien-note" data-note="${echapper(String(t.cible))}">${echapper(String(t.texte))}</a>`,
        },
    ],
    renderer: {
        // Le HTML du modèle se lit, il ne s'exécute pas.
        html: ({ text }: Tokens.HTML | Tokens.Tag) => echapper(text),
        link({ href, tokens }: Tokens.Link) {
            const texte = this.parser.parseInline(tokens);
            return /^https?:\/\//i.test(href) ? `<a href="${echapper(href)}" class="hone-lien-web">${texte}</a>` : texte;
        },
        // Pas d'image venue du modèle : son texte seulement.
        image: ({ text }: Tokens.Image) => echapper(text),
        code({ text, lang }: Tokens.Code) {
            if ((lang ?? '').trim().toLowerCase() === 'svg' || (!lang && /^\s*<svg\b/i.test(text))) {
                return `<div class="hone-svg">${echapper(text)}</div>`;
            }
            return `<pre><code>${echapper(text)}</code></pre>`;
        },
    },
});

/** Un `<svg>` écrit à nu dans la réponse devient un bloc ```svg (hors des blocs de code déjà là),
 *  même inachevé : pendant le direct, il ne s'affiche pas en code. */
function svgEnBloc(texte: string): string {
    return texte.split(/(```[\s\S]*?(?:```|$))/).map((bout, i) => (i % 2 === 1
        ? bout
        : bout.replace(/<svg\b[\s\S]*?(?:<\/svg>|$)/gi, (svg) => `\n\n\`\`\`svg\n${svg}\n\`\`\`\n\n`))).join('');
}

/** Ce que le HTML rendu garde, en dernière défense : ni script, ni style, ni gestionnaire. */
function assainir(racine: HTMLElement): void {
    for (const el of Array.from(racine.querySelectorAll('script, style, iframe, object, embed, img, link, meta, form, input'))) el.remove();
    for (const el of Array.from(racine.querySelectorAll('*'))) {
        for (const attr of Array.from(el.attributes)) {
            if (/^on/i.test(attr.name) || attr.name === 'style' || attr.name === 'srcdoc'
                || ((attr.name === 'href' || attr.name === 'src') && !/^https?:\/\//i.test(attr.value))) el.removeAttribute(attr.name);
        }
    }
}

function ouvrirDansLeNavigateur(url: string): void {
    try {
        const electron = (window as unknown as { require?: (m: string) => unknown }).require?.('electron') as
            { shell?: { openExternal?(u: string): void } } | undefined;
        electron?.shell?.openExternal?.(url);
    } catch {
        // Hors d'Electron (tests) : rien.
    }
}

/** Remplace le contenu de `el` par `texte` mis en forme. */
export function rendreMarkdown(el: HTMLElement, texte: string, o: OptionsRendu = {}): void {
    el.classList.add('hone-rendu');
    el.innerHTML = marked.parse(svgEnBloc(texte), { async: false });
    assainir(el);

    // Les dessins : la liste blanche de Visualiser, sinon le code (ou « en cours » s'il n'est pas fini).
    for (const bloc of Array.from(el.querySelectorAll<HTMLElement>('.hone-svg'))) {
        const source = bloc.textContent ?? '';
        const svg = nettoyerSvg(source);
        if (svg) {
            svg.setAttribute('aria-label', 'Dessin');
            bloc.replaceChildren(svg);
        } else if (!/<\/svg>\s*$/i.test(source.trim())) {
            bloc.replaceChildren(document.createTextNode('Dessin en cours…'));
            bloc.classList.add('is-attente');
        } else {
            const pre = document.createElement('pre');
            pre.appendChild(document.createElement('code')).textContent = source;
            bloc.replaceWith(pre);
        }
    }

    for (const lien of Array.from(el.querySelectorAll<HTMLAnchorElement>('a.hone-lien-web'))) {
        lien.addEventListener('click', (e) => {
            e.preventDefault();
            ouvrirDansLeNavigateur(lien.href);
        });
    }
    for (const lien of Array.from(el.querySelectorAll<HTMLAnchorElement>('a.hone-lien-note'))) {
        const chemin = lien.dataset.note ?? '';
        if (!o.ouvrirNote || !chemin) {
            lien.replaceWith(document.createTextNode(lien.textContent ?? ''));
            continue;
        }
        lien.href = '#';
        lien.addEventListener('click', (e) => {
            e.preventDefault();
            o.ouvrirNote?.(chemin);
        });
    }
}

/** Pour un texte qui arrive en direct : un rendu par image au plus, le dernier texte gagne.
 *  `annuler` jette le rendu en attente (une erreur remplace la réponse). */
export function rendreEnDirect(
    el: HTMLElement, o: OptionsRendu = {}, apres?: () => void,
): ((texte: string) => void) & { annuler(): void } {
    let attente: string | null = null;
    let image = 0;
    const afficher = (texte: string) => {
        const deja = attente !== null;
        attente = texte;
        if (deja) return;
        image = requestAnimationFrame(() => {
            if (attente === null) return;
            rendreMarkdown(el, attente, o);
            attente = null;
            apres?.();
        });
    };
    return Object.assign(afficher, {
        annuler: () => {
            cancelAnimationFrame(image);
            attente = null;
        },
    });
}
