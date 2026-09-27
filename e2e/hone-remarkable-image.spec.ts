import { test, expect, _electron } from '@playwright/test';
import { cp, mkdtemp, mkdir, writeFile, readdir } from 'fs/promises';
import os from 'os';
import path from 'path';

/**
 * Un carnet reMarkable écrit à la main n'a pas de texte : un cercle au crayon autour
 * de l'écriture fait quand même sortir la barre, la zone part en image, et le vrai
 * Codex lit l'écriture pour Définir. App installée, copie du coffre « cours 2A ».
 *
 * Se lance depuis Fragment-main/app, après `npm run build` dans Hone :
 *     cp <ce fichier> ../../Fragment-main/app/e2e/ && npx playwright test e2e/hone-remarkable-image.spec.ts --workers=1
 */

const CAPTURES = '/Users/philippinebiojout/Documents/IA/fragment-notes/.fragment/plugins/hone/test-results';
const COFFRE = '/Users/philippinebiojout/Documents/polytechnique/cours 2A';
const CARNET = 'reMarkable/AI/Hackathon/Notes XIA.pdf';

test('Hone : un cercle sur un carnet manuscrit part en image, et Codex le lit', async () => {
	test.setTimeout(300_000);
	const base = await mkdtemp(path.join(os.tmpdir(), 'hone-rm-image-'));
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
		// Aucun texte sous l'écriture : c'est tout le problème.
		expect(await page.locator('.pdf-scroll:visible .pdf-text-layer span').count()).toBe(0);

		// Le haut de la première page, là où le carnet commence : la boîte de l'encre la plus sombre.
		const encre = await canvas.evaluate((c: HTMLCanvasElement) => {
			const g = c.getContext('2d')!;
			const h = Math.floor(c.height * 0.25);
			const d = g.getImageData(0, 0, c.width, h).data;
			let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
			for (let y = 0; y < h; y += 2) for (let x = 0; x < c.width; x += 2) {
				const i = (y * c.width + x) * 4;
				if (d[i] + d[i + 1] + d[i + 2] < 200) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
			}
			const r = c.getBoundingClientRect();
			const k = r.width / c.width;
			// La première ligne d'écriture seulement : 60 px CSS sous le premier trait.
			return { left: r.left + x0 * k, top: r.top + y0 * k, right: r.left + Math.min(x1 * k, 360), bottom: r.top + Math.min(y1 * k, y0 * k + 60) };
		});
		expect(encre.right).toBeGreaterThan(encre.left);

		await page.locator('.toolbar-item[aria-label="Crayon"]:visible').first().click();
		const cx = (encre.left + encre.right) / 2;
		const cy = (encre.top + encre.bottom) / 2;
		const rx = (encre.right - encre.left) / 2 + 20;
		const ry = (encre.bottom - encre.top) / 2 + 14;
		await page.mouse.move(cx + rx, cy);
		await page.mouse.down();
		for (let i = 1; i <= 40; i++) {
			const a = (2 * Math.PI * i) / 40;
			await page.mouse.move(cx + rx * Math.cos(a), cy + ry * Math.sin(a));
		}
		await page.mouse.up();

		const barre = page.locator('.agent-barre');
		await expect(barre).toBeVisible({ timeout: 5_000 });
		await page.screenshot({ path: `${CAPTURES}/hone-rm-image-barre.png` });
		const captures = await readdir(path.join(vault, '.fragment/plugins/hone/images'));
		expect(captures.length).toBeGreaterThan(0);
		await cp(path.join(vault, '.fragment/plugins/hone/images', captures.at(-1)!), `${CAPTURES}/hone-rm-image-zone.png`);

		await barre.locator('[aria-label="Définir"]').click();
		const corps = page.locator('.agent-action-carte .agent-action-corps');
		await expect.poll(async () => (await corps.textContent())?.trim().length ?? 0, { timeout: 240_000 }).toBeGreaterThan(20);
		const reponse = (await corps.textContent())!;
		console.log('DEFINIR', reponse);
		expect(reponse).not.toMatch(/n'a pas pu répondre|factice|illisible/i);
		await page.waitForTimeout(600);
		await page.screenshot({ path: `${CAPTURES}/hone-rm-image-carte.png` });
	} finally {
		await electronApp.close();
	}
});

const DEVOIR = '/Users/philippinebiojout/Documents/polytechnique/cours 2A/P1/PHY_41030_EP/phy430_x20_dm4.pdf';

test('Hone : sur un PDF à texte, la zone part aussi en image, avec le texte', async () => {
	test.setTimeout(300_000);
	const base = await mkdtemp(path.join(os.tmpdir(), 'hone-pdf-image-'));
	const vault = path.join(base, 'vault');
	const userData = path.join(base, 'userdata');
	await mkdir(userData, { recursive: true });
	await cp(COFFRE, vault, { recursive: true,
		filter: (src) => !src.includes('node_modules') && !src.includes('/.git') && !src.endsWith('.fragment/workspace.json') });
	await cp('/Users/philippinebiojout/Documents/IA/fragment-notes/.fragment/plugins/hone/main.js', path.join(vault, '.fragment/plugins/hone/main.js'));
	await cp(DEVOIR, path.join(vault, 'devoir.pdf'));
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
		await page.evaluate(async () => {
			const app = (window as any).app;
			await app.workspace.getLeaf('tab').openFile(app.vault.getFileByPath('devoir.pdf'));
			app.workspace.getLeavesOfType('pdf').find((l: any) => l.view.file?.path === 'devoir.pdf').view.toggleLayer('annotation');
		});
		const mot = page.locator('.pdf-scroll:visible .pdf-text-layer span', { hasText: 'Expliquer' }).first();
		await expect(mot).toBeVisible({ timeout: 15_000 });
		await page.locator('.toolbar-item[aria-label="Surligneur"]:visible').first().click();
		const b = (await mot.boundingBox())!;
		const y = b.y + b.height / 2;
		await page.mouse.move(b.x + 2, y);
		await page.mouse.down();
		for (let i = 1; i <= 10; i++) await page.mouse.move(b.x + 2 + ((b.width * 2) * i) / 10, y);
		await page.mouse.up();

		const barre = page.locator('.agent-barre');
		await expect(barre).toBeVisible({ timeout: 5_000 });
		const captures = await readdir(path.join(vault, '.fragment/plugins/hone/images'));
		expect(captures.length).toBeGreaterThan(0);
		await cp(path.join(vault, '.fragment/plugins/hone/images', captures.at(-1)!), `${CAPTURES}/hone-pdf-image-zone.png`);

		await barre.locator('[aria-label="Définir"]').click();
		const corps = page.locator('.agent-action-carte .agent-action-corps');
		await expect.poll(async () => (await corps.textContent())?.trim().length ?? 0, { timeout: 240_000 }).toBeGreaterThan(20);
		const reponse = (await corps.textContent())!;
		console.log('DEFINIR PDF', reponse);
		expect(reponse).not.toMatch(/n'a pas pu répondre|factice|illisible/i);
		await expect(page.locator('.agent-action-carte')).toBeInViewport();
		await page.waitForTimeout(1500);
		await page.screenshot({ path: `${CAPTURES}/hone-pdf-image-carte.png` });
	} finally {
		await electronApp.close();
	}
});
