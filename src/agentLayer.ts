import type { TextSurface, FileView, ItemView, LayerContext, Marker, Rect } from 'fragment';
import { ActionAgent } from './ActionAgent';
import { brancherAnnotation, type Stroke } from './annotation';
import { BarreAgent } from './BarreAgent';
import { BulleAgent } from './BulleAgent';
import { brancherDeclencheurs, SELECTION } from './declencheur';
import { hasText } from './pont';
import { Repere } from './repere';
import type { ContexteQuestion } from './repondre';
import { CarnetTraces, texteEntre, type Trace } from './traces';
import { VoixAgent } from './VoixAgent';

// ═══════════════════════════════════════════════════════════════════════════
//  Le montage de l'agent sur UNE vue. On surligne ou on entoure un passage
//  avec le calque d'annotation, ou on le sélectionne à la souris : une barre
//  verticale apparaît à côté. La tête de chat de la barre ouvre la
//  conversation ; un outil la remplace par son rond, puis par la carte de sa
//  réponse ; le micro, par la pilule de la discussion orale.
//
//  Tout est composé de briques du cœur : la barre est une Toolbar, et tout ce
//  qui est posé sur la page est un widget du WidgetLayer de la vue (Repere),
//  ancré au document. Ce fichier est le seul à connaître les pièces : la barre
//  ignore la bulle, la bulle ignore la barre, et l'annotation ignore tout de
//  l'agent (annotation.ts).
// ═══════════════════════════════════════════════════════════════════════════

