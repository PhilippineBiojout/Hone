import { FileView, type App, type TFile } from 'fragment';
import { empreinte, type Entree, type Registre } from './registre';
import type { ElementTablette, Tablette } from './tablette';

/** Le dossier du vault où arrivent les carnets la première fois. */
const DOSSIER = 'reMarkable';

/** Dans la console : de quoi mesurer le rythme de la tablette. */
export function log(msg: string): void {
	console.log(`[remarkable] ${msg}`);
}

/**
 * La boucle : interroge la tablette, télécharge ce qui a changé et l'écrit
 * dans le vault, là où l'index dit que le PDF se trouve maintenant.
 */
export class Synchro {
	connectee: boolean | null = null;
	private occupe = false;

	constructor(
		private readonly app: App,
		private readonly registre: Registre,
		private readonly tablette: Tablette,
		/** Sauvegarde l'index et met à jour l'état en haut des PDF. */
		private readonly changer: () => Promise<void>,
	) {}

	private async etreConnectee(valeur: boolean): Promise<void> {
		if (this.connectee === valeur) return;
		this.connectee = valeur;
		log(valeur ? 'tablette connectée' : 'tablette injoignable (branchée ? interface web USB activée ?)');
		await this.changer();
	}

	async tour(): Promise<void> {
		if (this.occupe) return;
		this.occupe = true;
		try {
			const elements = await this.tablette.lister();
			await this.etreConnectee(true);
			// Le plus récemment modifié d'abord : le carnet où l'on écrit passe
			// devant la première synchro et devant un export lent. (Les dates
			// ISO se trient comme des chaînes.)
			const carnets = elements.filter((el) => !el.dossier).sort((a, b) => b.modifie.localeCompare(a.modifie));
			for (const el of carnets) await this.suivre(el);
		} catch {
			await this.etreConnectee(false);
		} finally {
			this.occupe = false;
		}
	}

	private async suivre(el: ElementTablette): Promise<void> {
		const e = this.registre.entree(el.id);
		if (e.ignore || e.modifie === el.modifie) return;

		const avant = e.modifie;
		log(`${el.chemin} : ${avant ? 'modifié' : 'nouveau'}, téléchargement…`);
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
			await this.ecrire(e, el, octets);
			log(`${e.chemin} : ${(octets.byteLength / 1024).toFixed(0)} Ko en ${Date.now() - t0} ms`);
		} catch (err) {
			e.modifie = avant;
			log(`${el.chemin} : écriture impossible dans le vault (${(err as Error).message})`);
		}
		await this.changer();
	}

	/** Écrit le PDF là où il est, ou le crée dans reMarkable/ la première fois. */
	private async ecrire(e: Entree, el: ElementTablette, octets: ArrayBuffer): Promise<void> {
		const { vault } = this.app;
		const fichier = e.chemin ? vault.getFileByPath(e.chemin) : null;
		if (fichier) {
			await vault.modifyBinary(fichier, octets);
			await this.recharger(fichier);
		} else {
			const nom = el.chemin.replace(/\.pdf$/i, '');
			const chemin = this.cheminLibre(`${DOSSIER}/${nom}`);
			await this.creerDossiers(chemin);
			// Noté avant d'écrire : le `create` que le vault va émettre est le
			// nôtre, pas un déplacement à reconnaître.
			e.chemin = chemin;
			try {
				await vault.createBinary(chemin, octets);
			} catch (err) {
				e.chemin = null;
				throw err;
			}
		}
		e.empreinte = empreinte(octets);
		e.taille = octets.byteLength;
	}

	/**
	 * La vue PDF du cœur n'écoute pas `modify` : un onglet ouvert garderait
	 * l'ancienne version. On la recharge nous-mêmes (l'URL du fichier porte son
	 * mtime, donc pas de cache), en gardant le zoom et l'endroit où on lisait.
	 */
	private async recharger(fichier: TFile): Promise<void> {
		for (const leaf of this.app.workspace.getLeavesOfFile(fichier)) {
			const vue = leaf.view;
			if (!(vue instanceof FileView) || vue.getViewType() !== 'pdf') continue;
			const etat = vue.getEphemeralState();
			const defilement = vue.contentEl.querySelector('.pdf-scroll');
			const haut = defilement?.scrollTop ?? 0;
			await vue.onUnloadFile(fichier);
			await vue.onLoadFile(fichier);
			vue.setEphemeralState(etat);
			if (defilement) defilement.scrollTop = haut;
		}
	}

	/** Le cœur ne crée aucun dossier parent : on crée chaque niveau, un par un. */
	private async creerDossiers(chemin: string): Promise<void> {
		const morceaux = chemin.split('/').slice(0, -1);
		for (let i = 1; i <= morceaux.length; i++) {
			const dossier = morceaux.slice(0, i).join('/');
			if (!this.app.vault.getAbstractFileByPath(dossier)) await this.app.vault.createFolder(dossier);
		}
	}

	/** « Nom.pdf », ou « Nom (2).pdf » si le nom est pris. */
	private cheminLibre(base: string): string {
		let chemin = `${base}.pdf`;
		for (let n = 2; this.app.vault.getAbstractFileByPath(chemin); n++) chemin = `${base} (${n}).pdf`;
		return chemin;
	}
}
