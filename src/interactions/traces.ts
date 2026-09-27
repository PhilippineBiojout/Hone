import { setIcon, type Rect, type TextSurface, type WidgetHandle } from 'fragment';
import type { Stroke } from './annotation';
import type { Cadre } from '../positionnement/fenetre';
import type { Repere } from '../positionnement/repere';
import type { ContexteQuestion, Outil, ReponseOutil } from '../pont/repondre';
import type { Contenu, RegistreTraces, Trace } from './registreTraces';
import { etiquetteDeReponse } from '../ui/texteLisible';
import { OUTILS } from '../ui/ui';

export type { Contenu, Trace } from './registreTraces';

interface Icone {
    el: HTMLButtonElement;
    rangee: HTMLElement;
    handle: WidgetHandle;
}

const TAILLE = 24;
const ECART = 6;

/**
 * L'historique de l'agent : une icône par réponse fermée, dans la marge gauche
 * (ancre de marge du cœur), qui la rouvre au clic. Les traces vivent dans le registre du
 * plugin ; le carnet, propre à la vue, n'en tient que les icônes.
 */
export class CarnetTraces {

    private readonly icones = new Map<number, Icone>();
    /** La trace rouverte : son icône s'efface mais garde sa place. */
    private ouverte: number | null = null;

    constructor(
        private readonly editor: TextSurface,
        private readonly repere: Repere,
        private readonly chemin: () => string,
        private readonly onOuvrir: (trace: Trace, depuis: HTMLElement) => void,
        private readonly registre: RegistreTraces,
    ) {
        this.detacher = registre.attacher(chemin());
        this.desabonner = registre.onChange((c) => {
            if (c === this.chemin()) this.placer();
        });
    }

    private detacher: () => void;
    private readonly desabonner: () => void;

    /** Le document de la vue a changé (le cœur remonte d'ordinaire le calque, mais pas toujours). */
    changerDeDocument(): void {
        this.detacher();
        this.detacher = this.registre.attacher(this.chemin());
        this.placer();
    }

    /** Une trace rouverte reprend sa place avec son nouveau contenu ; sinon, une trace neuve. */
    fermer(zone: ContexteQuestion, trait: Stroke, contenu: Contenu, cadre: Cadre | null, sujet?: string | null): void {
        const rouverte = this.ouverte;
        this.ouverte = null;
        if (rouverte !== null && this.registre.trouver(rouverte)) this.registre.mettreAJour(rouverte, contenu, cadre, sujet);
        else this.registre.ajouter(zone, trait, contenu, cadre, sujet);
        this.placer();
    }

    oublierOuverte(): void {
        this.ouverte = null;
        this.placer();
    }

    /** Supprime la trace rouverte et la rend, pour que le calque efface son trait. */
    supprimerOuverte(): Trace | null {
        const id = this.ouverte;
        this.ouverte = null;
        const trace = id === null ? null : this.registre.supprimer(id);
        if (trace) this.retirer(trace.id);
        this.placer();
        return trace;
    }

    /** Les réponses de `outil` déjà données sur un passage qui chevauche [from, to]. */
    reponsesSur(outil: Outil, from: number, to: number): ReponseOutil[] {
        return this.registre.pour(this.chemin())
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
        // Le même document dans deux onglets : chaque éditeur voit la modification, un seul la reporte.
        if (!this.registre.doitRemapper(chemin, this.editor.contentEl.contains(document.activeElement))) return;
        const retires = this.registre.remapper(chemin, mapPos, (from, to) => texteEntre(this.editor, from, to));
        for (const id of retires) this.retirer(id);
    }

    /** Pose les icônes du document affiché, et retire les autres. */
    placer(): void {
        // Poser un widget change la géométrie, qui rappelle placer() avant que l'icône soit rangée :
        // sans cette garde, un carnet qui démarre avec des traces posait chaque icône deux fois.
        // Un rappel en retard (ResizeObserver, changement d'éditeur) peut arriver après le démontage.
        if (this.detruit) return;
        if (this.enPlacement) {
            this.aReplacer = true;
            return;
        }
        this.enPlacement = true;
        try {
            do {
                this.aReplacer = false;
                this.poser();
            } while (this.aReplacer);
        } finally {
            this.enPlacement = false;
        }
    }

    private detruit = false;
    /** Le document déjà recalé par cette vue : une fois, texte chargé. */
    private recale: string | null = null;
    private enPlacement = false;
    private aReplacer = false;

