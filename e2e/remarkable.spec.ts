import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import { cp, mkdtemp, mkdir, readFile, rename, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import * as net from 'net';
import os from 'os';
import path from 'path';
import { pdfDeTest } from './pdfFixture';

/**
 * Le plugin reMarkable de bout en bout, contre une fausse tablette : première
 * synchro dans reMarkable/, mise à jour en direct, et le suivi d'un PDF qu'on
 * range ailleurs, qu'on supprime puis qu'on récupère.
 *
 * Se lance depuis Fragment, qui porte Playwright : copier ce fichier dans
 * `Fragment/app/e2e/`, `npm run build` dans le plugin, puis depuis `Fragment/app/`
 * (avec `npx vite` qui tourne) :
 *     npx playwright test e2e/remarkable.spec.ts --workers=1
 */

const PLUGIN = '/Users/philippinebiojout/Documents/IA/fragment-notes/.fragment/plugins/remarkable';

interface Doc { nom: string; parent: string; dossier: boolean; modifie: number; version: number }

/** Répond comme la vraie : Content-Length ET Transfer-Encoding: chunked. */
class FausseTablette {
	docs = new Map<string, Doc>();
	/** Carnets dont l'export ne répond jamais (comme phy430 sur la vraie), et combien de fois on l'a demandé. */
	enPanne = new Set<string>();
	demandes = new Map<string, number>();
	private horloge = 1;
	private serveur = net.createServer((s) => {
		s.once('data', (d) => {
			const chemin = d.toString().split(' ')[1];
			const id = chemin.match(/^\/download\/(.+)\/pdf$/)?.[1];
			if (id) this.demandes.set(id, (this.demandes.get(id) ?? 0) + 1);
			if (id && this.enPanne.has(id)) return; // on garde la connexion ouverte sans rien envoyer
			const corps = this.repondre(chemin);
			const statut = corps ? 200 : 404;
			const octets = corps ?? Buffer.alloc(0);
			s.write(`HTTP/1.1 ${statut} X\r\nContent-Length: ${octets.length}\r\nTransfer-Encoding: chunked\r\n\r\n${octets.length.toString(16)}\r\n`);
			s.end(Buffer.concat([octets, Buffer.from('\r\n0\r\n\r\n')]));
		});
	});

	async demarrer(): Promise<string> {
		await new Promise<void>((ok) => this.serveur.listen(0, '127.0.0.1', ok));
		return `http://127.0.0.1:${(this.serveur.address() as net.AddressInfo).port}`;
	}

	arreter(): void {
		this.serveur.close();
	}

	ajouter(id: string, nom: string, parent = '', dossier = false): void {
		this.docs.set(id, { nom, parent, dossier, modifie: this.horloge++, version: 1 });
	}

	/** Comme quand on écrit sur la tablette : nouvelle date, nouveau contenu. */
	ecrire(id: string): number {
		const d = this.docs.get(id)!;
		d.modifie = this.horloge++;
		return ++d.version;
	}

	private repondre(chemin: string): Buffer | null {
		const liste = chemin.match(/^\/documents\/(.*)$/);
		if (liste) {
			const items = [...this.docs].filter(([, d]) => d.parent === liste[1]).map(([id, d]) => ({
				ID: id, VissibleName: d.nom, Type: d.dossier ? 'CollectionType' : 'DocumentType', ModifiedClient: String(d.modifie),
			}));
			return Buffer.from(JSON.stringify(items));
		}
		const pdf = chemin.match(/^\/download\/(.+)\/pdf$/);
		const d = pdf && this.docs.get(pdf[1]);
		return d ? pdfDeTest({ pages: [`${pdf![1]} version ${d.version}`] }) : null;
	}
}

async function fenetreApp(electronApp: ElectronApplication): Promise<Page> {
	const fin = Date.now() + 30_000;
	while (Date.now() < fin) {
		for (const w of electronApp.windows()) if (w.url().includes('localhost:5123')) return w;
		await new Promise((r) => setTimeout(r, 200));
	}
	throw new Error('fenêtre app introuvable');
}

async function lancer(vault: string, userData: string): Promise<{ electronApp: ElectronApplication; page: Page }> {
	const electronApp = await _electron.launch({
		args: ['.', `--user-data-dir=${userData}`],
		env: { ...process.env, NODE_ENV: 'development' } as Record<string, string>,
	});
	const page = await fenetreApp(electronApp);
	await page.waitForFunction(() => !!(window as any).app?.plugins?.plugins?.get('remarkable'), undefined, { timeout: 30_000 });
	return { electronApp, page };
}

/** Attend que `test` soit vrai, en le relançant (la synchro tourne toutes les 2 s). */
async function attendre(test: () => Promise<boolean> | boolean, message: string, delai = 15_000): Promise<void> {
	const fin = Date.now() + delai;
	while (Date.now() < fin) {
		if (await test()) return;
		await new Promise((r) => setTimeout(r, 200));
	}
	throw new Error(`délai dépassé : ${message}`);
}

test('la tablette arrive dans le vault et chaque PDF reste suivi où qu’on le range', async () => {
	test.setTimeout(300_000);
	const base = await mkdtemp(path.join(os.tmpdir(), 'remarkable-'));
	const vault = path.join(base, 'vault');
	const userData = path.join(base, 'userdata');
	const dossierPlugin = path.join(vault, '.fragment/plugins/remarkable');
	await mkdir(vault, { recursive: true });
	await mkdir(userData, { recursive: true });
	await writeFile(path.join(vault, 'note.md'), '# Note', 'utf8');
	await cp(PLUGIN, dossierPlugin, { recursive: true, filter: (src) => !/node_modules|[\\/]data\.json$|[\\/]\.git$/.test(src) });
	await writeFile(path.join(userData, 'config.json'), JSON.stringify({ vaultRoot: vault }), 'utf8');

	const tablette = new FausseTablette();
	// Le plus ancien : la première synchro le prend en dernier.
	tablette.ajouter('p', 'En panne');
	tablette.enPanne.add('p');
	tablette.ajouter('d1', 'Cours', '', true);
	tablette.ajouter('a', 'A', 'd1');
	tablette.ajouter('b', 'B', 'd1');
	tablette.ajouter('c', 'C');
	tablette.ajouter('e', 'E');
	await writeFile(path.join(dossierPlugin, 'data.json'), JSON.stringify({ hote: await tablette.demarrer(), carnets: {} }), 'utf8');

	const v = (p: string) => path.join(vault, p);
	const contient = async (p: string, texte: string) => existsSync(v(p)) && (await readFile(v(p), 'latin1')).includes(texte);
	// data.json peut être lu pendant que le plugin l'écrit : on relira au tour suivant.
	const donnees = async () => {
		try {
			return JSON.parse(await readFile(path.join(dossierPlugin, 'data.json'), 'utf8')).carnets;
		} catch {
			return {};
		}
	};

	let { electronApp, page } = await lancer(vault, userData);
	try {
		// 1. Première synchro : tout dans reMarkable/, arborescence de la tablette.
		await attendre(() => contient('reMarkable/Cours/A.pdf', 'a version 1'), 'A importé');
		await attendre(() => contient('reMarkable/Cours/B.pdf', 'b version 1'), 'B importé');
		await attendre(() => contient('reMarkable/C.pdf', 'c version 1'), 'C importé');

		// Un export qui ne répond jamais bloque la boucle une fois (délai de 60 s),
		// puis n'est plus redemandé : le carnet où l'on écrit repasse en 2 s.
		await attendre(() => tablette.demandes.get('p') === 1, 'export en panne demandé');
		await new Promise((r) => setTimeout(r, 65_000));
		tablette.ecrire('e');
		await attendre(() => contient('reMarkable/E.pdf', 'e version 2'), 'E mis à jour malgré le carnet en panne', 8000);
		expect(tablette.demandes.get('p')).toBe(1);

		// 2. On écrit sur la tablette : le PDF se met à jour sur place.
		// Et un onglet déjà ouvert sur ce PDF montre la nouvelle version, sans le rouvrir.
		await page.evaluate(() => {
			const app = (window as any).app;
			return app.workspace.getLeaf('tab').openFile(app.vault.getFileByPath('reMarkable/Cours/A.pdf'));
		});
		const couche = page.locator('.pdf-text-layer').first();
		await expect(couche).toContainText('a version 1', { timeout: 15_000 });
		tablette.ecrire('a');
		await attendre(() => contient('reMarkable/Cours/A.pdf', 'a version 2'), 'A mis à jour');
		await expect(couche).toContainText('a version 2', { timeout: 15_000 });

		// 3. Rangé ailleurs depuis le Finder (delete + create) : toujours suivi.
		await mkdir(v('Rangement'));
		await attendre(() => page.evaluate(() => !!(window as any).app.vault.getFolderByPath('Rangement')), 'dossier vu');
		await rename(v('reMarkable/Cours/A.pdf'), v('Rangement/A.pdf'));
		await attendre(async () => (await donnees()).a?.chemin === 'Rangement/A.pdf', 'A retrouvé après déplacement');
		tablette.ecrire('a');
		await attendre(() => contient('Rangement/A.pdf', 'a version 3'), 'A mis à jour à son nouvel endroit');
		expect(existsSync(v('reMarkable/Cours/A.pdf'))).toBe(false);

		// 4. Dossier renommé dans l'app : un seul événement, les enfants suivent.
		await page.evaluate(() => {
			const app = (window as any).app;
			return app.vault.rename(app.vault.getFolderByPath('reMarkable/Cours'), 'reMarkable/Classe');
		});
		await attendre(async () => (await donnees()).b?.chemin === 'reMarkable/Classe/B.pdf', 'B suit le dossier');
		tablette.ecrire('b');
		await attendre(() => contient('reMarkable/Classe/B.pdf', 'b version 2'), 'B mis à jour dans le dossier renommé');

		// 5. Supprimé dans l'app : plus suivi, jamais recréé.
		await page.evaluate(() => {
			const app = (window as any).app;
			return app.vault.trash(app.vault.getFileByPath('reMarkable/C.pdf'), false);
		});
		await attendre(async () => (await donnees()).c?.ignore === true, 'C ignoré');
		tablette.ecrire('c');
		await new Promise((r) => setTimeout(r, 5000));
		expect(existsSync(v('reMarkable/C.pdf'))).toBe(false);

		// 6. Récupéré depuis la vue.
		await page.evaluate(() => (window as any).app.plugins.plugins.get('remarkable').ouvrirVue());
		await page.locator('.remarkable-recuperer[aria-label="Récupérer"]').click();
		await attendre(() => contient('reMarkable/C.pdf', 'c version 2'), 'C récupéré, dernière version');

		// 7. Un dossier entier supprimé puis récupéré : il revient à sa place sur la tablette.
		await page.evaluate(() => {
			const app = (window as any).app;
			return app.vault.trash(app.vault.getFolderByPath('reMarkable/Classe'), false);
		});
		await attendre(async () => (await donnees()).b?.ignore === true, 'B ignoré avec son dossier');
		await page.locator('.remarkable-recuperer[aria-label^="Récupérer le dossier"]').click();
		await attendre(() => contient('reMarkable/Cours/B.pdf', 'b version 2'), 'dossier récupéré');

		// 8. Renommé sur la tablette : le vault ne bouge pas.
		tablette.docs.get('a')!.nom = 'A renommé';
		tablette.ecrire('a');
		await attendre(() => contient('Rangement/A.pdf', 'a version 4'), 'A mis à jour malgré le renommage tablette');
		expect(existsSync(v('reMarkable/Cours/A renommé.pdf'))).toBe(false);

		// 9. Déplacé pendant que Fragment est fermé : retrouvé au démarrage.
		await electronApp.close();
		await mkdir(v('Archive'));
		await rename(v('Rangement/A.pdf'), v('Archive/A.pdf'));
		({ electronApp, page } = await lancer(vault, userData));
		await attendre(async () => (await donnees()).a?.chemin === 'Archive/A.pdf', 'A retrouvé au démarrage');
		tablette.ecrire('a');
		await attendre(() => contient('Archive/A.pdf', 'a version 5'), 'A mis à jour après redémarrage');
	} finally {
		await electronApp.close();
		tablette.arreter();
	}
});
