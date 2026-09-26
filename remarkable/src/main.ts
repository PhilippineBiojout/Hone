import { Plugin } from 'fragment';
import { Deplacements } from './deplacements';
import { Registre, type Entree } from './registre';
import { Synchro } from './synchro';
import { HOTE_PAR_DEFAUT, Tablette } from './tablette';
import { DemandeAutorisation } from './demande';
import { bulle, majEntetes } from './entete';

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
	registre!: Registre;
	synchro!: Synchro;
	private deplacements!: Deplacements;
	/** Rien n'est téléchargé tant que ce n'est pas `true`. */
	autorise: boolean | undefined;
	private hote = HOTE_PAR_DEFAUT;

	async onload(): Promise<void> {
		const lu = (await this.loadData()) as Partial<Donnees> | null;
		this.hote = lu?.hote ?? HOTE_PAR_DEFAUT;
		this.autorise = lu?.autorise;
		this.registre = new Registre(lu?.carnets);
		this.synchro = new Synchro(this.app, this.registre, new Tablette(this.hote), () => this.changer());
		this.deplacements = new Deplacements(this.app, this.registre);

		// Tant qu'on n'a pas accepté : la demande. Ensuite : l'état de la tablette.
		const icone = this.addRibbonIcon('tablet', 'reMarkable', () => {
			if (this.autorise) bulle(icone, this.synchro.connectee === true, true);
			else new DemandeAutorisation(this.app, icone, this.autorise === false, (oui) => void this.autoriser(oui)).open();
		});
		this.registerEvent(this.app.workspace.on('layout-change', () => majEntetes(this)));
		this.registerEvent(this.app.workspace.on('file-open', () => majEntetes(this)));

		this.registerEvent(this.app.vault.on('rename', async (f, ancien) => {
			// Dans l'app, un dossier renommé n'émet qu'un événement : le registre fait suivre ce qu'il contient.
			if (this.registre.renommer(ancien, f.path)) await this.changer();
		}));
		this.registerEvent(this.app.vault.on('delete', async (f) => {
			if (await this.deplacements.supprime(f.path)) await this.changer();
		}));
		this.registerEvent(this.app.vault.on('create', async (f) => {
			if (await this.deplacements.apparu(f)) await this.changer();
		}));

		this.app.workspace.onLayoutReady(async () => {
			await this.deplacements.auDemarrage();
			await this.changer();
			this.registerInterval(window.setInterval(() => {
				if (this.autorise) void this.synchro.tour();
			}, 2000));
		});
	}

	async autoriser(oui: boolean): Promise<void> {
		this.autorise = oui;
		await this.changer();
		if (oui) void this.synchro.tour();
	}

	/** Sauvegarde l'index et met à jour l'état en haut des PDF. */
	private async changer(): Promise<void> {
		await this.saveData({ hote: this.hote, autorise: this.autorise, carnets: this.registre.carnets } satisfies Donnees);
		majEntetes(this);
	}
}
