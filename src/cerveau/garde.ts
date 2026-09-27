// La garde des chemins que le modèle demande à lire. En renderer, l'existence et
// la portée au vault sont assurées par app.vault (getFileByPath ne rend que des
// fichiers du vault) ; il ne reste ici que la validation de forme, en défense :
// refusés — chemin vide, absolu, segment caché (`.`, `..`, `.fragment/`), extension
// hors liste. La taille est vérifiée par l'appelant via AccesVault.taille().

export const EXTENSIONS_LUES = ['.md', '.txt'];
/** Ce que read_document lit : les notes, et les PDF (cerveau/pdf.ts). */
export const EXTENSIONS_DOCUMENTS = [...EXTENSIONS_LUES, '.pdf'];
export const TAILLE_MAX = 2_000_000;
/** Un PDF de cours ou un carnet pèse vite plusieurs mégaoctets. */
export const TAILLE_MAX_PDF = 60_000_000;

/** Un refus : son message est rendu au modèle tel quel. */
export class RefusChemin extends Error {}

const segments = (rel: string) => rel.split(/[\\/]+/).filter((s) => s.length > 0);
export const extension = (nom: string) => {
    const i = nom.lastIndexOf('.');
    return i >= 0 ? nom.slice(i).toLowerCase() : '';
};

/** Valide un chemin relatif de note (ou d'un des formats `extensions`), ou lève un RefusChemin. */
export function verifierChemin(rel: string, extensions: readonly string[] = EXTENSIONS_LUES): void {
    if (typeof rel !== 'string' || rel.trim() === '') throw new RefusChemin('Chemin vide.');
    if (rel.includes('\0')) throw new RefusChemin('Chemin invalide.');
    if (/^([a-zA-Z]:|[\\/])/.test(rel)) {
        throw new RefusChemin('Chemin absolu refusé : donne un chemin relatif à la racine du vault.');
    }
    if (segments(rel).some((s) => s.startsWith('.'))) {
        throw new RefusChemin('Accès refusé : ce chemin sort du vault ou vise un dossier caché.');
    }
    if (!extensions.includes(extension(rel))) {
        throw new RefusChemin(`Format non lu pour l'instant : seulement ${extensions.join(', ')}.`);
    }
}
