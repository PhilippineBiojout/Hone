import { setIcon, type TextSurface, type WidgetHandle } from 'fragment';
import { OUTILS } from './ActionAgent';
import type { Stroke } from './annotation';
import type { Cadre } from './fenetre';
import type { Repere } from './repere';
import type { ContexteQuestion, Outil, ReponseOutil } from './repondre';

// ═══════════════════════════════════════════════════════════════════════════
//  L'historique de l'agent, dans la marge. Une carte d'outil ou une
//  conversation qu'on ferme laisse une petite icône dans la marge gauche, à la
//  hauteur du passage : l'icône de l'outil (Traduire, Définir…), la tête de
//  chat, ou le micro d'une discussion orale. Un clic dessus rouvre ce que l'agent avait répondu.
//
//  ★ POURQUOI la marge GAUCHE : la droite est celle de la barre d'annotation,
//    rangée là par défaut, et la colonne de texte y finit bien après la fin
//    des lignes (les icônes flottaient à 300 px du passage). À gauche, la marge
//    est libre et l'icône se tient au début de la ligne visée.
//
//  ★ COMMENT : chaque icône est un widget du cœur avec une ancre de MARGE
//    (`mode: 'gutter'`, api-ancrage-widgets.md §6bis). Le cœur la recale sur
//    le texte à l'édition, la masque quand son passage est replié ou que la
//    marge est trop étroite. Une ancre de marge impose la largeur de la bande :
//    le widget est une rangée de toute la bande, transparente aux clics, et
//    l'icône s'y range côté texte.
//
//  ★ SOUS 60 PX DE MARGE, le cœur masque tout widget de marge : c'est sa règle
//    pour un panneau, pas pour une icône de 24 px. Dans une fenêtre étroite,
//    l'icône passe alors sur une ancre DOCUMENT, collée à gauche de la colonne,
//    là où la bande se termine : elle suit le texte de la même façon.
//
//  Ce fichier ne sait ni ouvrir une carte ni ouvrir le chat : il range les
//  traces, les dessine et prévient le calque (agentLayer) qu'on en a cliqué une.
//
//  ⚠️ En MÉMOIRE, comme les traits d'annotation (AnnotationSource) : l'historique
//     vit tant que la vue vit. Le brancher sur Plugin.saveData se fera ici.
// ═══════════════════════════════════════════════════════════════════════════

/** Une réponse d'outil, ou une conversation. */
export type Contenu =
    /** Tout ce que la carte montrait (texte, globe, dessin, arrêt de l'indice) : la rouvrir ne rappelle pas l'agent. */
    | ({ type: 'outil'; outil: Outil } & ReponseOutil)
    /**
     * `outil` : la conversation continue la réponse de cet outil (la tête de
     * chat de sa carte). Son premier message est cette réponse, et la marge
     * garde l'icône de l'outil.
     */
    | { type: 'chat'; messages: Message[]; outil?: Outil }
    /** Une discussion orale : ses tours transcrits, et le bilan écrit à sa fermeture. */
    | { type: 'oral'; messages: Message[]; bilan: string };

export interface Message {
    auteur: 'moi' | 'agent';
    texte: string;
}

export interface Trace {
    readonly id: number;
    /** Le passage, remappé à l'édition comme la zone de l'agent. */
    zone: ContexteQuestion;
    /** Le trait qui avait posé le passage : la carte rouverte se tient à côté de lui. */
    trait: Stroke;
    /** L'écart entre le trait et le début du passage, pour recaler le trait à la réouverture. */
    decalageTrait: number;
    contenu: Contenu;
    /** Où la carte ou le chat avaient été posés, et leur taille (widget.ts). */
    cadre: Cadre | null;
}

/** Côté d'une icône, et l'écart entre deux icônes posées sur la même hauteur. */
const TAILLE = 24;
const ECART = 6;

let prochainId = 1;

export class CarnetTraces {

    private readonly traces: Trace[] = [];
    private readonly icones = new Map<number, { el: HTMLButtonElement; rangee: HTMLElement; handle: WidgetHandle }>();
    /**
     * La trace dont la carte ou le chat est ouvert : son icône s'efface le temps
     * de la lecture, mais garde sa place, pour que ses voisines ne glissent pas.
     */
    private ouverte: number | null = null;

    private readonly editor: TextSurface;
    private readonly repere: Repere;
    private readonly chemin: () => string;
    private readonly onOuvrir: (trace: Trace, depuis: HTMLElement) => void;

    constructor(
        editor: TextSurface,
        repere: Repere,
        chemin: () => string,
        onOuvrir: (trace: Trace, depuis: HTMLElement) => void,
    ) {
        this.editor = editor;
        this.repere = repere;
        this.chemin = chemin;
        this.onOuvrir = onOuvrir;
    }

    /**
     * Ce qu'on vient de fermer. Si c'est une trace rouverte, elle reprend sa
     * place (avec la conversation, peut-être allongée) ; sinon, une trace neuve.
     */
    fermer(zone: ContexteQuestion, trait: Stroke, contenu: Contenu, cadre: Cadre | null): void {
        const rouverte = this.traces.find((t) => t.id === this.ouverte);
        this.ouverte = null;
        if (rouverte) {
            rouverte.contenu = contenu;
            rouverte.cadre = cadre;
            this.placer();
            return;
        }
        this.traces.push({ id: prochainId++, zone, trait, decalageTrait: trait.pos - zone.from, contenu, cadre });
        this.placer();
    }

