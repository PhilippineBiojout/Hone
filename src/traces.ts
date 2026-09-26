import { setIcon, type TextSurface, type WidgetHandle } from 'fragment';
import type { Stroke } from './annotation';
import type { Cadre } from './fenetre';
import type { Message } from './protocole';
import type { Repere } from './repere';
import type { ContexteQuestion, Outil, ReponseOutil } from './repondre';
import { OUTILS } from './ui';

/** Une réponse d'outil, une conversation (née d'un outil ou non), ou une discussion orale et son bilan. */
export type Contenu =
    | ({ type: 'outil'; outil: Outil } & ReponseOutil)
    | { type: 'chat'; messages: Message[]; outil?: Outil }
    | { type: 'oral'; messages: Message[]; bilan: string };

export interface Trace {
    readonly id: number;
    /** Remappé à l'édition, comme la zone de l'agent. */
    zone: ContexteQuestion;
    trait: Stroke;
    /** L'écart entre le trait et le début du passage, pour recaler le trait à la réouverture. */
    decalageTrait: number;
    contenu: Contenu;
    cadre: Cadre | null;
}

interface Icone {
    el: HTMLButtonElement;
    rangee: HTMLElement;
    handle: WidgetHandle;
}

const TAILLE = 24;
const ECART = 6;
let prochainId = 1;

/**
 * L'historique de l'agent : une icône par réponse fermée, dans la marge gauche
 * (ancre de marge du cœur), qui la rouvre au clic. En mémoire seulement.
 */
export class CarnetTraces {

    private readonly traces: Trace[] = [];
    private readonly icones = new Map<number, Icone>();
    /** La trace rouverte : son icône s'efface mais garde sa place. */
    private ouverte: number | null = null;

    constructor(
        private readonly editor: TextSurface,
        private readonly repere: Repere,
        private readonly chemin: () => string,
        private readonly onOuvrir: (trace: Trace, depuis: HTMLElement) => void,
    ) {}

    /** Une trace rouverte reprend sa place avec son nouveau contenu ; sinon, une trace neuve. */
    fermer(zone: ContexteQuestion, trait: Stroke, contenu: Contenu, cadre: Cadre | null): void {
        const rouverte = this.traces.find((t) => t.id === this.ouverte);
        this.ouverte = null;
        if (rouverte) Object.assign(rouverte, { contenu, cadre });
        else this.traces.push({ id: prochainId++, zone, trait, decalageTrait: trait.pos - zone.from, contenu, cadre });
        this.placer();
    }

    oublierOuverte(): void {
        this.ouverte = null;
        this.placer();
    }

    /** Supprime la trace rouverte et la rend, pour que le calque efface son trait. */
    supprimerOuverte(): Trace | null {
        const i = this.traces.findIndex((t) => t.id === this.ouverte);
        this.ouverte = null;
        if (i < 0) return null;
        const [trace] = this.traces.splice(i, 1);
        this.retirer(trace.id);
        this.placer();
        return trace;
    }

    /** Les réponses de `outil` déjà données sur un passage qui chevauche [from, to]. */
    reponsesSur(outil: Outil, from: number, to: number): ReponseOutil[] {
        return this.traces
            .filter((t) => t.contenu.type === 'outil' && t.contenu.outil === outil && t.zone.from < to && from < t.zone.to)
            .map((t) => t.contenu as ReponseOutil);
    }

    aUneOuverte(): boolean {
        return this.ouverte !== null;
    }

    /** Le trait recalé sur son passage (le texte a pu bouger). */
    traitDe(trace: Trace): Stroke {
        return { ...trace.trait, pos: trace.zone.from + trace.decalageTrait };
    }

    /** Le passage suit le texte, et disparaît avec lui. */
    remapper(mapPos: (pos: number, assoc: 1 | -1) => { pos: number }): void {
        const chemin = this.chemin();
        for (let i = this.traces.length - 1; i >= 0; i--) {
            const t = this.traces[i];
            if (t.zone.chemin !== chemin) continue;
            const from = mapPos(t.zone.from, 1).pos;
            const to = mapPos(t.zone.to, -1).pos;
            if (to <= from) {
                this.retirer(t.id);
                this.traces.splice(i, 1);
            } else t.zone = { ...t.zone, from, to, texte: texteEntre(this.editor, from, to) };
        }
    }

