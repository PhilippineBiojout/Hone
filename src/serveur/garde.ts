import fs from 'node:fs';
import path from 'node:path';

// Le SEUL passage entre l'agent et le disque. Refusés : chemin absolu, tout
// segment qui commence par un point (`..` sort du vault, `.fragment/` contient
// la clé), lien symbolique qui mène dehors (comparé APRÈS realpath), extension
// hors liste, fichier trop gros.

const EXTENSIONS_LUES = ['.md', '.txt'];
const TAILLE_MAX = 2_000_000;
const FICHIERS_MAX = 3000;

/** Un refus : son message est rendu au modèle tel quel. */
export class RefusChemin extends Error {}

const cache = (segment: string) => segment.startsWith('.');
const segments = (rel: string) => rel.split(/[\\/]+/).filter((s) => s.length > 0);
const lisible = (nom: string) => EXTENSIONS_LUES.includes(path.extname(nom).toLowerCase());

/** Le chemin réel d'un fichier du vault que l'agent peut lire, ou un refus. `rel` : tel que le modèle l'a écrit. */
export function cheminSur(racine: string, rel: string): string {
    if (typeof rel !== 'string' || rel.trim() === '') throw new RefusChemin('Chemin vide.');
    if (rel.includes('\0')) throw new RefusChemin('Chemin invalide.');
    if (path.isAbsolute(rel) || /^[a-zA-Z]:/.test(rel)) {
        throw new RefusChemin('Chemin absolu refusé : donne un chemin relatif à la racine du vault.');
    }
    if (segments(rel).some(cache)) throw new RefusChemin('Accès refusé : ce chemin sort du vault ou vise un dossier caché.');

    const racineReelle = fs.realpathSync(racine);
    let reel: string;
    try {
        reel = fs.realpathSync(path.resolve(racineReelle, rel));
    } catch {
        throw new RefusChemin(`Aucun fichier à ce chemin : ${rel}`);
    }
    if (reel !== racineReelle && !reel.startsWith(racineReelle + path.sep)) {
        throw new RefusChemin('Accès refusé : ce chemin sort du vault.');
    }
    if (segments(path.relative(racineReelle, reel)).some(cache)) throw new RefusChemin('Accès refusé : ce chemin vise un dossier caché.');

    const stat = fs.statSync(reel);
    if (!stat.isFile()) throw new RefusChemin(`Ce n'est pas un fichier : ${rel}`);
    if (!lisible(reel)) {
        const ext = path.extname(reel).toLowerCase();
        throw new RefusChemin(`Format non lu pour l'instant : ${ext || 'sans extension'} (seulement ${EXTENSIONS_LUES.join(', ')}).`);
    }
    if (stat.size > TAILLE_MAX) throw new RefusChemin('Fichier trop gros pour être lu.');
    return reel;
}

/** Les fichiers lisibles du vault, relatifs et triés, avec les règles de `cheminSur`. */
export function fichiersLisibles(racine: string): string[] {
    const racineReelle = fs.realpathSync(racine);
    const trouves: string[] = [];
    const aVoir = [racineReelle];
    while (aVoir.length > 0 && trouves.length < FICHIERS_MAX) {
        const dossier = aVoir.pop()!;
        let entrees: fs.Dirent[];
        try {
            entrees = fs.readdirSync(dossier, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const e of entrees) {
            if (cache(e.name) || e.isSymbolicLink()) continue;
            const complet = path.join(dossier, e.name);
            if (e.isDirectory()) aVoir.push(complet);
            else if (e.isFile() && lisible(e.name)) {
                trouves.push(path.relative(racineReelle, complet));
                if (trouves.length >= FICHIERS_MAX) break;
            }
        }
    }
    return trouves.sort();
}
