/**
 * L'index : où est, dans le vault, le PDF de chaque carnet de la tablette.
 *
 * On suit un carnet par son id sur la tablette, jamais par son nom : le vault
 * ne bouge pas quand on renomme ou déplace le carnet sur la tablette, et le PDF
 * reste suivi quand on le range ailleurs dans le vault. Logique pure, sans
 * Fragment, pour être testée seule.
 */

export interface Entree {
	/** Chemin du PDF dans le vault, null quand il n'y est plus. */
	chemin: string | null;
	/** Chemin du carnet sur la tablette au dernier passage (pour la vue et la récupération). */
	cheminTablette: string;
	/** `ModifiedClient` de la version écrite dans le vault, null pour forcer un téléchargement. */
	modifie: string | null;
	/** sha1 et taille du dernier PDF écrit : ce qui permet de le reconnaître après un déplacement hors de l'app. */
	empreinte: string | null;
	taille: number;
	/** Supprimé du vault : on ne le recrée plus, sauf récupération. */
	ignore: boolean;
	/** Heure de la suppression, pour reconnaître un déplacement (delete puis create). */
	supprimeLe?: number;
}

export type Carnets = Record<string, Entree>;

/** Un déplacement hors de l'app arrive en delete + create : on accepte le create pendant ce délai. */
export const FENETRE_DEPLACEMENT_MS = 10_000;

function sous(chemin: string, dossier: string): boolean {
	return chemin === dossier || chemin.startsWith(dossier + '/');
}

export class Registre {
	constructor(public carnets: Carnets = {}) {}

	get(id: string): Entree | undefined {
		return this.carnets[id];
	}

	parChemin(chemin: string): string | null {
		for (const [id, e] of Object.entries(this.carnets)) if (e.chemin === chemin) return id;
		return null;
	}

	/** Un nouveau carnet, à télécharger à l'emplacement que choisira la synchro. */
	ajouter(id: string, cheminTablette: string): Entree {
		const e: Entree = { chemin: null, cheminTablette, modifie: null, empreinte: null, taille: 0, ignore: false };
		this.carnets[id] = e;
		return e;
	}

	/** Ce qu'on vient d'écrire dans le vault. */
	ecrit(id: string, chemin: string, modifie: string, empreinte: string, taille: number): void {
		const e = this.carnets[id];
		Object.assign(e, { chemin, modifie, empreinte, taille, ignore: false });
		delete e.supprimeLe;
	}

	/**
	 * Un fichier ou un dossier renommé ou déplacé dans l'app. Pour un dossier,
	 * le cœur n'émet qu'un événement : tous les chemins dessous suivent ici.
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
				e.chemin = null;
				e.ignore = true;
				e.supprimeLe = maintenant;
				change = true;
			}
		}
		return change;
	}

	/**
	 * Les carnets qu'un PDF apparu de cette taille pourrait être. `depuis` :
	 * seulement ceux supprimés après cet instant (déplacement en direct) ;
	 * absent, tous ceux qui n'ont plus de chemin (réconciliation au démarrage).
	 */
	candidats(taille: number, depuis?: number): string[] {
		return Object.entries(this.carnets)
			.filter(([, e]) => e.chemin === null && e.empreinte !== null && e.taille === taille)
			.filter(([, e]) => depuis === undefined || (e.supprimeLe ?? 0) >= depuis)
			.map(([id]) => id);
	}

	/** Le PDF d'un carnet retrouvé ailleurs : il est de nouveau suivi, à ce chemin. */
	rattacher(id: string, chemin: string): void {
		const e = this.carnets[id];
		e.chemin = chemin;
		e.ignore = false;
		delete e.supprimeLe;
	}

	/** Récupérer : le carnet sera retéléchargé au prochain tour, dans reMarkable/. */
	recuperer(ids: string[]): void {
		for (const id of ids) {
			const e = this.carnets[id];
			if (!e || !e.ignore) continue;
			Object.assign(e, { ignore: false, chemin: null, modifie: null });
			delete e.supprimeLe;
		}
	}
}
