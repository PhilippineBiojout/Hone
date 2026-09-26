import { Plugin, TFile, type TAbstractFile } from 'fragment';
import { FENETRE_DEPLACEMENT_MS, Registre, type Carnets } from './registre';
import { Synchro } from './synchro';
import { HOTE_PAR_DEFAUT, Tablette } from './tablette';
import { VUE_REMARKABLE, VueRemarkable } from './vue';

/** Ce que le plugin garde dans `.fragment/plugins/remarkable/data.json`. */
interface Donnees {
	/** Adresse de la tablette ; un faux serveur pour tester sans elle. */
	hote: string;
	/** L'index : id du carnet sur la tablette → où est son PDF dans le vault. */
	carnets: Carnets;
}

const INTERVALLE_MS = 2000;

export default class RemarkablePlugin extends Plugin {
	registre = new Registre();
	synchro!: Synchro;
	private hote = HOTE_PAR_DEFAUT;
	/** PDF apparus récemment sans être suivis : un delete qui arrive après eux peut être un déplacement. */
	private apparus = new Map<string, number>();

	async onload(): Promise<void> {
		const lu = (await this.loadData()) as Partial<Donnees> | null;
		this.hote = lu?.hote ?? HOTE_PAR_DEFAUT;
		this.registre = new Registre(lu?.carnets ?? {});
		this.synchro = new Synchro(this.app, this.registre, new Tablette(this.hote), () => this.sauver(), () => this.redessiner());

		this.registerView(VUE_REMARKABLE, (leaf) => new VueRemarkable(leaf, this));
		this.addRibbonIcon('tablet', 'reMarkable', () => void this.ouvrirVue());
		this.addCommand({ id: 'ouvrir-vue', name: 'Ouvrir la vue reMarkable', callback: () => void this.ouvrirVue() });
		this.addCommand({ id: 'tout-retelecharger', name: 'Retélécharger tous les carnets suivis', callback: () => void this.toutRetelecharger() });

		this.registerEvent(this.app.vault.on('rename', (f, ancien) => void this.surRenommage(f, ancien)));
		this.registerEvent(this.app.vault.on('delete', (f) => void this.surSuppression(f)));
		this.registerEvent(this.app.vault.on('create', (f) => void this.surCreation(f)));

		// Le vault est chargé sans émettre d'événement : ce qui a bougé pendant
		// que Fragment était fermé se rattrape ici, avant la première synchro.
		this.app.workspace.onLayoutReady(async () => {
			await this.reconcilier();
			void this.synchro.tour();
			this.registerInterval(window.setInterval(() => void this.synchro.tour(), INTERVALLE_MS));
		});
	}

	async sauver(): Promise<void> {
		const donnees: Donnees = { hote: this.hote, carnets: this.registre.carnets };
		await this.saveData(donnees);
	}

	redessiner(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(VUE_REMARKABLE)) {
			if (leaf.view instanceof VueRemarkable) leaf.view.dessiner();
		}
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

	/** Dans l'app, un dossier renommé n'émet qu'un événement : le registre fait suivre les chemins dessous. */
	private async surRenommage(f: TAbstractFile, ancien: string): Promise<void> {
		if (this.registre.renommer(ancien, f.path)) await this.changer();
	}

	private async surSuppression(f: TAbstractFile): Promise<void> {
		const maintenant = Date.now();
		if (!this.registre.supprimer(f.path, maintenant)) return;
		// Hors de l'app, un déplacement arrive en delete + create, parfois create d'abord.
		const recents = [...this.apparus]
			.filter(([, t]) => maintenant - t < FENETRE_DEPLACEMENT_MS)
			.map(([p]) => this.app.vault.getFileByPath(p))
			.filter((x): x is TFile => x !== null);
		await this.synchro.retrouver(recents, maintenant - FENETRE_DEPLACEMENT_MS);
		await this.changer();
	}

	private async surCreation(f: TAbstractFile): Promise<void> {
		if (!(f instanceof TFile) || f.extension !== 'pdf') return;
		if (this.synchro.enEcriture.has(f.path) || this.registre.parChemin(f.path)) return;
		const maintenant = Date.now();
		for (const [p, t] of this.apparus) if (maintenant - t >= FENETRE_DEPLACEMENT_MS) this.apparus.delete(p);
		this.apparus.set(f.path, maintenant);
		if (await this.synchro.retrouver([f], maintenant - FENETRE_DEPLACEMENT_MS)) await this.changer();
	}

	/** Au démarrage : un PDF suivi introuvable est cherché ailleurs dans le vault, sinon il n'est plus suivi. */
	private async reconcilier(): Promise<void> {
		const debut = Date.now();
		let change = false;
		for (const e of Object.values(this.registre.carnets)) {
			if (e.chemin && !this.app.vault.getFileByPath(e.chemin)) change = this.registre.supprimer(e.chemin, debut) || change;
		}
		if (change) {
			await this.synchro.retrouver(this.app.vault.getFiles(), debut);
			await this.changer();
		}
	}

	/** Les carnets non suivis sous ce dossier de la tablette. */
	ignoresSous(dossierTablette: string): string[] {
		return this.synchro.elements
			.filter((el) => !el.dossier && el.chemin.startsWith(dossierTablette + '/'))
			.filter((el) => this.registre.get(el.id)?.ignore)
			.map((el) => el.id);
	}

	async recuperer(ids: string[]): Promise<void> {
		this.registre.recuperer(ids);
		await this.changer();
		void this.synchro.tour();
	}

	async toutRetelecharger(): Promise<void> {
		this.synchro.toutRetelecharger();
		await this.changer();
		void this.synchro.tour();
	}

	private async changer(): Promise<void> {
		await this.sauver();
		this.redessiner();
	}
}
