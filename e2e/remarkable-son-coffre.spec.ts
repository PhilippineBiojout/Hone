import { test, expect, _electron } from '@playwright/test';
import { cp, mkdtemp, mkdir, readFile, writeFile } from 'fs/promises';
import * as net from 'net';
import os from 'os';
import path from 'path';
import { pdfDeTest } from './pdfFixture';

/**
 * Les commandes de reMarkable, dans l'app installée (/Applications/Fragment.app)
 * sur une copie complète de fragment-notes : une seule icône tablette et un seul
 * scan au ruban (Hone porte les deux), « reMarkable : sync » et « reMarkable :
 * show live status » dans la palette, et leurs cartes. La tablette pointe sur
 * une adresse morte : la copie ne télécharge rien.
 *
 * Se lance depuis Fragment/app (qui porte Playwright), après `npm run build` dans Hone :
 *     cp <ce fichier> ../../Fragment/app/e2e/ && npx playwright test e2e/remarkable-son-coffre.spec.ts --workers=1
 */

const CAPTURES = '/Users/philippinebiojout/Documents/IA/fragment-notes/.fragment/plugins/hone/test-results';

test('reMarkable : icônes uniques, commandes sync et show live status', async () => {
	test.setTimeout(120_000);
	const base = await mkdtemp(path.join(os.tmpdir(), 'remarkable-coffre-'));
	const vault = path.join(base, 'vault');
	const userData = path.join(base, 'userdata');
	await mkdir(userData, { recursive: true });
	await cp('/Users/philippinebiojout/Documents/IA/fragment-notes', vault, { recursive: true,
		filter: (src) => !src.includes('node_modules') && !src.includes('/.git') });
	const fichier = path.join(vault, '.fragment/plugins/hone/remarkable.json');
	const donnees = JSON.parse(await readFile(fichier, 'utf8'));
	await writeFile(fichier, JSON.stringify({ ...donnees, hote: 'http://127.0.0.1:9' }), 'utf8');
	await writeFile(path.join(userData, 'config.json'), JSON.stringify({ vaultRoot: vault }), 'utf8');

	const electronApp = await _electron.launch({
		executablePath: '/Applications/Fragment.app/Contents/MacOS/Fragment',
		args: [`--user-data-dir=${userData}`, `--vault-root=${vault}`],
		env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: process.env.HOME! } as Record<string, string>,
	});
	try {
		let page = electronApp.windows().find((w) => !w.url().startsWith('devtools'));
		while (!page) page = await electronApp.waitForEvent('window');
		await page.waitForFunction(() => !!(window as any).app?.workspace?.layoutReady, undefined, { timeout: 30_000 });
		await page.setViewportSize({ width: 1400, height: 800 });
		await page.waitForFunction(() => (window as any).app.commands.listCommands().some((c: any) => c.id === 'hone:remarkable-sync'), undefined, { timeout: 30_000 });

		// Une icône de chaque au ruban.
		await expect(page.locator('[aria-label="reMarkable"]')).toHaveCount(1);
		await expect(page.locator('[aria-label="Scanner une feuille"]')).toHaveCount(1);

		// La palette trouve les deux commandes en tapant « remar ».
		await page.keyboard.press('Meta+p');
		await page.keyboard.type('remar');
		await expect(page.getByText('show live status')).toBeVisible();
		await expect(page.getByText(/reMarkable : sync/)).toBeVisible();
		await page.screenshot({ path: `${CAPTURES}/remarkable-palette.png` });
		await page.keyboard.press('Escape');

		// sync : la carte, et « Couper » coupe la synchro.
		await page.evaluate(() => (window as any).app.commands.executeCommandById('hone:remarkable-sync'));
		await expect(page.getByText('La synchro de la reMarkable est active. La garder ?')).toBeVisible();
		await page.screenshot({ path: `${CAPTURES}/remarkable-sync.png` });
		await page.getByRole('button', { name: 'Couper' }).click();
		await expect.poll(async () => JSON.parse(await readFile(fichier, 'utf8')).autorise).toBe(false);
		await page.evaluate(() => (window as any).app.commands.executeCommandById('hone:remarkable-sync'));
		await expect(page.getByText('La synchro est coupée. La relancer ?')).toBeVisible();
		await page.getByRole('button', { name: 'Relancer' }).click();
		await expect.poll(async () => JSON.parse(await readFile(fichier, 'utf8')).autorise).toBe(true);

		// show live status : la carte, et « Masquer » le masque.
		await page.evaluate(() => (window as any).app.commands.executeCommandById('hone:remarkable-show-live-status'));
		await expect(page.getByText('Le statut live est affiché. Le garder ?')).toBeVisible();
		await page.screenshot({ path: `${CAPTURES}/remarkable-statut.png` });
		await page.getByRole('button', { name: 'Masquer' }).click();
		await expect.poll(async () => JSON.parse(await readFile(fichier, 'utf8')).statutLive).toBe(false);
	} finally {
		await electronApp.close();
	}
});