    /** Une carte ou un chat rouvert depuis une icône a été fermé sans rien à garder. */
    oublierOuverte(): void {
        this.ouverte = null;
        this.placer();
    }

    /**
     * Supprime la trace dont la réponse est ouverte (la poubelle de la carte ou
     * du chat) et la rend, pour que le calque efface son trait. null s'il n'y
     * en a pas.
     */
    supprimerOuverte(): Trace | null {
        const i = this.traces.findIndex((t) => t.id === this.ouverte);
        this.ouverte = null;
        if (i < 0) return null;
        const [trace] = this.traces.splice(i, 1);
        this.retirer(trace.id);
        this.placer();
        return trace;
    }

    /**
     * Les réponses de `outil` déjà données sur un passage qui chevauche
     * [from, to], dans l'ordre : Aider s'en sert pour l'indice suivant.
     */
    reponsesSur(outil: Outil, from: number, to: number): ReponseOutil[] {
        return this.traces
            .filter((t) => t.contenu.type === 'outil' && t.contenu.outil === outil
                && t.zone.from < to && from < t.zone.to)
            .map((t) => t.contenu as ReponseOutil);
    }

    /** Une réponse est ouverte depuis la marge : c'est déjà une annotation. */
    aUneOuverte(): boolean {
        return this.ouverte !== null;
    }

    /** Le trait de la trace, recalé sur son passage (le texte a pu bouger). */
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
                continue;
            }
            t.zone = { ...t.zone, from, to, texte: texteEntre(this.editor, from, to) };
        }
    }

    /** Pose les icônes du document affiché, et retire les autres. */
    placer(): void {
        const chemin = this.chemin();
        const visibles = this.traces.filter((t) => t.zone.chemin === chemin);
        for (const id of [...this.icones.keys()]) {
            if (!visibles.some((t) => t.id === id)) this.retirer(id);
        }

        // Deux traces à la même hauteur se posent côte à côte, la plus récente
        // plus loin du texte.
        const colonnes: number[][] = [];
        const places = visibles
            .map((t) => ({ t, ligne: this.editor.coordsForRange(t.zone.from, t.zone.from + 1)[0] ?? null }))
            .sort((a, b) => (a.ligne?.top ?? 0) - (b.ligne?.top ?? 0));
        for (const { t, ligne } of places) {
            const { el, rangee, handle } = this.icone(t);
            el.classList.toggle('is-ouverte', t.id === this.ouverte);
            // Hors du viewport rendu : le cœur garde la dernière position.
            if (!ligne) continue;
            const top = (ligne.top + ligne.bottom) / 2 - TAILLE / 2;
            let col = 0;
            while ((colonnes[col] ?? []).some((y) => Math.abs(y - top) < TAILLE + 2)) col++;
            (colonnes[col] ??= []).push(top);
            // Centrée sur la ligne : l'ancre part du haut du glyphe.
            const dy = top - ligne.top;
            if (this.repere.widgets.gutterFits('left')) {
                rangee.style.visibility = '';
                el.style.marginRight = `${col * (TAILLE + ECART)}px`;
                handle.setAnchor({ mode: 'gutter', side: 'left', pos: t.zone.from, dy });
                continue;
            }
            // Marge étroite : juste à gauche du texte, sans sortir du pane (la
            // bande du cœur peut y avoir une largeur négative). Plus de place
            // pour cette colonne : masquée, comme le ferait le cœur.
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

    private icone(t: Trace): { el: HTMLButtonElement; rangee: HTMLElement; handle: WidgetHandle } {
        const deja = this.icones.get(t.id);
        if (deja) return deja;
        const el = document.createElement('button');
        el.type = 'button';
        el.classList.add('agent-trace');
        // Une trace outil devenue conversation garde son icône : l'élément est
        // en cache, et c'est le même outil.
        const outil = t.contenu.type === 'oral' ? undefined : t.contenu.outil;
        const { libelle, icone } = t.contenu.type === 'oral'
            ? { libelle: 'Discussion orale', icone: 'mic' }
            : outil ? OUTILS[outil] : { libelle: 'Conversation', icone: 'cat' };
        const extrait = t.zone.texte.replace(/\s+/g, ' ').trim();
        el.setAttribute('aria-label', `${libelle} : ${extrait}`);
        el.title = `${libelle} : « ${extrait.length > 60 ? `${extrait.slice(0, 60)}…` : extrait} »`;
        setIcon(el, icone);
        el.addEventListener('click', () => {
            // D'abord onOuvrir : il referme ce qui était ouvert, qui range sa
            // propre trace (fermer()) en lisant `ouverte`. Ce n'est qu'ensuite
            // que cette trace-ci devient l'ouverte.
            this.onOuvrir(t, el);
            this.ouverte = t.id;
            // Effacée APRÈS : la carte sort de l'icône, qui doit encore être là.
            requestAnimationFrame(() => this.placer());
        });
        const rangee = document.createElement('div');
        rangee.classList.add('agent-trace-rangee');
        rangee.appendChild(el);
        const handle = this.repere.widgets.addWidget(rangee, { mode: 'gutter', side: 'left', pos: t.zone.from, dy: 0 });
        // La rangée couvre toute la bande : seule l'icône capte les clics.
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
