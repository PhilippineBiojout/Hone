/**
 * L'index : où est, dans le vault, le PDF de chaque carnet de la tablette.
 *
 * Un carnet est suivi par son id sur la tablette, jamais par son nom : le vault
 * ne bouge pas quand on renomme le carnet sur la tablette, et le PDF reste
 * suivi quand on le range ailleurs dans le vault. Logique pure, testée seule.
 */

import { createHash } from 'crypto';

export interface Entree {
	/** Chemin du PDF dans le vault, null quand il n'y est pas (ou plus). */
	chemin: string | null;
	/** `ModifiedClient` de la version déjà écrite ; null force un téléchargement. */
	modifie: string | null;
	/** sha1 et taille du dernier PDF écrit : de quoi le reconnaître après un déplacement hors de l'app. */
	empreinte: string | null;
	taille: number;
	/** Supprimé du vault : plus recréé. */
	ignore: boolean;
	/** Heure de la suppression : un déplacement hors de l'app arrive en delete puis create. */
	supprimeLe?: number;
}

/** Le sha1 d'un PDF : ce qui le reconnaît après un déplacement hors de l'app. */
export function empreinte(octets: ArrayBuffer): string {
	return createHash('sha1').update(new Uint8Array(octets)).digest('hex');
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
		const entrees = this.sous(ancien);
		for (const e of entrees) e.chemin = nouveau + e.chemin!.slice(ancien.length);
		return entrees.length > 0;
	}

	/** Un fichier, ou tout un dossier, retiré du vault : ses carnets ne sont plus suivis. */
	supprimer(chemin: string, maintenant: number): boolean {
		const entrees = this.sous(chemin);
		for (const e of entrees) Object.assign(e, { chemin: null, ignore: true, supprimeLe: maintenant });
		return entrees.length > 0;
	}

	/** Les carnets dont le PDF est `chemin` lui-même, ou dans le dossier `chemin`. */
	private sous(chemin: string): Entree[] {
		return Object.values(this.carnets).filter((e) => e.chemin === chemin || e.chemin?.startsWith(chemin + '/'));
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
}