/**
 * Une mise à jour de la tablette sur un PDF ouvert : on lisait le milieu de la
 * page 5, la page 4 change, on reste au même endroit de la page 5, et le
 * défilement ne passe jamais par 0 pendant le rechargement. Une fausse
 * tablette minimale sert un PDF de 8 pages. Sans le layout du coffre, qui a ses propres PDF.
 */
test('reMarkable : une mise à jour garde la page qu’on lisait', async () => {
	test.setTimeout(120_000);
	const base = await mkdtemp(path.join(os.tmpdir(), 'remarkable-defilement-'));
	const vault = path.join(base, 'vault');
	const userData = path.join(base, 'userdata');
	await mkdir(userData, { recursive: true });
	await cp('/Users/philippinebiojout/Documents/IA/fragment-notes', vault, { recursive: true,
		filter: (src) => !src.includes('node_modules') && !src.includes('/.git') && !src.endsWith('.fragment/workspace.json') });

	// La fausse tablette : un seul document, 8 pages, `modifie` change à chaque écriture.
	const pages = Array.from({ length: 8 }, (_, i) => `page ${i + 1} version 1`);
	let modifie = 1;
	const serveur = net.createServer((s) => s.once('data', (d) => {
		const chemin = d.toString().split(' ')[1];
		const corps = chemin === '/documents/'
			? Buffer.from(JSON.stringify([{ ID: 'defil', VissibleName: 'E2E defilement', Type: 'DocumentType', ModifiedClient: String(modifie), fileType: 'pdf' }]))
			: chemin === '/download/defil/pdf' ? pdfDeTest({ pages }) : Buffer.from('[]');
		s.end(Buffer.concat([Buffer.from(`HTTP/1.1 200 OK\r\nContent-Length: ${corps.length}\r\nConnection: close\r\n\r\n`), corps]));
	}));
	await new Promise<void>((ok) => serveur.listen(0, '127.0.0.1', ok));
	const hote = `http://127.0.0.1:${(serveur.address() as net.AddressInfo).port}`;
	const ecrire = (version: number) => { pages[3] = `page 4 version ${version}`; modifie++; };

	const fichier = path.join(vault, '.fragment/plugins/hone/remarkable.json');
	await writeFile(fichier, JSON.stringify({ hote, autorise: true, statutLive: true, carnets: {} }), 'utf8');
	await writeFile(path.join(userData, 'config.json'), JSON.stringify({ vaultRoot: vault }), 'utf8');
	const pdf = path.join(vault, 'reMarkable/E2E defilement.pdf');

	const electronApp = await _electron.launch({
		executablePath: '/Applications/Fragment.app/Contents/MacOS/Fragment',
		args: [`--user-data-dir=${userData}`, `--vault-root=${vault}`],
		env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: process.env.HOME! } as Record<string, string>,
	});
	try {
		let page = electronApp.windows().find((w) => !w.url().startsWith('devtools'));
		while (!page) page = await electronApp.waitForEvent('window');
		await page.waitForFunction(() => !!(window as any).app?.workspace?.layoutReady, undefined, { timeout: 30_000 });
		await page.setViewportSize({ width: 1400, height: 800 });
		await expect.poll(async () => (await readFile(pdf, 'latin1').catch(() => '')).includes('page 4 version 1'), { timeout: 30_000 }).toBe(true);

		await page.evaluate(() => {
			const app = (window as any).app;
			return app.workspace.getLeaf('tab').openFile(app.vault.getFileByPath('reMarkable/E2E defilement.pdf'));
		});
		const vue = page.locator('.pdf-scroll:visible');
		await expect(vue.locator('.pdf-page')).toHaveCount(8, { timeout: 15_000 });
		await expect(page.locator('.status-bar-item.remarkable-statut')).toHaveText('Live');
		// Plus de bouton « live » ni d'icône débranchée en haut du PDF.
		await expect(page.locator('.view-actions .remarkable-statut, .view-actions svg.lucide-unplug')).toHaveCount(0);
		await expect(page.locator('.view-actions .view-action', { hasText: /live/i })).toHaveCount(0);

		// Au milieu de la page 5, puis un échantillon du défilement à chaque image.
		await vue.evaluate((el) => {
			const p5 = el.querySelector('.pdf-page[data-page="5"]')!.getBoundingClientRect();
			el.scrollTop += p5.top - el.getBoundingClientRect().top + p5.height / 2;
			const w = window as any;
			w.__min = Infinity;
			const echantillon = () => { w.__min = Math.min(w.__min, el.scrollTop); w.__raf = requestAnimationFrame(echantillon); };
			echantillon();
		});
		const position = () => vue.evaluate((el) => {
			const haut = el.getBoundingClientRect().top;
			const p = [...el.querySelectorAll<HTMLElement>('.pdf-page')].find((p) => p.getBoundingClientRect().bottom > haut)!;
			const w = window as any;
			const min = w.__min;
			w.__min = Infinity;
			return { page: Number(p.dataset.page), decalage: haut - p.getBoundingClientRect().top, scrollTop: el.scrollTop, min };
		});
		const page4 = vue.locator('.pdf-page[data-page="4"] .pdf-text-layer');
		await expect(page4).toContainText('page 4 version 1', { timeout: 15_000 });
		const avant = await position();
		expect(avant.page).toBe(5);

		const verifier = async (nom: string) => {
			await page.waitForTimeout(500);
			const apres = await position();
			console.log(nom, JSON.stringify({ avant, apres }));
			await page.screenshot({ path: `${CAPTURES}/remarkable-defilement-${nom}.png` });
			expect(apres.page).toBe(5);
			expect(Math.abs(apres.decalage - avant.decalage)).toBeLessThanOrEqual(2);
			expect(apres.min).toBeGreaterThan(0);
			expect(apres.min).toBeGreaterThanOrEqual(avant.scrollTop - 2);
		};

		// Une mise à jour : la page 4 change.
		ecrire(2);
		await expect(page4).toContainText('page 4 version 2', { timeout: 15_000 });
		await verifier('une');

		// Deux mises à jour rapprochées : la seconde arrive dès que la première est écrite.
		ecrire(3);
		await expect.poll(async () => (await readFile(pdf, 'latin1')).includes('page 4 version 3'), { timeout: 15_000 }).toBe(true);
		ecrire(4);
		await expect(page4).toContainText('page 4 version 4', { timeout: 15_000 });
		await verifier('deux');
	} finally {
		await electronApp.close();
		serveur.close();
	}
});

