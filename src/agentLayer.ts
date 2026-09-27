import { Component, type DocumentSurface, type FileView, type ItemView, type LayerContext, type Marker, type Rect, type TextSurface } from 'fragment';
import { ActionAgent } from './composants/ActionAgent';
import { brancherAnnotation, type Stroke } from './interactions/annotation';
import { BarreAgent } from './composants/BarreAgent';
import { BulleAgent } from './composants/BulleAgent';
import { brancherDeclencheurs, SELECTION } from './interactions/declencheur';
import { Repere } from './positionnement/repere';
import type { ContexteQuestion } from './pont/repondre';
import { CarnetTraces, texteEntre, type Trace } from './interactions/traces';
import { TRAIT_PERDU, type RegistreTraces } from './interactions/registreTraces';
import { VoixAgent } from './composants/VoixAgent';

// À importer de 'fragment' quand le cœur l'exportera (core/editor/Editor.ts).
const hasText = (s: DocumentSurface): s is TextSurface => typeof (s as Partial<TextSurface>).getLine === 'function';

/**
 * L'agent sur une vue : un passage surligné, entouré ou sélectionné fait apparaître la barre,
 * qui ouvre le chat, la carte d'un outil ou la pilule orale. Seul fichier qui connaît les pièces.
 */
export function createAgentLayer(ctx: LayerContext, registre: RegistreTraces): () => void {
    const surface = ctx.editor;
    // Pas de texte adressable (PDF scanné, image) : rien à citer.
    if (!surface || !hasText(surface)) return () => {};
    const editor: TextSurface = surface;
    const paneEl = (ctx.view as ItemView).contentEl;
    const chemin = (): string => (ctx.view as FileView).file?.path ?? '';
    const c = new Component();
    c.load();

    /** Le passage visé, et le trait qui l'a posé : tout se tient à côté de lui. */
    let zone: ContexteQuestion | null = null;
    let trait: Stroke | null = null;
    /** Vrai quand une pièce se ferme pour laisser place à une autre : ni trace, ni passage perdu. */
    let enchainement = false;
    /** Vrai pendant la poubelle : ce qui se ferme ne laisse pas de trace. */
    let suppression = false;
    let voixReprise: { tours: number; bilan: string } | null = null;

    const annotation = brancherAnnotation(c, ctx.app, paneEl, chemin);
    const repere = new Repere(editor, ctx.overlays, paneEl, () => trait, () => annotation.barre());
    c.register(() => repere.detruire());

    const occupe = (): boolean => bulle.estOuverte() || action.estOuverte() || voix.estOuverte();
    // La barre ouverte rend aussi l'annotation inerte, sans bloquer le déclencheur :
    // le clic à côté qui la ferme ne dessine rien, le suivant dessine.
    const majOccupe = (): void => annotation.suspendre(occupe() || barre.estOuverte());
    const enchainer = (fermer: () => void): void => {
        enchainement = true;
        try { fermer(); } finally { enchainement = false; }
    };

    const barre = new BarreAgent(repere, {
        onChat: () => {
            if (zone) bulle.ouvrir(zone);
            majOccupe();
        },
        // Fermer la barre ferme tout : le chat n'aurait plus rien à côté de quoi se tenir.
        onFermer: () => {
            zone = null;
            bulle.fermer();
            editor.requestUpdate();
            majOccupe();
        },
        seule: () => !bulle.estOuverte(),
        onOutil: (outil) => {
            if (!zone) return;
            const depuis = barre.dom.getBoundingClientRect();
            bulle.fermer();
            barre.cacher();
            // Aider : les indices déjà donnés sur ce passage, pour le suivant.
            action.lancer(outil, zone, depuis, outil === 'aider' ? carnet.reponsesSur(outil, zone.from, zone.to) : []);
            majOccupe();
        },
        onVoix: () => {
            if (!zone) return;
            const depuis = barre.dom.getBoundingClientRect();
            bulle.fermer();
            barre.cacher();
            voix.lancer(zone, depuis);
            majOccupe();
        },
    });

    // Une conversation fermée laisse sa trace dans la marge ; relue par écrit, une discussion orale reste orale.
    const bulle = new BulleAgent(ctx.app, repere, () => barre, (messages, contexte, cadre, origine, bilan) => {
        if (enchainement) return;
        if (!suppression && contexte && trait && bilan !== null) {
            carnet.fermer(contexte, trait, { type: 'oral', messages, bilan }, cadre);
        } else if (!suppression && contexte && trait && messages.length > 0) {
            carnet.fermer(contexte, trait, { type: 'chat', messages, ...(origine ? { outil: origine } : {}) }, cadre);
        } else carnet.oublierOuverte();
        // Rouverte seule depuis la marge, sans barre : sa croix ferme tout.
        if (!barre.estOuverte()) {
            zone = null;
            editor.requestUpdate();
        }
        majOccupe();
    }, () => supprimer(), () => reprendreAVoix());

    const action = new ActionAgent(ctx.app, repere, () => {
        if (enchainement) return;
        const resultat = action.resultat();
        if (!suppression && resultat && zone && trait) {
            carnet.fermer(zone, trait, resultat.type === 'outil'
                ? resultat
                : { type: 'oral', messages: resultat.messages, bilan: resultat.texte }, action.cadre());
        } else carnet.oublierOuverte();
        zone = null;
        majOccupe();
        editor.requestUpdate();
    }, () => supprimer(), () => discuter());

    // La croix de la pilule fait écrire le bilan si l'on a parlé. Fermée par le calque, ou reprise
    // puis refermée sans un mot, la discussion est gardée sans nouvel appel.
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
        } else carnet.oublierOuverte();
        zone = null;
        majOccupe();
        editor.requestUpdate();
    });

    /** La tête de chat d'une carte : le chat sort du bouton, à la place et à la taille de la carte. */
    const discuter = (): void => {
        const resultat = action.resultat();
        if (!resultat || !zone || !trait) return;
        const depuis = action.boutonDiscuter();
        const cadre = action.cadre();
        const poubelle = carnet.aUneOuverte();
        enchainer(() => action.fermer());
        if (resultat.type === 'oral') {
            bulle.rouvrir(zone, resultat.messages, depuis, cadre, { bilan: resultat.texte, poubelle });
        } else {
            bulle.rouvrir(zone, [{ auteur: 'agent', texte: resultat.texte }], depuis, cadre, { outil: resultat.outil, poubelle });
        }
        majOccupe();
        editor.requestUpdate();
    };

    /** Le micro du chat : la discussion orale repart à voix haute. */
    const reprendreAVoix = (): void => {
        if (!zone) return;
        const messages = bulle.conversation();
        const depuis = bulle.boite();
        const bilan = bulle.bilanOral();
        voixReprise = bilan === null ? null : { tours: messages.length, bilan };
        enchainer(() => bulle.fermer());
        voix.lancer(zone, depuis, messages);
        majOccupe();
        editor.requestUpdate();
    };

    /** Une icône de la marge : ce qui est ouvert se referme (et range sa trace), puis la réponse revient. */
    const rouvrir = (t: Trace, depuis: HTMLElement): void => {
        voix.fermer();
        action.fermer();
        barre.fermer();
        bulle.fermer();
        zone = { ...t.zone };
        trait = carnet.traitDe(t);
        if (t.contenu.type === 'outil') action.montrer(t.contenu.outil, t.contenu, depuis, t.cadre);
        else if (t.contenu.type === 'oral') bulle.rouvrir(zone, t.contenu.messages, depuis, t.cadre, { bilan: t.contenu.bilan, poubelle: true });
        else bulle.rouvrir(zone, t.contenu.messages, depuis, t.cadre, { outil: t.contenu.outil, poubelle: true });
        majOccupe();
        editor.requestUpdate();
    };

    /** La poubelle confirmée : l'icône, la réponse et le trait d'encre (Cmd+Z remet le trait) disparaissent. */
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
        if (!t.trait.id.startsWith(SELECTION) && !t.trait.id.startsWith(TRAIT_PERDU)) annotation.effacer(t.zone.chemin, t.trait.id);
        majOccupe();
        editor.requestUpdate();
    };

    const carnet = new CarnetTraces(editor, repere, chemin, rouvrir, registre);
    // Au démontage, après les listeners : les fermetures rangent encore leur trace.
    c.register(() => {
        barre.fermer();
        bulle.fermer();
        action.fermer();
        voix.fermer();
        carnet.detruire();
    });
    // La marge change de largeur avec le pane : l'icône passe de l'ancre de marge à l'ancre document.
    c.register(ctx.overlays.onGeometryChange(() => carnet.placer()));

    brancherDeclencheurs(c, editor, repere, annotation, chemin, occupe, (z, t) => {
        zone = z;
        trait = t;
        barre.montrer();
        editor.requestUpdate();
        majOccupe();
    });

    // Les widgets suivent le texte d'eux-mêmes ; restent le passage cité et les colonnes de la marge.
    c.register(editor.onChange((ch) => {
        if (ch.docChanged) carnet.remapper(ch.mapPos);
        if (ch.docChanged && zone) {
            const from = ch.mapPos(zone.from, 1).pos;
            const to = ch.mapPos(zone.to, -1).pos;
            zone = { ...zone, from, to, texte: texteEntre(editor, from, to) };
            bulle.deplacerZone(from, to, zone.texte);
        }
        if (ch.docChanged || ch.viewportChanged) carnet.placer();
    }));

    // Le passage visé, surligné derrière le texte : on voit ce que l'agent a compris du trait.
    c.register(editor.addLayer({
        above: false,
        markers: (e) => (zone && hasText(e) ? e.coordsForRange(zone.from, zone.to).map((r) => new MarqueZone(r)) : []),
    }));

    c.registerEvent(ctx.app.workspace.on('file-open', () => {
        annotation.connaitre();
        if (zone && zone.chemin !== chemin()) {
            barre.fermer();
            bulle.fermer();
            action.fermer();
            voix.fermer();
        }
        carnet.changerDeDocument();
    }));

    return () => c.unload();
}

/** Un rectangle du passage visé, en coordonnées document. */
class MarqueZone implements Marker {
    constructor(private readonly r: Rect) {}

    eq(o: Marker): boolean {
        const a = this.r;
        return o instanceof MarqueZone && (['left', 'top', 'right', 'bottom'] as const).every((k) => Math.round(o.r[k]) === Math.round(a[k]));
    }

    draw(): HTMLElement {
        const el = document.createElement('div');
        el.classList.add('agent-zone');
        Object.assign(el.style, {
            left: `${this.r.left}px`,
            top: `${this.r.top}px`,
            width: `${this.r.right - this.r.left}px`,
            height: `${this.r.bottom - this.r.top}px`,
        });
        return el;
    }
}
