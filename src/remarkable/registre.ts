/**
 * L'index : où est, dans le vault, le PDF de chaque document de la tablette.
 *
 * `reMarkable/` est le miroir de la tablette : chaque document y est à
 * `reMarkable/<son chemin sur la tablette>.pdf`. Déplacé, renommé ou supprimé
 * sur la tablette, il l'est aussi dans le vault. Un PDF qu'on sort de
 * `reMarkable/` dans Fragment n'est plus qu'une copie : l'original est recréé
 * à sa place. Logique pure, testée seule.
 */

export interface Entree {
	/** Là où on a écrit le PDF la dernière fois, null tant qu'il n'existe pas. */
	chemin: string | null;
	/** `ModifiedClient` de la version déjà écrite ; null force un téléchargement. */
	modifie: string | null;
}

/** Le dossier du vault qui reflète la tablette. */
export const DOSSIER = 'reMarkable';

export class Registre {
	carnets: Record<string, Entree> = {};

	constructor(lus: Record<string, Partial<Entree>> = {}) {
		// Un data.json d'avant le miroir a d'autres champs : on ne garde que ceux-ci.
		for (const [id, e] of Object.entries(lus)) this.carnets[id] = { chemin: e.chemin ?? null, modifie: e.modifie ?? null };
	}

	/** L'entrée du document, créée vide la première fois qu'on le voit. */
	entree(id: string): Entree {
		this.carnets[id] ??= { chemin: null, modifie: null };
		return this.carnets[id];
	}

	suivi(chemin: string): boolean {
		return Object.values(this.carnets).some((e) => e.chemin === chemin);
	}
}

/**
 * Où doit être le PDF de chaque document : `reMarkable/<chemin>.pdf`, ou
 * « <nom> (2).pdf » quand deux documents du même dossier ont le même nom.
 * Stable d'un tour à l'autre : un document déjà à l'une des variantes de son
 * nom la garde, les autres prennent la première libre.
 */
export function cibles(docs: { id: string; chemin: string }[], carnets: Record<string, Entree>): Map<string, string> {
	const parBase = new Map<string, string[]>();
	for (const d of [...docs].sort((a, b) => a.id.localeCompare(b.id))) {
		const base = `${DOSSIER}/${d.chemin}`;
		parBase.set(base, [...(parBase.get(base) ?? []), d.id]);
	}

	const sortie = new Map<string, string>();
	for (const [base, ids] of parBase) {
		const variante = (n: number) => (n === 1 ? `${base}.pdf` : `${base} (${n}).pdf`);
		const variantes = ids.map((_, i) => variante(i + 1));
		const prises = new Set<string>();
		const restants: string[] = [];
		for (const id of ids) {
			const actuel = carnets[id]?.chemin;
			if (actuel && variantes.includes(actuel) && !prises.has(actuel)) {
				prises.add(actuel);
				sortie.set(id, actuel);
			} else restants.push(id);
		}
		let n = 1;
		for (const id of restants) {
			while (prises.has(variante(n))) n++;
			prises.add(variante(n));
			sortie.set(id, variante(n));
		}
	}
	return sortie;
}
