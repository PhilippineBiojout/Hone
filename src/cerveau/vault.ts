import type { App, TFile } from 'fragment';

// L'accès au vault, via l'API native de Fragment (app.vault), derrière une petite
// interface : le cerveau et les outils ne connaissent que ça, ce qui les rend
// testables avec un faux vault (voir src/tests/). Plus de node:fs : la sandbox est
// implicite — getFileByPath ne rend un TFile que pour un fichier réel du vault.

export interface AccesVault {
    /** Les chemins relatifs des notes lisibles (.md, .txt), triés. */
    fichiers(): string[];
    /** Le texte d'une note, ou null si elle n'existe pas / n'est pas lisible. */
    lire(rel: string): Promise<string | null>;
    /** La taille en octets, ou null si le fichier est inconnu. */
    taille(rel: string): number | null;
}

const EXTENSIONS = ['md', 'txt'];

/** L'accès réel, adossé à `app.vault`. */
export function accesVault(app: App): AccesVault {
    const fichier = (rel: string): TFile | null => {
        const f = app.vault.getFileByPath(rel);
        return f && EXTENSIONS.includes(f.extension) ? f : null;
    };
    return {
        fichiers: () => app.vault.getFiles()
            .filter((f) => EXTENSIONS.includes(f.extension))
            .map((f) => f.path)
            .sort(),
        lire: async (rel) => {
            const f = fichier(rel);
            return f ? app.vault.cachedRead(f) : null;
        },
        taille: (rel) => {
            const f = fichier(rel);
            return f ? f.stat.size : null;
        },
    };
}
