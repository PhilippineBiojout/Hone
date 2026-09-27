import { test, expect, _electron, type Page } from '@playwright/test';
import { cp, mkdtemp, mkdir, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

/**
 * Le texte des agents se lit comme dans ChatGPT ou Claude : jamais de Markdown brut, de
 * `\(…\)` ni de code SVG à l'écran. Sur le devoir de physique de son coffre « cours 2A »,
 * le vrai Codex répond dans le chat avec une liste et des formules, puis dessine ; une carte
 * Définir aussi. App installée, captures dans les deux thèmes.
 *
 * Se lance depuis Fragment-main/app, après `npm run build` dans Hone :
 *     cp <ce fichier> ../../Fragment-main/app/e2e/hone-rendu-codex.spec.ts && npx playwright test e2e/hone-rendu-codex.spec.ts --workers=1
 */

const CAPTURES = '/Users/philippinebiojout/Documents/IA/fragment-notes/.fragment/plugins/hone/test-results';
const COFFRE = '/Users/philippinebiojout/Documents/polytechnique/cours 2A';
const DEVOIR = 'P1/PHY_41030_EP/phy430_x20_dm4.pdf';

/** Ce qui ne doit jamais se voir : la syntaxe Markdown, LaTeX ou SVG. */
const BRUT = /\*\*|^#{1,6}\s|\\\(|\\\)|\\\[|\$\$|<ellipse|<path|<svg|```/m;

async function lancer() {
	const base = await mkdtemp(path.join(os.tmpdir(), 'hone-rendu-'));
	const vault = path.join(base, 'vault');
	const userData = path.join(base, 'userdata');
	await mkdir(userData, { recursive: true });
	await cp(COFFRE, vault, { recursive: true,
		filter: (src) => !src.includes('node_modules') && !src.includes('/.git') && !src.endsWith('.fragment/workspace.json') });
	await cp('/Users/philippinebiojout/Documents/IA/fragment-notes/.fragment/plugins/hone/main.js', path.join(vault, '.fragment/plugins/hone/main.js'));
	await cp('/Users/philippinebiojout/Documents/IA/fragment-notes/.fragment/plugins/hone/styles.css', path.join(vault, '.fragment/plugins/hone/styles.css'));
	await writeFile(path.join(vault, '.fragment/plugins/hone/remarkable.json'),
		JSON.stringify({ hote: 'http://127.0.0.1:9', autorise: false, statutLive: true, carnets: {} }), 'utf8');
	await writeFile(path.join(userData, 'config.json'), JSON.stringify({ vaultRoot: vault }), 'utf8');
	const electronApp = await _electron.launch({
		executablePath: '/Applications/Fragment.app/Contents/MacOS/Fragment',
		args: [`--user-data-dir=${userData}`, `--vault-root=${vault}`],
		env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: process.env.HOME! } as Record<string, string>,
	});
	let page = electronApp.windows().find((w) => !w.url().startsWith('devtools'));
	while (!page) page = await electronApp.waitForEvent('window');
	await page.waitForFunction(() => !!(window as any).app?.workspace?.layoutReady, undefined, { timeout: 30_000 });
	await page.setViewportSize({ width: 1400, height: 900 });
	await page.waitForFunction(() => !!(window as any).app.commands.findCommand('hone:open-codex-panel'), undefined, { timeout: 30_000 });
	await page.evaluate(async (chemin) => {
		const app = (window as any).app;
		await app.workspace.getLeaf('tab').openFile(app.vault.getFileByPath(chemin));
		app.workspace.getLeavesOfType('pdf').find((l: any) => l.view.file?.path === chemin).view.toggleLayer('annotation');
	}, DEVOIR);
	return { electronApp, page };
}

/** Surligne « harmonique sphérique » (question 4) : la barre sort. */
async function surligner(page: Page) {
	const mot = page.locator('.pdf-scroll:visible .pdf-text-layer span', { hasText: 'harmonique' }).first();
	await expect(mot).toBeVisible({ timeout: 15_000 });
	await page.locator('.toolbar-item[aria-label="Surligneur"]:visible').first().click();
	const b = (await mot.boundingBox())!;
	const y = b.y + b.height / 2;
	await page.mouse.move(b.x + 2, y);
	await page.mouse.down();
	for (let i = 1; i <= 10; i++) await page.mouse.move(b.x + 2 + (b.width * i) / 10, y);
	await page.mouse.up();
	await expect(page.locator('.agent-barre')).toBeVisible({ timeout: 5_000 });
}

async function captures(page: Page, nom: string) {
	for (const theme of ['dark', 'light'] as const) {
		await page.emulateMedia({ colorScheme: theme });
		await page.waitForTimeout(400);
		await page.screenshot({ path: `${CAPTURES}/hone-rendu-${nom}-${theme}.png` });
	}
	await page.emulateMedia({ colorScheme: null });
}

test('le chat : liste, formules et dessin mis en forme, jamais en code', async () => {
	test.setTimeout(600_000);
	const { electronApp, page } = await lancer();
	try {
		await surligner(page);
		await page.locator('.agent-barre [aria-label="Discuter avec Hone"]').click();
		const bulle = page.locator('.agent-bulle');
		await expect(bulle).toBeVisible();
		const demander = async (question: string) => {
			await bulle.locator('.agent-bulle-champ').fill(question);
			await bulle.locator('.agent-bulle-champ').press('Enter');
			const reponse = bulle.locator('.agent-message.mod-agent').last();
			await expect(reponse).not.toHaveClass(/is-pending/, { timeout: 240_000 });
			await expect(reponse).not.toHaveClass(/is-error/);
			// Le dernier rendu en direct part à l'image suivante.
			await page.waitForTimeout(300);
			return reponse;
		};

		const formules = await demander('Donne en liste à puces les trois nombres quantiques de cet état et la forme de Y_{l,l}, avec les formules.');
		console.log('FORMULES', await formules.innerHTML());
		expect(await formules.textContent()).not.toMatch(BRUT);
		expect(await formules.locator('math').count()).toBeGreaterThan(0);
		expect(await formules.locator('li').count()).toBeGreaterThan(0);
		await captures(page, 'formules');

		const dessin = await demander('Dessine l\'allure de cette harmonique sphérique, avec son axe z.');
		console.log('DESSIN', (await dessin.textContent())?.slice(0, 300));
		expect(await dessin.textContent()).not.toMatch(BRUT);
		await expect(dessin.locator('.hone-svg svg')).toHaveCount(1);
		await captures(page, 'dessin');
	} finally {
		await electronApp.close();
	}
});

test('une carte Définir : texte mis en forme', async () => {
	test.setTimeout(300_000);
	const { electronApp, page } = await lancer();
	try {
		await surligner(page);
		await page.locator('.agent-barre [aria-label="Définir"]').click();
		const corps = page.locator('.agent-action-carte .agent-action-corps');
		await expect.poll(async () => (await corps.textContent())?.trim().length ?? 0, { timeout: 240_000 }).toBeGreaterThan(20);
		console.log('DEFINIR', await corps.innerHTML());
		await expect(corps).toHaveClass(/hone-rendu/);
		expect(await corps.textContent()).not.toMatch(BRUT);
		await captures(page, 'definir');
	} finally {
		await electronApp.close();
	}
});
