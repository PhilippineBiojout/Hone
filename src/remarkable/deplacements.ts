import { TFile, type App, type TAbstractFile } from 'fragment';
import { empreinte, type Registre } from './registre';
import { log } from './synchro';

/**
 * Un PDF suivi qu'on range ailleurs doit rester suivi. Dans l'app, c'est un
 * `rename` (le registre s'en charge seul). Hors de l'app (Finder, git), c'est
 * un `delete` et un `create`, dans un ordre ou dans l'autre, ou rien du tout
 * si Fragment était fermé. Ici, on reconnaît le fichier réapparu à sa taille,
 * puis à son empreinte.
 */

/** Délai dans lequel un delete et un create forment un déplacement. */
const FENETRE_MS = 10_000;

export class Deplacements {
	/** PDF non suivis apparus récemment : avec un delete proche, c'est peut-être un déplacement. */
	private apparus = new Map<string, number>();

	constructor(
		private readonly app: App,
		private readonly registre: Registre,
	) {}

	/** Un fichier retiré du vault. Vrai si des carnets ne sont plus suivis. */
	async supprime(chemin: string): Promise<boolean> {
		if (!this.registre.supprimer(chemin, Date.now())) return false;
		await this.retrouverRecents();
		return true;
	}

	/** Un fichier apparu dans le vault. Vrai si c'est un PDF non suivi. */
	async apparu(f: TAbstractFile): Promise<boolean> {
		if (!(f instanceof TFile) || f.extension !== 'pdf' || this.registre.suivi(f.path)) return false;
		this.apparus.set(f.path, Date.now());
		await this.retrouverRecents();
		return true;
	}

	/**
	 * Le vault se charge sans émettre d'événement : ce qui a bougé pendant que
	 * Fragment était fermé se rattrape ici. Un PDF suivi introuvable est cherché
	 * ailleurs dans le vault ; sinon il n'est plus suivi.
	 */
	async auDemarrage(): Promise<void> {
		const debut = Date.now();
		for (const e of Object.values(this.registre.carnets)) {
			if (e.chemin && !this.app.vault.getFileByPath(e.chemin)) this.registre.supprimer(e.chemin, debut);
		}
		await this.retrouver(this.app.vault.getFiles(), debut);
	}

	/** Le delete et le create arrivent dans n'importe quel ordre : on essaie à chacun des deux. */
	private async retrouverRecents(): Promise<void> {
		const depuis = Date.now() - FENETRE_MS;
		for (const [chemin, t] of this.apparus) if (t < depuis) this.apparus.delete(chemin);
		const fichiers = [...this.apparus.keys()].map((p) => this.app.vault.getFileByPath(p)).filter((f) => f !== null);
		await this.retrouver(fichiers, depuis);
	}

	/** Parmi ces fichiers, le PDF d'un carnet supprimé après `depuis` : même taille, puis même empreinte. */
	private async retrouver(fichiers: TFile[], depuis: number): Promise<void> {
		for (const f of fichiers) {
			if (f.extension !== 'pdf' || this.registre.suivi(f.path)) continue;
			const ids = this.registre.candidats(f.stat.size, depuis);
			if (ids.length === 0) continue;
			const h = empreinte(await this.app.vault.readBinary(f));
			const id = ids.find((i) => this.registre.carnets[i].empreinte === h);
			if (!id) continue;
			this.registre.rattacher(id, f.path);
			log(`${f.path} : retrouvé, toujours suivi`);
		}
	}
}
