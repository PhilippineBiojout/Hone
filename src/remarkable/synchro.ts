import { FileView, TFolder, type App, type TFile } from 'fragment';
import { cibles, DOSSIER, type Entree, type Registre } from './registre';
import { cableBranche, type ElementTablette, type Tablette } from './tablette';

/** Le dossier qui contient `chemin`. */
const parent = (chemin: string): string => chemin.slice(0, chemin.lastIndexOf('/'));

/** Live, ou ce qui manque : le câble, ou l'interface web USB (câble là, la tablette ne répond pas). */
export type Etat = 'live' | 'cable' | 'interface';

const JOURNAL: Record<Etat, string> = {
	live: 'tablette connectée',
	cable: 'tablette injoignable : câble débranché',
	interface: 'tablette injoignable : câble branché, interface web USB activée ?',
};

/** Dans la console : de quoi mesurer le rythme de la tablette. */
export function log(msg: string): void {
	console.log(`[remarkable] ${msg}`);
}

/**
 * La boucle : interroge la tablette et fait de `reMarkable/` son miroir.
 * Chaque tour, dans l'ordre : ce qui a disparu de la tablette part à la
 * corbeille, chaque document est mis à sa place (déplacé, renommé) puis
 * retéléchargé s'il a changé, et les dossiers suivent (créés, et retirés
 * quand ils n'existent plus sur la tablette et sont vides).
 */
export class Synchro {
	/** `null` tant que le premier tour n'a pas répondu. */
	etat: Etat | null = null;
	private occupe = false;
	/** Le dernier rechargement d'onglet PDF, auquel le suivant s'enchaîne. */
	private rechargement: Promise<void> = Promise.resolve();

	constructor(
		private readonly app: App,
		private readonly registre: Registre,
		private readonly tablette: Tablette,
		/** Sauvegarde l'index et met à jour le statut. */
		private readonly changer: () => Promise<void>,
	) {}

	/** Le PDF de l'entrée dans le vault, s'il y est encore. */
	private fichier(e: Entree): TFile | null {
		return e.chemin ? this.app.vault.getFileByPath(e.chemin) : null;
	}

	private async passer(etat: Etat): Promise<void> {
		if (this.etat === etat) return;
		this.etat = etat;
		log(JOURNAL[etat]);
		await this.changer();
	}

	async tour(): Promise<void> {
		if (this.occupe) return;
		this.occupe = true;
		try {
			// `lister` échoue en entier si une seule requête échoue : on n'agit
			// jamais sur une liste partielle (on supprimerait ce qui manque).
			const elements = await this.tablette.lister();
			await this.passer('live');
			const docs = elements.filter((el) => !el.dossier);
			await this.retirerSupprimes(docs);
			const ou = cibles(docs, this.registre.carnets);
			// Le plus récemment modifié d'abord : le carnet où l'on écrit passe
			// devant la première synchro et devant un export lent. (Les dates
			// ISO se trient comme des chaînes.)
			for (const el of [...docs].sort((a, b) => b.modifie.localeCompare(a.modifie))) await this.suivre(el, ou.get(el.id)!);
			await this.miroirDesDossiers(elements.filter((el) => el.dossier));
		} catch {
			await this.passer(cableBranche(this.tablette.hote) ? 'interface' : 'cable');
		} finally {
			this.occupe = false;
		}
	}

	/** Supprimé sur la tablette (corbeille comprise, elle n'est pas listée) : à la corbeille du vault. */
	private async retirerSupprimes(docs: ElementTablette[]): Promise<void> {
		const presents = new Set(docs.map((d) => d.id));
		// Une tablette qui ne liste rien du tout vient sans doute de démarrer : on ne vide pas tout.
		if (presents.size === 0) return;
		for (const [id, e] of Object.entries(this.registre.carnets)) {
			if (presents.has(id)) continue;
			const fichier = this.fichier(e);
			if (fichier) await this.app.vault.trash(fichier, false);
			delete this.registre.carnets[id];
			log(`${e.chemin} : supprimé sur la tablette, mis à la corbeille`);
			await this.changer();
		}
	}

	private async suivre(el: ElementTablette, cible: string): Promise<void> {
		const e = this.registre.entree(el.id);
		const fichier = this.fichier(e);
		if (fichier && e.chemin !== cible) await this.deplacer(e, fichier, cible);
		// Écrit une fois mais plus là (sorti de reMarkable/ ou supprimé dans
		// Fragment) : on le recrée, ce qui a été sorti reste une copie. Pas un
		// document jamais écrit (export en échec) : il attend sa modification.
		if (e.chemin && !fichier) Object.assign(e, { chemin: null, modifie: null });
		if (e.modifie === el.modifie) return;
		await this.telecharger(el, e, cible);
	}

	/** Déplacé ou renommé sur la tablette : on le déplace dans le vault. */
	private async deplacer(e: Entree, fichier: TFile, cible: string): Promise<void> {
		if (this.app.vault.getAbstractFileByPath(cible)) {
			log(`${cible} : déjà pris, ${e.chemin} reste où il est pour ce tour`);
			return;
		}
		const avant = e.chemin;
		await this.creerDossier(parent(cible));
		e.chemin = cible;
		await this.app.vault.rename(fichier, cible);
		log(`${avant} → ${cible}`);
		await this.changer();
	}

