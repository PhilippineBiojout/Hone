import { Plugin, TFile, type TAbstractFile } from 'fragment';
import { FENETRE_DEPLACEMENT_MS, Registre, type Entree } from './registre';
import { Synchro } from './synchro';
import { HOTE_PAR_DEFAUT, Tablette } from './tablette';
import { majEntetes } from './entete';
import { DemandeAutorisation, VUE_REMARKABLE, VueRemarkable } from './vue';

/** Ce que le plugin garde dans `.fragment/plugins/remarkable/data.json`. */
interface Donnees {
	/** Adresse de la tablette ; un faux serveur pour tester sans elle. */
	hote: string;
	/** La réponse à la demande d'autorisation ; absente tant qu'on n'a pas répondu. */
	autorise?: boolean;
	/** L'index : id du carnet sur la tablette → où est son PDF dans le vault. */
	carnets: Record<string, Entree>;
}

export default class RemarkablePlugin extends Plugin {
	registre = new Registre();
	synchro!: Synchro;
	/** Rien n'est téléchargé tant que ce n'est pas `true`. */
	autorise: boolean | undefined;
	private hote = HOTE_PAR_DEFAUT;
	/** PDF non suivis apparus récemment : avec un delete proche, c'est peut-être un déplacement. */
	private apparus = new Map<string, number>();

	async onload(): Promise<void> {
		const lu = (await this.loadData()) as Partial<Donnees> | null;
		this.hote = lu?.hote ?? HOTE_PAR_DEFAUT;
		this.autorise = lu?.autorise;
		this.registre = new Registre(lu?.carnets);
		this.synchro = new Synchro(this.app, this.registre, new Tablette(this.hote), () => this.changer());

		this.registerView(VUE_REMARKABLE, (leaf) => new VueRemarkable(leaf, this));
		// Premier clic : la demande d'autorisation. Ensuite, la vue.
		const icone = this.addRibbonIcon('tablet', 'reMarkable', () => {
			if (this.autorise === undefined) new DemandeAutorisation(this.app, icone, (oui) => void this.autoriser(oui)).open();
			else void this.ouvrirVue();
		});
		this.registerEvent(this.app.workspace.on('layout-change', () => majEntetes(this)));
		this.registerEvent(this.app.workspace.on('file-open', () => majEntetes(this)));

		this.registerEvent(this.app.vault.on('rename', async (f, ancien) => {
			// Dans l'app, un dossier renommé n'émet qu'un événement : le registre fait suivre ce qu'il contient.
			if (this.registre.renommer(ancien, f.path)) await this.changer();
		}));
		this.registerEvent(this.app.vault.on('delete', async (f) => {
			if (!this.registre.supprimer(f.path, Date.now())) return;
			await this.retrouverDeplaces();
			await this.changer();
		}));
		this.registerEvent(this.app.vault.on('create', async (f) => {
			if (!estPdf(f) || this.registre.suivi(f.path)) return;
			this.apparus.set(f.path, Date.now());
			await this.retrouverDeplaces();
			await this.changer();
		}));

		this.app.workspace.onLayoutReady(async () => {
			await this.reconcilier();
			this.registerInterval(window.setInterval(() => {
				if (this.autorise) void this.synchro.tour();
			}, 2000));
		});
	}

	/**
	 * Hors de l'app (Finder, git), un déplacement arrive en delete + create,
	 * dans un ordre ou dans l'autre : on essaie à chacun des deux.
	 */
	private async retrouverDeplaces(): Promise<void> {
		const depuis = Date.now() - FENETRE_DEPLACEMENT_MS;
		for (const [chemin, t] of this.apparus) if (t < depuis) this.apparus.delete(chemin);
		const fichiers = [...this.apparus.keys()].map((p) => this.app.vault.getFileByPath(p)).filter((f) => f !== null);
		await this.synchro.retrouver(fichiers, depuis);
	}

	/**
	 * Le vault se charge sans émettre d'événement : ce qui a bougé pendant que
	 * Fragment était fermé se rattrape ici. Un PDF suivi introuvable est cherché
	 * ailleurs dans le vault ; sinon il n'est plus suivi.
	 */
	private async reconcilier(): Promise<void> {
		const debut = Date.now();
		for (const e of Object.values(this.registre.carnets)) {
			if (e.chemin && !this.app.vault.getFileByPath(e.chemin)) this.registre.supprimer(e.chemin, debut);
		}
		await this.synchro.retrouver(this.app.vault.getFiles(), debut);
		await this.changer();
	}

	async ouvrirVue(): Promise<void> {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(VUE_REMARKABLE)[0];
		if (!leaf) {
			leaf = workspace.getLeftLeaf();
			await leaf.setViewState({ type: VUE_REMARKABLE, active: true });
		}
		workspace.setActiveLeaf(leaf);
	}

	async autoriser(oui: boolean): Promise<void> {
		this.autorise = oui;
		await this.changer();
		await this.ouvrirVue();
		if (oui) void this.synchro.tour();
	}

	async recuperer(ids: string[]): Promise<void> {
		this.registre.recuperer(ids);
		await this.changer();
		void this.synchro.tour();
	}

	/** Sauvegarde l'index, redessine la vue et l'état en haut des PDF. */
	private async changer(): Promise<void> {
		await this.saveData({ hote: this.hote, autorise: this.autorise, carnets: this.registre.carnets } satisfies Donnees);
		majEntetes(this);
		for (const leaf of this.app.workspace.getLeavesOfType(VUE_REMARKABLE)) {
			if (leaf.view instanceof VueRemarkable) leaf.view.dessiner();
		}
	}
}

function estPdf(f: TAbstractFile): f is TFile {
	return f instanceof TFile && f.extension === 'pdf';
}
