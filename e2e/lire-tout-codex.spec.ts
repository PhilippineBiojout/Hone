import { test, expect, _electron } from '@playwright/test';
import { cp, mkdtemp, mkdir, readFile, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

/**
 * Codex lit tout le document, même un carnet reMarkable écrit à la main. On entoure
 * seulement le titre de « DM Phy Q » et on pose une question sur le reste de la page :
 * Codex doit aller lire le PDF (read_document rend ses pages en image) au lieu de
 * demander une capture. App installée, copie du coffre « cours 2A », vrai Codex.
 *
 * Se lance depuis Fragment-main/app, après `npm run build` dans Hone :
 *     cp <ce fichier> ../../Fragment-main/app/e2e/hone-lire-tout-codex.spec.ts && npx playwright test e2e/hone-lire-tout-codex.spec.ts --workers=1
 */

const CAPTURES = '/Users/philippinebiojout/Documents/IA/fragment-notes/.fragment/plugins/hone/test-results';
const COFFRE = '/Users/philippinebiojout/Documents/polytechnique/cours 2A';
const CARNET = 'reMarkable/Cours 2A/P1/PHY_41030/DM Phy Q.pdf';

test('Hone : un cercle sur le titre, et Codex lit le reste du carnet', async () => {
	test.setTimeout(420_000);
	const base = await mkdtemp(path.join(os.tmpdir(), 'hone-lire-tout-'));
	const vault = path.join(base, 'vault');
	const userData = path.join(base, 'userdata');
	await mkdir(userData, { recursive: true });
	await cp(COFFRE, vault, { recursive: true,
		filter: (src) => !src.includes('node_modules') && !src.includes('/.git') && !src.endsWith('.fragment/workspace.json') });
	// Le build du jour, pas celui du coffre.
	await cp('/Users/philippinebiojout/Documents/IA/fragment-notes/.fragment/plugins/hone/main.js', path.join(vault, '.fragment/plugins/hone/main.js'));
	// Pas de tablette : la synchro reste coupée.
	await writeFile(path.join(vault, '.fragment/plugins/hone/remarkable.json'),
		JSON.stringify({ hote: 'http://127.0.0.1:9', autorise: false, statutLive: true, carnets: {} }), 'utf8');
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
		await page.setViewportSize({ width: 1400, height: 900 });
		await page.waitForFunction(() => !!(window as any).app.commands.findCommand('hone:open-codex-panel'), undefined, { timeout: 30_000 });

		await page.evaluate(async (chemin) => {
			const app = (window as any).app;
			await app.workspace.getLeaf('tab').openFile(app.vault.getFileByPath(chemin));
			app.workspace.getLeavesOfType('pdf').find((l: any) => l.view.file?.path === chemin).view.toggleLayer('annotation');
		}, CARNET);
		const canvas = page.locator('.pdf-scroll:visible .pdf-page canvas').first();
		await expect(canvas).toBeVisible({ timeout: 15_000 });

		// Le titre seulement : l'encre des 12 % du haut de la page.
		const titre = await canvas.evaluate((c: HTMLCanvasElement) => {
			const g = c.getContext('2d')!;
			const h = Math.floor(c.height * 0.12);
			const d = g.getImageData(0, 0, c.width, h).data;
			let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
			for (let y = 0; y < h; y += 2) for (let x = 0; x < c.width; x += 2) {
				const i = (y * c.width + x) * 4;
				if (d[i] + d[i + 1] + d[i + 2] < 200) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
			}
			const r = c.getBoundingClientRect();
			const k = r.width / c.width;
			return { left: r.left + x0 * k, top: r.top + y0 * k, right: r.left + x1 * k, bottom: r.top + y1 * k };
		});
		expect(titre.right).toBeGreaterThan(titre.left);

		await page.locator('.toolbar-item[aria-label="Crayon"]:visible').first().click();
		const cx = (titre.left + titre.right) / 2;
		const cy = (titre.top + titre.bottom) / 2;
		const rx = (titre.right - titre.left) / 2 + 20;
		const ry = (titre.bottom - titre.top) / 2 + 14;
		await page.mouse.move(cx + rx, cy);
		await page.mouse.down();
		for (let i = 1; i <= 40; i++) {
			const a = (2 * Math.PI * i) / 40;
			await page.mouse.move(cx + rx * Math.cos(a), cy + ry * Math.sin(a));
		}
		await page.mouse.up();

		const barre = page.locator('.agent-barre');
		await expect(barre).toBeVisible({ timeout: 5_000 });
		await barre.locator('[aria-label="Discuter avec Hone"]').click();
		const bulle = page.locator('.agent-bulle');
		await expect(bulle).toBeVisible();
		await bulle.locator('.agent-bulle-champ').fill('Que dit la question 2 de ce devoir, et quelle conclusion la question 1 tire-t-elle sur n\' ?');
		await bulle.locator('.agent-bulle-champ').press('Enter');
		const reponse = bulle.locator('.agent-message.mod-agent').last();
		await expect(reponse).not.toHaveClass(/is-pending/, { timeout: 300_000 });
		await expect(reponse).not.toHaveClass(/is-error/);
		const texte = (await reponse.textContent())!;
		console.log('REPONSE', texte);

		// La mémoire note les outils de l'échange : Codex est allé lire le carnet.
		await expect.poll(async () => (await readFile(path.join(vault, '.fragment/plugins/hone/memoire.jsonl'), 'utf8').catch(() => '')).includes('read_document'), { timeout: 10_000 }).toBe(true);
		expect(texte).not.toMatch(/capture|envoie|joins/i);
		expect(texte).toMatch(/radiale/i);
		expect(texte).toMatch(/n\s*['’′]\s*=\s*0|nul/i);
		await page.waitForTimeout(600);
		await page.screenshot({ path: `${CAPTURES}/hone-lire-tout.png` });
	} finally {
		await electronApp.close();
	}
});
