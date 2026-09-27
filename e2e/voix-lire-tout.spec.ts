import { test, expect, _electron } from '@playwright/test';
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync } from 'fs';
import { cp, mkdtemp, mkdir, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

/**
 * À l'oral aussi, Hone lit tout le document. On entoure seulement le titre de « DM Phy Q »
 * et on dit au micro « Résume la page dont le titre est entouré » : Codex doit lire le
 * carnet (read_document) au lieu de répondre qu'il ne voit que le titre. App installée,
 * copie du coffre « cours 2A » (sa clé Gradium), vrai Gradium, vrai Codex.
 * Le micro joue la phrase dite par la voix Thomas de macOS (voir voix-gradium.spec.ts).
 *
 * Se lance depuis Fragment-main/app, après `npm run build` dans Hone :
 *     cp <ce fichier> ../../Fragment-main/app/e2e/hone-voix-lire-tout.spec.ts && npx playwright test e2e/hone-voix-lire-tout.spec.ts --workers=1
 */

/** La phrase dite par une voix de macOS, en WAV 48 kHz (base64). */
function phrase(texte: string): string {
	const dossier = mkdtempSync(path.join(os.tmpdir(), 'hone-phrase-'));
	const brut = path.join(dossier, 'phrase.aiff');
	const wav = path.join(dossier, 'phrase.wav');
	execFileSync('/usr/bin/say', ['-v', 'Thomas', '-o', brut, texte]);
	execFileSync('/opt/homebrew/bin/ffmpeg', ['-loglevel', 'error', '-y', '-i', brut, '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', wav]);
	return readFileSync(wav).toString('base64');
}

const CAPTURES = '/Users/philippinebiojout/Documents/IA/fragment-notes/.fragment/plugins/hone/test-results';
const COFFRE = '/Users/philippinebiojout/Documents/polytechnique/cours 2A';
const CARNET = 'reMarkable/Cours 2A/P1/PHY_41030/DM Phy Q.pdf';

test('Hone à l\'oral : un cercle sur le titre, et il résume toute la page', async () => {
	test.setTimeout(420_000);
	const base = await mkdtemp(path.join(os.tmpdir(), 'hone-voix-lire-tout-'));
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

		// Le micro joue la phrase, une fois.
		await page.evaluate((b64) => {
			navigator.mediaDevices.getUserMedia = async () => {
				const ctx = new AudioContext();
				const octets = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
				const source = ctx.createBufferSource();
				source.buffer = await ctx.decodeAudioData(octets.buffer);
				const sortie = ctx.createMediaStreamDestination();
				source.connect(sortie);
				source.start();
				return sortie.stream;
			};
		}, phrase('Résume la page dont le titre est entouré.'));

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
		await barre.locator('[aria-label="Parler à Hone"]').click();
		const voix = page.locator('.agent-voix');
		await expect(voix).toHaveAttribute('data-etat', 'ecoute', { timeout: 15_000 });
		await expect(voix).toHaveAttribute('data-etat', 'reflechit', { timeout: 20_000 });
		await expect(voix).toHaveAttribute('data-etat', 'repond', { timeout: 240_000 });
		const reponse = (await voix.locator('.agent-voix-message').textContent()) ?? '';
		console.log('REPONSE ORALE', reponse);
		expect(reponse).not.toMatch(/factice|n'a pas pu|ne (peux|vois|lis) (que|pas)|seulement le titre/i);
		// Ce qui n'est pas dans le titre : le nombre quantique radial, n' = 0.
		expect(reponse).toMatch(/radia|n prime|n'|nombre quantique/i);
		await page.screenshot({ path: `${CAPTURES}/hone-voix-lire-tout.png` });
		await voix.locator('.agent-voix-fermer').click();
	} finally {
		await electronApp.close();
	}
});