    /** Pose les icônes du document affiché, et retire les autres. */
    placer(): void {
        const chemin = this.chemin();
        const visibles = this.traces.filter((t) => t.zone.chemin === chemin);
        for (const id of [...this.icones.keys()]) {
            if (!visibles.some((t) => t.id === id)) this.retirer(id);
        }
        // Deux traces à la même hauteur se posent côte à côte, la plus récente plus loin du texte.
        const colonnes: number[][] = [];
        const places = visibles
            .map((t) => ({ t, ligne: this.editor.coordsForRange(t.zone.from, t.zone.from + 1)[0] ?? null }))
            .sort((a, b) => (a.ligne?.top ?? 0) - (b.ligne?.top ?? 0));
        for (const { t, ligne } of places) {
            const { el, rangee, handle } = this.icone(t);
            el.classList.toggle('is-ouverte', t.id === this.ouverte);
            if (!ligne) continue;
            const top = (ligne.top + ligne.bottom) / 2 - TAILLE / 2;
            let col = 0;
            while ((colonnes[col] ?? []).some((y) => Math.abs(y - top) < TAILLE + 2)) col++;
            (colonnes[col] ??= []).push(top);
            const dy = top - ligne.top;
            if (this.repere.widgets.gutterFits('left')) {
                rangee.style.visibility = '';
                el.style.marginRight = `${col * (TAILLE + ECART)}px`;
                handle.setAnchor({ mode: 'gutter', side: 'left', pos: t.zone.from, dy });
                continue;
            }
            // Sous 60 px de marge le cœur masquerait l'icône : ancre document, juste à gauche du texte.
            const texte = this.repere.versDocument(this.editor.contentEl.getBoundingClientRect());
            const pane = this.repere.versDocument(this.repere.paneClient());
            if (!texte || !pane) continue;
            el.style.marginRight = '';
            const x = texte.left - ECART - TAILLE - col * (TAILLE + ECART);
            rangee.style.visibility = x < pane.left + 2 ? 'hidden' : '';
            handle.setAnchor({ mode: 'document', pos: t.zone.from, dx: x - ligne.left, dy });
        }
    }

    detruire(): void {
        for (const id of [...this.icones.keys()]) this.retirer(id);
    }

    private icone(t: Trace): Icone {
        const deja = this.icones.get(t.id);
        if (deja) return deja;
        const el = document.createElement('button');
        el.type = 'button';
        el.classList.add('agent-trace');
        const outil = t.contenu.type === 'oral' ? undefined : t.contenu.outil;
        const { libelle, icone } = t.contenu.type === 'oral'
            ? { libelle: 'Discussion orale', icone: 'mic' }
            : outil ? OUTILS[outil] : { libelle: 'Conversation', icone: 'cat' };
        const extrait = t.zone.texte.replace(/\s+/g, ' ').trim();
        el.setAttribute('aria-label', `${libelle} : ${extrait}`);
        el.title = `${libelle} : « ${extrait.length > 60 ? `${extrait.slice(0, 60)}…` : extrait} »`;
        setIcon(el, icone);
        el.addEventListener('click', () => {
            // onOuvrir d'abord : il ferme ce qui était ouvert, qui range sa trace en lisant `ouverte`.
            this.onOuvrir(t, el);
            this.ouverte = t.id;
            // Effacée après : la carte sort de l'icône.
            requestAnimationFrame(() => this.placer());
        });
        const rangee = document.createElement('div');
        rangee.classList.add('agent-trace-rangee');
        rangee.appendChild(el);
        const handle = this.repere.widgets.addWidget(rangee, { mode: 'gutter', side: 'left', pos: t.zone.from, dy: 0 });
        rangee.style.pointerEvents = 'none';
        const posee = { el, rangee, handle };
        this.icones.set(t.id, posee);
        return posee;
    }

    private retirer(id: number): void {
        const icone = this.icones.get(id);
        icone?.handle.remove();
        icone?.rangee.remove();
        this.icones.delete(id);
    }
}

/** Le texte d'une plage, reconstruit ligne à ligne : la façade n'a pas de getRange. */
export function texteEntre(editor: TextSurface, from: number, to: number): string {
    const debut = editor.offsetToPos(from);
    const fin = editor.offsetToPos(to);
    if (debut.line === fin.line) return editor.getLine(debut.line).slice(debut.ch, fin.ch);
    const lignes = [editor.getLine(debut.line).slice(debut.ch)];
    for (let n = debut.line + 1; n < fin.line; n++) lignes.push(editor.getLine(n));
    lignes.push(editor.getLine(fin.line).slice(0, fin.ch));
    return lignes.join('\n');
}