	private async telecharger(el: ElementTablette, e: Entree, cible: string): Promise<void> {
		const avant = e.modifie;
		log(`${el.chemin} : ${e.chemin ? 'modifié' : 'à écrire'}, téléchargement…`);
		// On retient la version tout de suite : un export qui échoue n'est
		// retenté qu'à la prochaine modification du carnet. Le réessayer à
		// chaque tour bloquerait toute la boucle (un carnet dont l'export ne
		// finit jamais retenait tout le reste 60 s par tour).
		e.modifie = el.modifie;
		const t0 = Date.now();
		let octets: ArrayBuffer;
		try {
			octets = await this.tablette.telecharger(el.id, el.carnet);
		} catch (err) {
			log(`${el.chemin} : export impossible (${(err as Error).message}), réessai à sa prochaine modification`);
			await this.changer();
			return;
		}
		try {
			await this.ecrire(e, cible, octets);
			log(`${e.chemin} : ${(octets.byteLength / 1024).toFixed(0)} Ko en ${Date.now() - t0} ms`);
		} catch (err) {
			e.modifie = avant;
			log(`${el.chemin} : écriture impossible dans le vault (${(err as Error).message})`);
		}
		await this.changer();
	}

	/** Écrit le PDF là où il est, ou le crée à `cible`. */
	private async ecrire(e: Entree, cible: string, octets: ArrayBuffer): Promise<void> {
		const { vault } = this.app;
		const fichier = this.fichier(e);
		if (fichier) {
			await vault.modifyBinary(fichier, octets);
			await this.recharger(fichier);
			return;
		}
		if (vault.getAbstractFileByPath(cible)) throw new Error(`${cible} existe déjà`);
		await this.creerDossier(parent(cible));
		e.chemin = cible;
		await vault.createBinary(cible, octets);
	}

	/**
	 * Les dossiers de la tablette existent dans reMarkable/, même vides. Un
	 * dossier de reMarkable/ qui n'est plus sur la tablette est retiré s'il est
	 * vide (renommé ou supprimé sur la tablette : ses documents sont déjà
	 * partis). Jamais un dossier qui contient encore quelque chose.
	 */
	private async miroirDesDossiers(dossiers: ElementTablette[]): Promise<void> {
		const attendus = new Set([DOSSIER, ...dossiers.map((d) => `${DOSSIER}/${d.chemin}`)]);
		for (const chemin of attendus) await this.creerDossier(chemin);
		const racine = this.app.vault.getFolderByPath(DOSSIER);
		if (racine) await this.retirerVides(racine, attendus);
	}

	/** Du plus profond au plus haut : vide un dossier de ses sous-dossiers vides avant de le juger. */
	private async retirerVides(dossier: TFolder, attendus: Set<string>): Promise<void> {
		for (const enfant of [...dossier.children]) if (enfant instanceof TFolder) await this.retirerVides(enfant, attendus);
		if (attendus.has(dossier.path) || dossier.children.length > 0) return;
		await this.app.vault.delete(dossier);
		log(`${dossier.path} : n'est plus sur la tablette, retiré`);
	}

	/**
	 * La vue PDF du cœur n'écoute pas `modify` : un onglet ouvert garderait
	 * l'ancienne version. On la recharge nous-mêmes (l'URL du fichier porte son
	 * mtime, donc pas de cache). La colonne garde sa hauteur pendant le
	 * rechargement, donc le défilement ne retombe pas en haut et on reste sur la
	 * page qu'on lisait ; le zoom, lui, est un champ de la vue et survit. Un
	 * rechargement à la fois : le suivant attend la fin du précédent.
	 */
	private recharger(fichier: TFile): Promise<void> {
		this.rechargement = this.rechargement.catch(() => {}).then(async () => {
			for (const leaf of this.app.workspace.getLeavesOfFile(fichier)) {
				const vue = leaf.view;
				if (!(vue instanceof FileView) || vue.getViewType() !== 'pdf') continue;
				const defilement = vue.contentEl.querySelector<HTMLElement>('.pdf-scroll');
				const pages = vue.contentEl.querySelector<HTMLElement>('.pdf-pages');
				if (!defilement || !pages) continue;
				const { scrollTop, scrollLeft } = defilement;
				const tailles = [...pages.querySelectorAll<HTMLElement>('.pdf-page')].map((p) => [p.style.width, p.style.height]);
				pages.style.minHeight = `${pages.offsetHeight}px`;
				try {
					await vue.onUnloadFile(fichier);
					await vue.onLoadFile(fichier);
					// Le cœur redonne à chaque page la taille de la page 1. Or une
					// page de carnet s'allonge quand on écrit plus bas : sans les
					// anciennes tailles, le document raccourcit et le défilement
					// remis tombe en bas. Chaque page reprend donc la sienne, que
					// le cœur corrige s'il la repeint à une autre taille.
					pages.querySelectorAll<HTMLElement>('.pdf-page').forEach((p, i) => {
						if (!tailles[i]) return;
						[p.style.width, p.style.height] = tailles[i];
					});
					defilement.scrollTop = scrollTop;
					defilement.scrollLeft = scrollLeft;
				} finally {
					pages.style.minHeight = '';
				}
			}
		});
		return this.rechargement;
	}

	/** Le cœur ne crée aucun dossier parent : on crée chaque niveau, un par un. */
	private async creerDossier(chemin: string): Promise<void> {
		const morceaux = chemin.split('/');
		for (let i = 1; i <= morceaux.length; i++) {
			const dossier = morceaux.slice(0, i).join('/');
			if (!this.app.vault.getAbstractFileByPath(dossier)) await this.app.vault.createFolder(dossier);
		}
	}
}
