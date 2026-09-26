import type { App, Plugin } from 'fragment';
import { Deplacements } from './deplacements';
import { Registre, type Entree } from './registre';
import { Synchro } from './synchro';
import { HOTE_PAR_DEFAUT, Tablette } from './tablette';
import { DemandeAutorisation } from './demande';
import { bulle, majEntetes } from './entete';

// Les carnets de la reMarkable en direct dans le vault, en PDF (voir README).
// Retrait : ce dossier, l'appel dans main.ts, la section de styles.css.

/** Ce que reMarkable garde dans `remarkable.json`, à côté du data.json de Hone. */
interface Donnees {
	/** Adresse de la tablette ; un faux serveur pour tester sans elle. */
	hote: string;
	/** La réponse à la demande d'autorisation ; absente tant qu'on n'a pas répondu. */
	autorise?: boolean;
	/** L'index : id du carnet sur la tablette → où est son PDF dans le vault. */
	carnets: Record<string, Entree>;
}

/** Branche la tablette sur le plugin : icône du ruban, suivi des PDF, synchro toutes les 2 s. */
export async function brancherRemarkable(plugin: Plugin): Promise<void> {
	const adapter = plugin.app.vault.adapter;
	const fichier = `${plugin.app.plugins.pluginsDir}/${plugin.manifest.id}/remarkable.json`;
	const lu = (await adapter.exists(fichier)) ? (JSON.parse(await adapter.read(fichier)) as Partial<Donnees>) : null;
	const remarkable = new Remarkable(plugin.app, lu, (d) => adapter.write(fichier, JSON.stringify(d, null, 2)));
	remarkable.brancher(plugin);
}

export class Remarkable {
	registre: Registre;
	synchro: Synchro;
	private deplacements: Deplacements;
	/** Rien n'est téléchargé tant que ce n'est pas `true`. */
	autorise: boolean | undefined;
	private hote: string;

	constructor(readonly app: App, lu: Partial<Donnees> | null, private ecrire: (d: Donnees) => Promise<void>) {
		this.hote = lu?.hote ?? HOTE_PAR_DEFAUT;
		this.autorise = lu?.autorise;
		this.registre = new Registre(lu?.carnets);
		this.synchro = new Synchro(app, this.registre, new Tablette(this.hote), () => this.changer());
		this.deplacements = new Deplacements(app, this.registre);
	}

	brancher(plugin: Plugin): void {
		// Tant qu'on n'a pas accepté : la demande. Ensuite : l'état de la tablette.
		const icone = plugin.addRibbonIcon('tablet', 'reMarkable', () => {
			if (this.autorise) bulle(icone, this.synchro.connectee === true, true);
			else new DemandeAutorisation(this.app, icone, this.autorise === false, (oui) => void this.autoriser(oui)).open();
		});
		plugin.registerEvent(this.app.workspace.on('layout-change', () => majEntetes(this)));
		plugin.registerEvent(this.app.workspace.on('file-open', () => majEntetes(this)));

		plugin.registerEvent(this.app.vault.on('rename', async (f, ancien) => {
			// Dans l'app, un dossier renommé n'émet qu'un événement : le registre fait suivre ce qu'il contient.
			if (this.registre.renommer(ancien, f.path)) await this.changer();
		}));
		plugin.registerEvent(this.app.vault.on('delete', async (f) => {
			if (await this.deplacements.supprime(f.path)) await this.changer();
		}));
		plugin.registerEvent(this.app.vault.on('create', async (f) => {
			if (await this.deplacements.apparu(f)) await this.changer();
		}));

		this.app.workspace.onLayoutReady(async () => {
			await this.deplacements.auDemarrage();
			await this.changer();
			plugin.registerInterval(window.setInterval(() => {
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
		await this.ecrire({ hote: this.hote, autorise: this.autorise, carnets: this.registre.carnets });
		majEntetes(this);
	}
}