/**
 * Le statut suit ce qui est à l'écran, pas l'onglet actif : un PDF de la
 * tablette à gauche, une note active à droite, il reste ; un autre onglet
 * par-dessus le PDF, il part. La tablette pointe sur une adresse morte :
 * « Déconnectée » suffit. Sans le layout du coffre, qui a ses propres PDF.
 */
test('reMarkable : le statut reste tant que le PDF est affiché, même dans un autre panneau', async () => {
	test.setTimeout(120_000);
	const base = await mkdtemp(path.join(os.tmpdir(), 'remarkable-split-'));
	const vault = path.join(base, 'vault');
	const userData = path.join(base, 'userdata');
	await mkdir(userData, { recursive: true });
	await cp('/Users/philippinebiojout/Documents/IA/fragment-notes', vault, { recursive: true,
		filter: (src) => !src.includes('node_modules') && !src.includes('/.git') && !src.endsWith('.fragment/workspace.json') });
	const fichier = path.join(vault, '.fragment/plugins/hone/remarkable.json');
	const donnees = JSON.parse(await readFile(fichier, 'utf8'));
	await writeFile(fichier, JSON.stringify({ ...donnees, hote: 'http://127.0.0.1:9', autorise: true, statutLive: true }), 'utf8');
	await writeFile(path.join(userData, 'config.json'), JSON.stringify({ vaultRoot: vault }), 'utf8');

	const electronApp = await _electron.launch({
		executablePath: '/Applications/Fragment.app/Contents/MacOS/Fragment',
		args: [`--user-data-dir=${userData}`, `--vault-root=${vault}`],
		env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: process.env.HOME! } as Record<string, string>,
	});
	try {
		let page = electronApp.windows().find((w) => !w.url().startsWith('devtools'));
		while (!page) page = await electronApp.waitForEvent('window');
		await page.waitForFunction(() => !!(window as any).app?.workspace?.layoutReady, undefined, { timeout: 30_000 });
		await page.setViewportSize({ width: 1400, height: 800 });
		const statut = page.locator('.status-bar-item.remarkable-statut');

		// À gauche : une note, puis le PDF de la tablette par-dessus. À droite : une note, active.
		await page.evaluate(async () => {
			const app = (window as any).app;
			await app.workspace.getLeaf('tab').openFile(app.vault.getFileByPath('Lisez-moi.md'));
			await app.workspace.getLeaf('tab').openFile(app.vault.getFileByPath('reMarkable/AI/Hackathon/Notes XIA.pdf'));
			await app.workspace.getLeaf('split').openFile(app.vault.getFileByPath('Lisez-moi.md'), { active: true });
		});
		await expect.poll(() => page.evaluate(() => (window as any).app.workspace.activeLeaf?.getViewType())).toBe('markdown');
		await expect(statut).toHaveText('Déconnectée', { timeout: 15_000 });
		await expect(statut).toBeVisible();
		await page.screenshot({ path: `${CAPTURES}/remarkable-statut-split.png` });

		// À gauche, on clique l'onglet de la note : le PDF passe derrière, le statut part.
		await page.locator('.workspace-tab-header', { hasText: 'Lisez-moi' }).first().click();
		await expect(statut).toBeHidden();
		await page.screenshot({ path: `${CAPTURES}/remarkable-statut-cache.png` });
	} finally {
		await electronApp.close();
	}
});
