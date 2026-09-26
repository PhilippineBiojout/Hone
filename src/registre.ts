/**
 * L'index : où est, dans le vault, le PDF de chaque carnet de la tablette.
 *
 * Un carnet est suivi par son id sur la tablette, jamais par son nom : le vault
 * ne bouge pas quand on renomme le carnet sur la tablette, et le PDF reste
 * suivi quand on le range ailleurs dans le vault. Logique pure, testée seule.
 */

export interface Entree {
	/** Chemin du PDF dans le vault, null quand il n'y est pas (ou plus). */
	chemin: string | null;
	/** `ModifiedClient` de la version déjà écrite ; null force un téléchargement. */
	modifie: string | null;
	/** sha1 et taille du dernier PDF écrit : de quoi le reconnaître après un déplacement hors de l'app. */
	empreinte: string | null;
	taille: number;
	/** Supprimé du vault : plus recréé, sauf si on le récupère. */
	ignore: boolean;
	/** Heure de la suppression : un déplacement hors de l'app arrive en delete puis create. */
	supprimeLe?: number;
}

/** Délai dans lequel un delete et un create forment un déplacement. */
export const FENETRE_DEPLACEMENT_MS = 10_000;

/** `chemin` est `dossier` lui-même ou quelque chose dedans. */
function sous(chemin: string, dossier: string): boolean {
	return chemin === dossier || chemin.startsWith(dossier + '/');
}

export class Registre {
	constructor(public carnets: Record<string, Entree> = {}) {}

	/** L'entrée du carnet, créée vide la première fois qu'on le voit. */
	entree(id: string): Entree {
		this.carnets[id] ??= { chemin: null, modifie: null, empreinte: null, taille: 0, ignore: false };
		return this.carnets[id];
	}

	suivi(chemin: string): boolean {
		return Object.values(this.carnets).some((e) => e.chemin === chemin);
	}

	/**
	 * Un fichier ou un dossier renommé dans l'app. Pour un dossier, le cœur
	 * n'émet qu'un événement : tous les chemins dessous suivent ici.
	 */
	renommer(ancien: string, nouveau: string): boolean {
		let change = false;
		for (const e of Object.values(this.carnets)) {
			if (e.chemin !== null && sous(e.chemin, ancien)) {
				e.chemin = nouveau + e.chemin.slice(ancien.length);
				change = true;
			}
		}
		return change;
	}

	/** Un fichier, ou tout un dossier, retiré du vault : ses carnets ne sont plus suivis. */
	supprimer(chemin: string, maintenant: number): boolean {
		let change = false;
		for (const e of Object.values(this.carnets)) {
			if (e.chemin !== null && sous(e.chemin, chemin)) {
				Object.assign(e, { chemin: null, ignore: true, supprimeLe: maintenant });
				change = true;
			}
		}
		return change;
	}

	/** Les carnets supprimés après `depuis` dont le PDF avait cette taille. */
	candidats(taille: number, depuis: number): string[] {
		return Object.keys(this.carnets).filter((id) => {
			const e = this.carnets[id];
			return e.chemin === null && e.taille === taille && (e.supprimeLe ?? 0) >= depuis;
		});
	}

	/** Le PDF d'un carnet retrouvé ailleurs : de nouveau suivi, à ce chemin. */
	rattacher(id: string, chemin: string): void {
		Object.assign(this.carnets[id], { chemin, ignore: false, supprimeLe: undefined });
	}

	/** Récupérer : le carnet sera retéléchargé au prochain tour, dans reMarkable/. */
	recuperer(ids: string[]): void {
		for (const id of ids) {
			Object.assign(this.carnets[id], { chemin: null, modifie: null, ignore: false, supprimeLe: undefined });
		}
	}
}