    private poser(): void {
        const chemin = this.chemin();
        // La vue naît avant que le cœur y charge le texte : sur un document encore vide, une ancre
        // hors du texte ferait échouer addWidget après qu'il a inséré l'icône, et le recalage
        // ramènerait tous les passages au début.
        const longueur = longueurDe(this.editor);
        if (longueur > 0 && this.recale !== chemin) {
            this.recale = chemin;
            this.registre.recaler(chemin, this.editor);
        }
        const visibles = this.registre.pour(chemin).filter((t) => t.zone.to <= longueur);
        for (const id of [...this.icones.keys()]) {
            if (!visibles.some((t) => t.id === id)) this.retirer(id);
        }
        // Deux traces à la même hauteur se posent côte à côte, la plus récente plus loin du texte.
        const colonnes: number[][] = [];
        const places = visibles
            .map((t) => ({ t, ...this.hauteurDe(t) }))
            .sort((a, b) => (a.ligne?.top ?? 0) - (b.ligne?.top ?? 0));
        for (const { t, ligne, ancre } of places) {
            const { el, rangee, handle } = this.icone(t);
            el.classList.toggle('is-ouverte', t.id === this.ouverte);
            // Le sujet peut arriver après l'icône : son infobulle se relit à chaque placement.
            const etiquette = etiquetteDe(t);
            if (el.title !== etiquette) {
                el.title = etiquette;
                el.setAttribute('aria-label', etiquette);
            }
            if (!ligne || !ancre) continue;
            const top = (ligne.top + ligne.bottom) / 2 - TAILLE / 2;
            let col = 0;
            while ((colonnes[col] ?? []).some((y) => Math.abs(y - top) < TAILLE + 2)) col++;
            (colonnes[col] ??= []).push(top);
            const dy = top - ancre.top;
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
            handle.setAnchor({ mode: 'document', pos: t.zone.from, dx: x - ancre.left, dy });
        }
    }

    /**
     * La hauteur où poser l'icône (`ligne`) et le rectangle de `zone.from` dont l'ancre se décale (`ancre`).
     * Une zone sans texte (écriture à la main, PDF scanné) a pour passage l'ancre de sa page, la même
     * pour tous les traits de la page : toutes les icônes se posaient en haut à gauche, l'une sur
     * l'autre. Elle se pose à la hauteur du haut de son trait.
     */
    private hauteurDe(t: Trace): { ligne: Rect | null; ancre: Rect | null } {
        if (t.zone.from < t.zone.to) {
            const ligne = this.editor.coordsForRange(t.zone.from, t.zone.from + 1)[0] ?? null;
            return { ligne, ancre: ligne };
        }
        const ancre = this.editor.coordsAtPos(t.zone.from);
        const trait = this.traitDe(t);
        const glyphe = this.editor.coordsAtPos(trait.pos);
        if (!ancre || !glyphe || trait.points.length === 0) return { ligne: null, ancre: null };
        const haut = glyphe.top + Math.min(...trait.points.map((p) => p.dy));
        return { ligne: { left: ancre.left, right: ancre.left, top: haut, bottom: haut + TAILLE }, ancre };
    }

    /** Retire les icônes de la vue ; les traces restent au registre. */
    detruire(): void {
        this.detruit = true;
        this.desabonner();
        this.detacher();
        for (const id of [...this.icones.keys()]) this.retirer(id);
    }

    private icone(t: Trace): Icone {
        const deja = this.icones.get(t.id);
        if (deja) return deja;
        const el = document.createElement('button');
        el.type = 'button';
        el.classList.add('agent-trace');
        const outil = t.contenu.type === 'oral' ? undefined : t.contenu.outil;
        const icone = t.contenu.type === 'oral' ? 'mic' : outil ? OUTILS[outil].icone : 'cat';
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

/** L'infobulle d'une icône : le titre de la réponse, ou son outil et le passage lisible. */
export function etiquetteDe(t: Trace): string {
    const outil = t.contenu.type === 'oral' ? undefined : t.contenu.outil;
    const libelle = t.contenu.type === 'oral' ? 'Discussion orale' : outil ? OUTILS[outil].libelle : 'Conversation';
    return etiquetteDeReponse(libelle, t.contenu.type === 'chat', t.sujet ?? null, t.zone.texte);
}

/** La longueur du document, en offsets. */
function longueurDe(editor: TextSurface): number {
    const derniere = editor.lineCount() - 1;
    if (derniere < 0) return 0;
    return editor.posToOffset({ line: derniere, ch: editor.getLine(derniere).length });
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
