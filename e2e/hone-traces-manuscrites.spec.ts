import { test, expect, _electron, type Page } from '@playwright/test';
import { cp, mkdtemp, mkdir, readFile, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

/**
 * Sur un carnet reMarkable écrit à la main, chaque réponse fermée laisse son icône dans la marge,
 * à la hauteur de son trait : trois cercles (deux à la même hauteur, un plus bas) donnent trois
 * icônes qui ne se recouvrent pas, les deux premières côte à côte, et chacune rouvre sa réponse.
 * Avant, toutes se posaient en haut de la page, l'une sur l'autre.
 * App installée, copie du coffre « cours 2A », Hone en factice.
 *
 * Se lance depuis Fragment-main/app, après `npm run build` dans Hone :
 *     cp <ce fichier> ../../Fragment-main/app/e2e/ && npx playwright test e2e/hone-traces-manuscrites.spec.ts --workers=1
 */

const HONE = '/Users/philippinebiojout/Documents/IA/fragment-notes/.fragment/plugins/hone';
const CAPTURES = `${HONE}/test-results`;
const COFFRE = '/Users/philippinebiojout/Documents/polytechnique/cours 2A';
const CARNET = 'reMarkable/AI/Hackathon/Notes XIA.pdf';

async function cercle(page: Page, cx: number, cy: number): Promise<void> {
	await page.mouse.move(cx + 60, cy);
	await page.mouse.down();
	for (let i = 1; i <= 30; i++) {
		const a = (2 * Math.PI * i) / 30;
		await page.mouse.move(cx + 60 * Math.cos(a), cy + 22 * Math.sin(a));
	}
	await page.mouse.up();
}

test('Hone : les icônes des réponses sur un carnet manuscrit ne se recouvrent plus', async () => {
	test.setTimeout(180_000);
	const base = await mkdtemp(path.join(os.tmpdir(), 'hone-traces-rm-'));
	const vault = path.join(base, 'vault');
	const userData = path.join(base, 'userdata');
	await mkdir(userData, { recursive: true });
	await cp(COFFRE, vault, { recursive: true,
		filter: (src) => !src.includes('node_modules') && !src.includes('/.git') && !src.endsWith('.fragment/workspace.json') });
	const dossier = path.join(vault, '.fragment/plugins/hone');
	await cp(`${HONE}/main.js`, path.join(dossier, 'main.js'));
	await writeFile(path.join(dossier, 'remarkable.json'),
		JSON.stringify({ hote: 'http://127.0.0.1:9', autorise: false, statutLive: true, carnets: {} }), 'utf8');
	// En factice : on teste la marge, pas Codex. Aucune trace d'avant.
	const donnees = JSON.parse(await readFile(path.join(dossier, 'data.json'), 'utf8'));
	await writeFile(path.join(dossier, 'data.json'), JSON.stringify({ ...donnees, factice: true }), 'utf8');
	await writeFile(path.join(dossier, 'traces.json'), '{}', 'utf8');
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
		const r = (await canvas.boundingBox())!;
		await page.locator('.toolbar-item[aria-label="Crayon"]:visible').first().click();

		// Deux cercles à la même hauteur, un plus bas.
		const cercles = [
			{ x: r.x + r.width * 0.3, y: r.y + 160 },
			{ x: r.x + r.width * 0.65, y: r.y + 160 },
			{ x: r.x + r.width * 0.4, y: r.y + 420 },
		];
		for (const c of cercles) {
			await cercle(page, c.x, c.y);
			await expect(page.locator('.agent-barre')).toBeVisible({ timeout: 5_000 });
			await page.locator('.agent-barre [aria-label="Définir"]').click();
			const carte = page.locator('.agent-action-carte');
			await expect(carte).toBeVisible({ timeout: 10_000 });
			await expect.poll(async () => (await carte.locator('.agent-action-corps').textContent())?.trim().length ?? 0).toBeGreaterThan(0);
			await carte.locator('[aria-label="Fermer"]').click();
			await expect(carte).toHaveCount(0);
		}

		const icones = page.locator('.agent-trace');
		await expect(icones).toHaveCount(3);
		const boites = await Promise.all([0, 1, 2].map(async (i) => (await icones.nth(i).boundingBox())!));
		for (const b of boites) expect(b.width).toBeGreaterThan(0);
		// Aucune ne recouvre une autre.
		for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) {
			const a = boites[i];
			const b = boites[j];
			const x = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
			const y = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
			expect(x * y).toBe(0);
		}
		// Chacune à la hauteur de son trait : deux côte à côte en haut, une plus bas.
		const ys = boites.map((b) => b.y).sort((a, b) => a - b);
		expect(Math.abs(ys[0] - ys[1])).toBeLessThan(4);
		expect(ys[2] - ys[1]).toBeGreaterThan(150);
		await page.screenshot({ path: `${CAPTURES}/hone-traces-manuscrites.png` });

		// Chacune rouvre sa réponse.
		for (let i = 0; i < 3; i++) {
			await icones.nth(i).click();
			await expect(page.locator('.agent-action-carte')).toBeVisible({ timeout: 5_000 });
			await page.locator('.agent-action-carte [aria-label="Fermer"]').click();
			await expect(page.locator('.agent-action-carte')).toHaveCount(0);
		}
	} finally {
		await electronApp.close();
	}
});
