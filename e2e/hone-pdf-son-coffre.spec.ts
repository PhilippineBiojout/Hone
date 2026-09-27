import { test, expect, _electron } from '@playwright/test';
import { cp, mkdtemp, mkdir, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

/**
 * La barre de Hone sur un PDF, dans l'app installée et une copie de chaque coffre :
 * un trait de surligneur sur la question 3 d'un devoir fait sortir la barre à côté
 * de cette ligne, et le surligneur dessine toujours après. Sur un PDF, le cœur
 * trouve le caractère sous un point par le navigateur : la surface de dessin
 * cachait le texte, et un point entre deux mots rendait « la page ».
 *
 * Se lance depuis Fragment/app, après `npm run build` dans Hone :
 *     cp <ce fichier> ../../Fragment/app/e2e/ && npx playwright test e2e/hone-pdf-son-coffre.spec.ts --workers=1
 */

const CAPTURES = '/Users/philippinebiojout/Documents/IA/fragment-notes/.fragment/plugins/hone/test-results';
const DEVOIR = '/Users/philippinebiojout/Documents/polytechnique/cours 2A/P1/PHY_41030_EP/phy430_x20_dm4.pdf';
const COFFRES = [
	['fragment-notes', '/Users/philippinebiojout/Documents/IA/fragment-notes'],
	['cours-2A', '/Users/philippinebiojout/Documents/polytechnique/cours 2A'],
] as const;

for (const [nom, source] of COFFRES) {
	test(`Hone : un trait sur un PDF fait sortir la barre (${nom})`, async () => {
		test.setTimeout(120_000);
		const base = await mkdtemp(path.join(os.tmpdir(), 'hone-pdf-'));
		const vault = path.join(base, 'vault');
		const userData = path.join(base, 'userdata');
		await mkdir(userData, { recursive: true });
		await cp(source, vault, { recursive: true,
			filter: (src) => !src.includes('node_modules') && !src.includes('/.git') && !src.endsWith('.fragment/workspace.json') });
		await cp(DEVOIR, path.join(vault, 'devoir.pdf'));
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

			// Le PDF, et le calque d'annotation activé sur sa vue (menu « Calques »).
			await page.evaluate(async () => {
				const app = (window as any).app;
				await app.workspace.getLeaf('tab').openFile(app.vault.getFileByPath('devoir.pdf'));
				app.workspace.getLeavesOfType('pdf').find((l: any) => l.view.file?.path === 'devoir.pdf').view.toggleLayer('annotation');
			});
			const traits = () => page.evaluate(() => (window as any).app.plugins.plugins.get('annotation').source.strokes('devoir.pdf').length);
			const surligner = async (debut: string) => {
				const b = (await page.locator('.pdf-scroll:visible .pdf-text-layer span', { hasText: debut }).first().boundingBox())!;
				const y = b.y + b.height / 2;
				await page.mouse.move(b.x + 2, y);
				await page.mouse.down();
				for (let i = 1; i <= 10; i++) await page.mouse.move(b.x + 2 + ((b.width * 2) * i) / 10, y);
				await page.mouse.up();
				return y;
			};
			await expect(page.locator('.pdf-scroll:visible .pdf-text-layer span', { hasText: 'Expliquer' }).first()).toBeVisible({ timeout: 15_000 });
			// Les mots invisibles doivent être SOUS les mots affichés : la couche de texte a la
			// taille et la place du canvas. Sinon le test vise la couche et passe, pendant qu'un
			// trait sur le texte visible tombe à côté (le PDF du memo, le 27 au soir).
			const ecart = await page.locator('.pdf-scroll:visible .pdf-page').first().evaluate((p) => {
				const a = p.querySelector('canvas')!.getBoundingClientRect();
				const b = p.querySelector('.pdf-text-layer')!.getBoundingClientRect();
				return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.width - b.width), Math.abs(a.height - b.height));
			});
			expect(ecart).toBeLessThan(2);
			await page.locator('.toolbar-item[aria-label="Surligneur"]:visible').first().click();

			const y = await surligner('Expliquer');
			const barre = page.locator('.agent-barre');
			await expect(barre).toBeVisible({ timeout: 5_000 });
			// À côté de la question 3 (juste au-dessus de sa ligne), pas en haut de la page.
			const r = (await barre.boundingBox())!;
			expect(Math.abs(r.y + r.height - y)).toBeLessThan(40);
			await page.screenshot({ path: `${CAPTURES}/hone-pdf-${nom}.png` });

			// Le surligneur dessine toujours.
			await page.keyboard.press('Escape');
			const avant = await traits();
			await surligner('Quelle');
			await expect.poll(traits).toBeGreaterThan(avant);
		} finally {
			await electronApp.close();
		}
	});
}
