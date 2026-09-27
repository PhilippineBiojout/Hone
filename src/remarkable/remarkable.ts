import { FileView, type App, type Plugin } from 'fragment';
import { Registre, type Entree } from './registre';
import { Synchro } from './synchro';
import { HOTE_PAR_DEFAUT, Tablette } from './tablette';
import { DemandeAutorisation, type Question } from './demande';
import { bulle } from './statut';

// Les carnets de la reMarkable en direct dans le vault, en PDF (voir README).
// Retrait : ce dossier, l'appel dans main.ts, la section de styles.css.

// La barre d'état est dans le cœur (Plugin.addStatusBarItem) mais pas encore
// dans le paquet publié : à retirer quand @usefragment/core l'aura.
declare module '@usefragment/core' {
	interface Plugin {
		addStatusBarItem(): HTMLElement;
	}
}

/** Ce que reMarkable garde dans `remarkable.json`, à côté du data.json de Hone. */
interface Donnees {
	/** Adresse de la tablette ; un faux serveur pour tester sans elle. */
	hote: string;
	/** Synchro active ou coupée ; absente, elle est active. */
	autorise?: boolean;
	/** Le statut dans la barre d'état ; absent, il est affiché. */
	statutLive?: boolean;
	/** L'index : id du document sur la tablette → où est son PDF dans reMarkable/. */
	carnets: Record<string, Entree>;
}

/** Branche la tablette sur le plugin : icône du ruban, statut, commandes, synchro toutes les 2 s. */
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
	/** Active d'office ; rien n'est téléchargé quand c'est `false`. */
	autorise: boolean;
	/** Le statut dans la barre d'état, affiché d'office. */
	statutLive: boolean;
	private statut!: HTMLElement;
	private hote: string;

	constructor(readonly app: App, lu: Partial<Donnees> | null, private ecrire: (d: Donnees) => Promise<void>) {
		this.hote = lu?.hote ?? HOTE_PAR_DEFAUT;
		this.autorise = lu?.autorise ?? true;
		this.statutLive = lu?.statutLive ?? true;
		this.registre = new Registre(lu?.carnets);
		this.synchro = new Synchro(app, this.registre, new Tablette(this.hote), () => this.changer());
	}

	brancher(plugin: Plugin): void {
		// « Live » ou « Déconnectée » dans la barre d'état du cœur ; au clic, ce qu'il faut faire.
		this.statut = plugin.addStatusBarItem();
		this.statut.classList.add('remarkable-statut');
		this.statut.addEventListener('click', () => bulle(this.statut, this.synchro.etat, 'dessus'));
		// « Fragment <version> », posé par le plugin interne `app` : caché, il ne reste que le statut.
		const version = this.app.statusBarItems.entries().filter((e) => e.owner === 'app').map((e) => (e.value as { el: HTMLElement }).el);
		for (const el of version) el.hidden = true;
		plugin.register(() => { for (const el of version) el.hidden = false; });
		// Le statut se montre tant qu'un PDF de la tablette est à l'écran, dans n'importe quel panneau.
		plugin.registerEvent(this.app.workspace.on('active-leaf-change', () => this.majStatut()));
		plugin.registerEvent(this.app.workspace.on('file-open', () => this.majStatut()));
		plugin.registerEvent(this.app.workspace.on('layout-change', () => this.majStatut()));
		// Changer d'onglet au clic sur son en-tête n'émet aucun événement du workspace.
		plugin.registerDomEvent(document, 'click', () => this.majStatut());

		// Synchro coupée : la demande. Active : l'état de la tablette.
		const icone = plugin.addRibbonIcon('tablet', 'reMarkable', () => {
			if (this.autorise) bulle(icone, this.synchro.etat, 'droite');
			else demander('rappel', (oui) => this.autoriser(oui));
		});
		const demander = (question: Question, repondre: (oui: boolean) => Promise<void>): void =>
			new DemandeAutorisation(this.app, icone, question, (oui) => void repondre(oui)).open();
		// La seule façon de couper la synchro, ou de la relancer : « reMarkable : sync » dans la palette.
		plugin.addCommand({
			id: 'remarkable-sync',
			name: 'reMarkable : sync',
			icon: 'tablet',
			callback: () => demander(this.autorise ? 'active' : 'coupee', (oui) => this.autoriser(oui)),
		});
		plugin.addCommand({
			id: 'remarkable-show-live-status',
			name: 'reMarkable : show live status',
			icon: 'tablet',
			callback: () => demander(this.statutLive ? 'affiche' : 'masque', (oui) => this.afficherStatut(oui)),
		});

		this.app.workspace.onLayoutReady(async () => {
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

	async afficherStatut(oui: boolean): Promise<void> {
		this.statutLive = oui;
		await this.changer();
	}

	/** Sauvegarde l'index et met à jour le statut. */
	private async changer(): Promise<void> {
		await this.ecrire({ hote: this.hote, autorise: this.autorise, statutLive: this.statutLive, carnets: this.registre.carnets });
		this.majStatut();
	}

	/** « Live » ou « Déconnectée », seulement si un PDF de la tablette est affiché (onglet visible de son panneau). */
	private majStatut(): void {
		const etat = this.synchro.etat;
		this.statut.textContent = etat === 'live' ? 'Live' : 'Déconnectée';
		this.statut.dataset.etat = etat ?? '';
		const affiche = this.app.workspace.getLeavesOfType('pdf').some((leaf) => leaf.containerEl.offsetParent !== null
			&& leaf.view instanceof FileView && leaf.view.file && this.registre.suivi(leaf.view.file.path));
		this.statut.hidden = !(this.autorise && this.statutLive && etat && affiche);
	}
}