export function createAgentLayer(ctx: LayerContext): () => void {
    const surface = ctx.editor;
    // Pas de texte adressable (PDF scanné, image) : rien à citer.
    if (!surface || !hasText(surface)) return () => {};
    const editor: TextSurface = surface;

    const paneEl = (ctx.view as ItemView).contentEl;
    const chemin = (): string => (ctx.view as FileView).file?.path ?? '';

    /** Le passage visé : posé par un trait, remappé à l'édition, effacé à la croix. */
    let zone: ContexteQuestion | null = null;
    /** Le trait qui a posé la zone : c'est à côté de LUI que tout se tient. */
    let trait: Stroke | null = null;

    const annotation = brancherAnnotation(ctx.app, paneEl, chemin);
    const repere = new Repere(editor, ctx.overlays, paneEl, () => trait, () => annotation.barre());

    // ── Les pièces ─────────────────────────────────────────────────────────

    const barre = new BarreAgent(repere, {
        onChat: () => {
            if (zone) bulle.ouvrir(zone);
            majOccupe();
        },
        // La croix de la barre ferme tout : le chat, posé à côté de la barre,
        // n'aurait plus rien à côté de quoi se tenir.
        onFermer: () => {
            zone = null;
            bulle.fermer();
            editor.requestUpdate();
        },
        // Un outil : le chat se ferme, la barre fond dans le rond de l'outil.
        onOutil: (outil) => {
            if (!zone) return;
            const depuis = barre.dom.getBoundingClientRect();
            bulle.fermer();
            barre.cacher();
            // Aider : les indices déjà donnés sur ce passage, pour le suivant.
            const precedents = outil === 'aider' ? carnet.reponsesSur(outil, zone.from, zone.to) : [];
            action.lancer(outil, zone, depuis, precedents);
            majOccupe();
        },
        // Le micro : pareil, la barre fond dans le rond du micro.
        onVoix: () => {
            if (!zone) return;
            const depuis = barre.dom.getBoundingClientRect();
            bulle.fermer();
            barre.cacher();
            voix.lancer(zone, depuis);
            majOccupe();
        },
    });

    // Une conversation fermée laisse sa trace dans la marge. Une discussion
    // orale relue par écrit reste orale, avec son bilan.
    const bulle = new BulleAgent(ctx.app, repere, () => barre, (messages, contexte, cadre, origine, bilan) => {
        // Le micro du chat : la discussion repart à voix haute, rien à ranger.
        if (enchainement) return;
        if (!suppression && contexte && trait && bilan !== null) {
            carnet.fermer(contexte, trait, { type: 'oral', messages, bilan }, cadre);
        }
        else if (!suppression && contexte && trait && messages.length > 0) {
            carnet.fermer(contexte, trait, { type: 'chat', messages, ...(origine ? { outil: origine } : {}) }, cadre);
        }
        else carnet.oublierOuverte();
        // Rouverte seule depuis la marge, sans barre : sa croix ferme tout.
        if (!barre.estOuverte()) {
            zone = null;
            editor.requestUpdate();
        }
        majOccupe();
    }, () => supprimer(), () => reprendreAVoix());

    // La croix de la carte ferme tout, comme celle de la barre. Une réponse
    // reçue laisse sa trace dans la marge.
    const action = new ActionAgent(ctx.app, repere, () => {
        // La carte devient un chat (discuter) : ni trace, ni passage perdu.
        if (enchainement) return;
        const resultat = action.resultat();
        if (!suppression && resultat && zone && trait) {
            carnet.fermer(zone, trait, resultat.type === 'outil'
                ? resultat
                : { type: 'oral', messages: resultat.messages, bilan: resultat.texte }, action.cadre());
        }
        else carnet.oublierOuverte();
        zone = null;
        majOccupe();
        editor.requestUpdate();
    }, () => supprimer(), () => discuter());

    // La croix de la pilule : si l'on a parlé, la pilule se résorbe dans le
    // rond du micro, qui s'ouvre sur la carte du bilan ; la croix de la carte
    // laisse le micro dans la marge. Fermée par le calque (une autre trace
    // rouverte, un autre document), la discussion est gardée sans bilan.
    //
    // Une discussion reprise au micro puis refermée sans un mot garde son
    // bilan : rien de neuf à résumer, pas d'appel au back.
    const voix = new VoixAgent(ctx.app, repere, (historique, boite, parCroix) => {
        const reprise = voixReprise;
        voixReprise = null;
        const inchangee = reprise !== null && historique.length === reprise.tours;
        if (parCroix && zone && historique.length > 0 && !inchangee) {
            action.lancerBilan(zone, historique, boite);
            majOccupe();
            return;
        }
        if (!suppression && zone && trait && historique.length > 0) {
            const bilan = inchangee ? reprise.bilan : 'Bilan non écrit : la discussion a été interrompue.';
            carnet.fermer(zone, trait, { type: 'oral', messages: historique, bilan }, null);
        }
        else carnet.oublierOuverte();
        zone = null;
        majOccupe();
        editor.requestUpdate();
    });

    // ── La carte devient un chat ───────────────────────────────────────────
    //
    // La tête de chat du pied d'une carte : la carte se ferme, et le chat sort
    // du bouton, seul (sans la barre), à la place et à la taille de la carte.
    // Son fil commence par la réponse de l'outil. À la fermeture, la marge
    // garde UNE icône, celle de l'outil, qui rouvre toute la conversation.
    let enchainement = false;
    const discuter = (): void => {
        const resultat = action.resultat();
        if (!resultat || !zone || !trait) return;
        const depuis = action.boutonDiscuter();
        const cadre = action.cadre();
        const poubelle = carnet.aUneOuverte();
        enchainement = true;
        try {
            action.fermer();
        } finally {
            enchainement = false;
        }
        // Le bilan d'une discussion orale : le chat la relit par écrit.
        if (resultat.type === 'oral') {
            bulle.rouvrir(zone, resultat.messages, depuis, cadre, { bilan: resultat.texte, poubelle });
        } else {
            bulle.rouvrir(zone, [{ auteur: 'agent', texte: resultat.texte }], depuis, cadre,
                { outil: resultat.outil, poubelle });
        }
        majOccupe();
        editor.requestUpdate();
    };

    // ── La discussion orale reprend au micro ───────────────────────────────
    let voixReprise: { tours: number; bilan: string } | null = null;
    const reprendreAVoix = (): void => {
        if (!zone) return;
        const messages = bulle.conversation();
        const depuis = bulle.boite();
        const bilan = bulle.bilanOral();
        voixReprise = bilan === null ? null : { tours: messages.length, bilan };
        enchainement = true;
        try {
            bulle.fermer();
        } finally {
            enchainement = false;
        }
        voix.lancer(zone, depuis, messages);
        majOccupe();
        editor.requestUpdate();
    };

    // ── L'historique, dans la marge (traces.ts) ────────────────────────────
    //
    // Un clic sur une icône referme ce qui est ouvert (qui laisse sa propre
    // trace), puis rouvre la réponse gardée sur son passage, sans la barre.
    const rouvrir = (t: Trace, depuis: HTMLElement): void => {
        voix.fermer();
        action.fermer();
        barre.fermer();
        bulle.fermer();
        zone = { ...t.zone };
        trait = carnet.traitDe(t);
        if (t.contenu.type === 'outil') {
            action.montrer(t.contenu.outil, t.contenu, depuis, t.cadre);
        } else if (t.contenu.type === 'oral') {
            bulle.rouvrir(zone, t.contenu.messages, depuis, t.cadre, { bilan: t.contenu.bilan, poubelle: true });
        } else {
            bulle.rouvrir(zone, t.contenu.messages, depuis, t.cadre, { outil: t.contenu.outil, poubelle: true });
        }
        majOccupe();
        editor.requestUpdate();
    };

    // La poubelle d'une réponse rouverte, confirmée : l'icône, la réponse
    // gardée et le trait d'encre disparaissent. Le trait effacé passe par la
    // pile d'annulation de l'annotation : Cmd+Z le remet, sans la réponse.
    let suppression = false;
    const supprimer = (): void => {
        const t = carnet.supprimerOuverte();
        if (!t) return;
        suppression = true;
        try {
            bulle.fermer();
            action.fermer();
            voix.fermer();
            barre.fermer();
        } finally {
            suppression = false;
        }
        zone = null;
        if (!t.trait.id.startsWith(SELECTION)) annotation.effacer(t.zone.chemin, t.trait.id);
        majOccupe();
        editor.requestUpdate();
    };

    const carnet = new CarnetTraces(editor, repere, chemin, rouvrir);
    // La marge change de largeur avec le pane : l'icône passe de l'ancre de
    // marge à l'ancre document, ou l'inverse.
    const offGeometrie = ctx.overlays.onGeometryChange(() => carnet.placer());

    // ── Chat, carte ou pilule ouverts : l'annotation se tait ──────────────
    const occupe = (): boolean => bulle.estOuverte() || action.estOuverte() || voix.estOuverte();
    const majOccupe = (): void => annotation.suspendre(occupe());

    // ── Le déclencheur ─────────────────────────────────────────────────────
    const offDeclencheurs = brancherDeclencheurs(editor, repere, annotation, chemin, occupe, (z, t) => {
        zone = z;
        trait = t;
        barre.montrer();
        // Le surlignage n'a aucune raison de se redessiner seul : le document
        // n'a pas changé.
        editor.requestUpdate();
    });

    // ── Suivre le passage ──────────────────────────────────────────────────
    //
    // Les widgets suivent le texte d'eux-mêmes (WidgetLayer). Reste le passage
    // lui-même, que l'agent cite, et les icônes de la marge qui se rangent en
    // colonnes selon leurs lignes.
    const offChange = editor.onChange((c) => {
        if (c.docChanged) carnet.remapper(c.mapPos);
        if (c.docChanged && zone) {
            // Le début colle au caractère qui suit, la fin à celui qui précède.
            const from = c.mapPos(zone.from, 1).pos;
            const to = c.mapPos(zone.to, -1).pos;
            zone = { ...zone, from, to, texte: texteEntre(editor, from, to) };
            bulle.deplacerZone(from, to, zone.texte);
        }
        // Une remise en page peut rapprocher deux icônes : leurs colonnes se recalculent.
        if (c.docChanged || c.viewportChanged) carnet.placer();
    });

    // Le surlignage du passage visé, derrière le texte : on voit exactement ce
    // que l'agent a compris du trait.
    const offSurlignage = editor.addLayer({
        above: false,
        markers: (e) => {
            if (!zone || !hasText(e)) return [];
            return e.coordsForRange(zone.from, zone.to).map((r) => new MarqueZone(r));
        },
    });

    // La vue passe à un autre document : le passage n'y existe pas.
    const refFichier = ctx.app.workspace.on('file-open', () => {
        annotation.connaitre();
        if (zone && zone.chemin !== chemin()) {
            barre.fermer();
            bulle.fermer();
            action.fermer();
            voix.fermer();
        }
        // Les icônes de la marge sont celles du document affiché.
        carnet.placer();
    });

    return () => {
        offDeclencheurs();
        offGeometrie();
        refFichier.off();
        offSurlignage();
        offChange();
        barre.fermer();
        bulle.fermer();
        action.fermer();
        voix.fermer();
        // Après les fermetures : elles rangent encore leur trace.
        carnet.detruire();
        annotation.detruire();
        repere.detruire();
    };
}

/** Un rectangle du passage visé, en coordonnées document. */
class MarqueZone implements Marker {
    private readonly r: Rect;

    constructor(r: Rect) {
        this.r = r;
    }

    eq(other: Marker): boolean {
        return other instanceof MarqueZone
            && Math.round(other.r.left) === Math.round(this.r.left)
            && Math.round(other.r.top) === Math.round(this.r.top)
            && Math.round(other.r.right) === Math.round(this.r.right)
            && Math.round(other.r.bottom) === Math.round(this.r.bottom);
    }

    draw(): HTMLElement {
        const el = document.createElement('div');
        el.classList.add('agent-zone');
        el.style.left = `${this.r.left}px`;
        el.style.top = `${this.r.top}px`;
        el.style.width = `${this.r.right - this.r.left}px`;
        el.style.height = `${this.r.bottom - this.r.top}px`;
        return el;
    }
}
