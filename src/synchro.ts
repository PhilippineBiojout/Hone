import { createHash } from 'crypto';
import type { App, TFile } from 'fragment';
import type { Registre } from './registre';
import { ExportRefuse, type ElementTablette, type Tablette } from './tablette';

/** Le dossier du vault où arrivent les carnets la première fois. */
export const DOSSIER = 'reMarkable';
const LIGNES_JOURNAL = 60;

export function empreinte(octets: ArrayBuffer): string {
	return createHash('sha1').update(new Uint8Array(octets)).digest('hex');
}

/**
 * La boucle : interroge la tablette, télécharge ce qui a changé et l'écrit
 * dans le vault, là où l'index dit que le PDF se trouve maintenant.
 */
export class Synchro {
	connectee: boolean | null = null;
	derniere: number | null = null;
	/** Le dernier inventaire de la tablette, pour la vue. */
	elements: ElementTablette[] = [];
	journal: string[] = [];
	/** Chemins qu'on est en train d'écrire : leur `create` n'est pas un déplacement. */
	readonly enEcriture = new Set<string>();
	private occupe = false;

	constructor(
		private readonly app: App,
		private readonly registre: Registre,
		readonly tablette: Tablette,
		private readonly sauver: () => Promise<void>,
		private readonly changer: () => void,
	) {}

	log(msg: string): void {
		const ligne = `[${new Date().toLocaleTimeString('fr-FR')}] ${msg}`;
		console.debug(`[remarkable] ${ligne}`);
		this.journal.push(ligne);
		if (this.journal.length > LIGNES_JOURNAL) this.journal.shift();
		this.changer();
	}

	private etreConnectee(valeur: boolean): void {
		if (this.connectee === valeur) return;
		this.connectee = valeur;
		this.log(valeur ? 'tablette connectée' : 'tablette injoignable (branchée ? interface web USB activée ?)');
	}

	async tour(): Promise<void> {
		if (this.occupe) return;
		this.occupe = true;
		try {
			this.elements = await this.tablette.lister();
			this.etreConnectee(true);
			for (const el of this.elements) {
				if (!el.dossier) await this.suivre(el);
			}
			this.derniere = Date.now();
			this.changer();
		} catch {
			this.etreConnectee(false);
		} finally {
			this.occupe = false;
		}
	}

	private async suivre(el: ElementTablette): Promise<void> {
		const e = this.registre.get(el.id) ?? this.registre.ajouter(el.id, el.chemin);
		e.cheminTablette = el.chemin;
		if (e.ignore || e.modifie === el.modifie) return;

		const avant = e.modifie;
		this.log(`${el.chemin} : ${avant ? 'modifié' : 'nouveau'} (${el.modifie}), téléchargement…`);
		// On retient la version tout de suite : un export refusé n'est retenté
		// qu'à la prochaine modification, pas toutes les 2 s.
		e.modifie = el.modifie;
		const t0 = Date.now();
		let octets: ArrayBuffer;
		try {
			octets = await this.tablette.telecharger(el.id);
		} catch (err) {
			if (err instanceof ExportRefuse) {
				this.log(`${el.chemin} : ${err.message}`);
				await this.sauver();
				return;
			}
			// Coupure en plein téléchargement : on retélécharge au retour.
			e.modifie = avant;
			throw err;
		}
		try {
			const chemin = await this.ecrire(el, octets);
			this.registre.ecrit(el.id, chemin, el.modifie, empreinte(octets), octets.byteLength);
			this.log(`${chemin} : ${(octets.byteLength / 1024).toFixed(0)} Ko en ${Date.now() - t0} ms`);
		} catch (err) {
			e.modifie = avant;
			this.log(`${el.chemin} : écriture impossible dans le vault (${(err as Error).message})`);
		}
		await this.sauver();
	}

	/** Écrit le PDF à son chemin actuel, ou le crée dans reMarkable/ la première fois. */
	private async ecrire(el: ElementTablette, octets: ArrayBuffer): Promise<string> {
		const { vault } = this.app;
		const actuel = this.registre.get(el.id)?.chemin;
		const fichier = actuel ? vault.getFileByPath(actuel) : null;
		if (fichier) {
			await vault.modifyBinary(fichier, octets);
			return fichier.path;
		}
		const nom = el.chemin.toLowerCase().endsWith('.pdf') ? el.chemin.slice(0, -4) : el.chemin;
		const chemin = this.cheminLibre(`${DOSSIER}/${nom}`);
		await this.creerDossiers(chemin);
		this.enEcriture.add(chemin);
		try {
			await vault.createBinary(chemin, octets);
		} finally {
			this.enEcriture.delete(chemin);
		}
		return chemin;
	}

	/** Le cœur ne crée aucun parent : on crée chaque niveau, un par un. */
	private async creerDossiers(chemin: string): Promise<void> {
		const segments = chemin.split('/').slice(0, -1);
		for (let i = 1; i <= segments.length; i++) {
			const dossier = segments.slice(0, i).join('/');
			if (!this.app.vault.getAbstractFileByPath(dossier)) await this.app.vault.createFolder(dossier);
		}
	}

	private cheminLibre(base: string): string {
		let chemin = `${base}.pdf`;
		for (let n = 2; this.app.vault.getAbstractFileByPath(chemin); n++) chemin = `${base} (${n}).pdf`;
		return chemin;
	}

	/**
	 * Reconnaît, parmi ces fichiers, le PDF d'un carnet qui n'a plus de chemin :
	 * même taille, puis même empreinte. C'est ainsi qu'un déplacement fait hors
	 * de l'app (delete puis create) garde son suivi. Renvoie vrai si l'index change.
	 */
	async retrouver(fichiers: TFile[], depuis?: number): Promise<boolean> {
		let change = false;
		for (const f of fichiers) {
			if (f.extension !== 'pdf' || this.enEcriture.has(f.path) || this.registre.parChemin(f.path)) continue;
			const ids = this.registre.candidats(f.stat.size, depuis);
			if (ids.length === 0) continue;
			const h = empreinte(await this.app.vault.readBinary(f));
			const id = ids.find((i) => this.registre.get(i)?.empreinte === h);
			if (!id) continue;
			this.registre.rattacher(id, f.path);
			this.log(`${f.path} : retrouvé, toujours suivi`);
			change = true;
		}
		return change;
	}

	/** Tout retélécharger au prochain tour (sauf les carnets ignorés). */
	toutRetelecharger(): void {
		for (const e of Object.values(this.registre.carnets)) if (!e.ignore) e.modifie = null;
	}
}
