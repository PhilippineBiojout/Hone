import { test, expect, _electron } from '@playwright/test';
import { cp, mkdtemp, mkdir, readFile, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

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
