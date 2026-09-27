import type { App, Component } from 'fragment';

// Ce que l'agent demande au calque d'annotation, qui n'a pas encore d'API publique.
// Demandes faites au cœur, qui ne changeront que ce fichier :
//   1. un événement « trait posé » qui porte le trait (aujourd'hui : `change`, et les id déjà vus) ;
//   2. la boîte de la barre d'annotation (aujourd'hui : un sélecteur) ;
//   3. suspendre la saisie de dessin (aujourd'hui : pointerdown arrêté en capture, et une classe).

/** Un trait d'annotation (views/annotation/AnnotationSource.ts). */
export interface Stroke {
    id: string;
    /** L'offset du glyphe d'ancrage ; les points en sont des écarts. */
    pos: number;
    points: readonly { dx: number; dy: number }[];
    color: string;
    width: number;
    tool: 'crayon' | 'surligneur';
}

export interface Annotation {
    /** Un trait neuf, posé à la main : ni un undo, ni un redo. */
    surTraitPose(cb: (path: string, stroke: Stroke) => void): void;
    /** Efface un trait par la pile d'annulation : Cmd+Z le remet. */
    effacer(path: string, id: string): void;
    /** La boîte client de la barre d'annotation de ce pane. */
    barre(): DOMRect | null;
    /** Tant que c'est vrai, un clic sur la page ne dessine rien ; l'outil armé est gardé. */
    suspendre(oui: boolean): void;
    /** Le document affiché a changé : ses traits existants ne sont pas neufs. */
    connaitre(): void;
}

/** La clé d'un document dans la source : un chemin hier, le TFile depuis que le cœur
 *  persiste ses traits en artefacts (Fragment du 2026-09-27). On accepte les deux. */
type CleDoc = string | { path: string };

interface SourceAnnotation {
    strokes(doc: CleDoc): readonly Stroke[];
    erase(doc: CleDoc, id: string): void;
    on(name: 'change', cb: (doc: CleDoc) => void): { off(): void };
}

/** Branche l'agent sur l'annotation de ce pane ; tout se défait avec `composant`. */
export function brancherAnnotation(composant: Component, app: App, paneEl: HTMLElement, chemin: () => string): Annotation {
    // Demande 1 : le plugin d'annotation n'est joignable que par le registre interne.
    const interne = app as unknown as { plugins?: { plugins?: Map<string, unknown> } };
    const source = (interne.plugins?.plugins?.get('annotation') as { source?: SourceAnnotation } | undefined)?.source;

    // Le nouveau cœur range les traits par TFile : un chemin n'y trouve plus rien, et la barre
    // ne s'ouvrait plus. On essaie le fichier, puis le chemin (cœur d'avant).
    const cheminDe = (doc: CleDoc): string => (typeof doc === 'string' ? doc : doc.path);
    const traitsDe = (path: string): readonly Stroke[] => {
        if (!source) return [];
        const fichier = app.vault.getFileByPath(path);
        const parFichier = fichier ? source.strokes(fichier) : [];
        return parFichier.length > 0 ? parFichier : source.strokes(path);
    };

    const vus = new Set<string>();
    let combien = 0;
    const connaitre = (): void => {
        const traits = traitsDe(chemin());
        for (const s of traits) vus.add(s.id);
        combien = traits.length;
    };
    connaitre();

    const abonnes: ((path: string, stroke: Stroke) => void)[] = [];
    const ref = source?.on('change', (doc) => {
        const path = cheminDe(doc);
        if (path !== chemin()) return;
        const traits = traitsDe(path);
        // Un trait posé à la main en ajoute un seul ; le cœur qui recharge les traits d'un
        // document depuis ses artefacts les ajoute d'un coup : ce ne sont pas des traits neufs.
        const unDePlus = traits.length === combien + 1;
        const neuf = traits.filter((s) => !vus.has(s.id)).at(-1);
        connaitre();
        if (neuf && unDePlus) for (const cb of abonnes) cb(path, neuf);
    });
    composant.register(() => ref?.off());

    let suspendu = false;
    composant.registerDomEvent(paneEl, 'pointerdown', (e) => {
        if (!suspendu || !(e.target instanceof Element) || !e.target.closest('.annotation-surface')) return;
        e.preventDefault();
        e.stopPropagation();
    }, true);
    composant.register(() => paneEl.classList.remove('agent-occupe'));

    return {
        surTraitPose: (cb) => { abonnes.push(cb); },
        effacer: (path, id) => {
            const fichier = app.vault.getFileByPath(path);
            if (fichier) source?.erase(fichier, id);
            source?.erase(path, id);
        },
        // Demande 2 : la Toolbar du pane qui n'est pas celle de l'agent.
        barre: () => paneEl.querySelector('.toolbar:not(.agent-barre)')?.getBoundingClientRect() ?? null,
        suspendre: (oui) => {
            suspendu = oui;
            paneEl.classList.toggle('agent-occupe', oui); // pour le curseur (styles.css)
        },
        connaitre,
    };
}
