import { test, expect, type Page } from '@playwright/test';
import {
    barre, bordGaucheTexte, bulle, carte, carteOuverte, lancer, ligne, ouvrirChat, outilPuisFermer, surligner, tirer,
    traces, type Harnais,
} from './hone-commun';

/**
 * Le chat et les cartes d'outil en widget (positionnement/fenetre.ts) : déplacer par
 * l'en-tête, agrandir par les bords et les coins, rester posé dans le texte et dans le
 * panneau ; une carte devient un chat par sa tête de chat.
 */

/** Tire la carte par son titre. */
async function deplacerCarte(page: Page, dx: number, dy: number): Promise<void> {
    const t = (await carte(page).locator('.agent-action-titre').boundingBox())!;
    await tirer(page, t.x + 10, t.y + t.height / 2, dx, dy);
}

const discuter = (page: Page) => carte(page).locator('[aria-label="Discuter de cette réponse"]');

async function chatVisible(page: Page): Promise<void> {
    await expect(bulle(page)).toBeVisible();
    await expect.poll(() => bulle(page).evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    await page.waitForTimeout(300);
}

/** Le panneau de la note, en coordonnées client. */
const panneau = (page: Page) => page.evaluate(() => {
    const r = (window as unknown as { app: any }).app.workspace.getLeavesOfType('markdown')[0].view.contentEl.getBoundingClientRect();
    return { left: r.left as number, right: r.right as number, top: r.top as number, width: r.width as number, height: r.height as number };
});

let h: Harnais;
test.beforeEach(async () => { h = await lancer(); });
test.afterEach(async () => { await h.electronApp.close(); });

test('une carte se déplace par son en-tête, défile ensuite avec le texte, et sa croix la ferme', async () => {
    const { page } = h;
    await surligner(page, 'Ligne 3 :', 'Révolution française');
    await carteOuverte(page);
    const avant = (await carte(page).boundingBox())!;
    await deplacerCarte(page, -120, 160);
    const apres = (await carte(page).boundingBox())!;
    expect(Math.abs(apres.x - (avant.x - 120))).toBeLessThan(1.5);
    expect(Math.abs(apres.y - (avant.y + 160))).toBeLessThan(1.5);
    // Rien d'autre n'a bougé : même taille, carte toujours ouverte.
    expect(Math.abs(apres.width - avant.width)).toBeLessThan(1.5);

    // On fait défiler la note : la carte suit le texte, pas l'écran.
    const l0 = await ligne(page, 'Ligne 3 :');
    await page.mouse.move(l0.x + 40, l0.y + 300);
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(300);
    const l1 = await ligne(page, 'Ligne 3 :');
    const defile = (await carte(page).boundingBox())!;
    expect(l0.y - l1.y).toBeGreaterThan(50);
    expect(Math.abs((defile.y - apres.y) - (l1.y - l0.y))).toBeLessThan(1.5);

    await carte(page).locator('[aria-label="Fermer"]').click();
    await expect(carte(page)).toHaveCount(0);
});

test('la carte s\'agrandit par ses bords et ses coins, le bord opposé reste, et rapetissée elle garde une taille minimale', async () => {
    const { page } = h;
    await surligner(page, 'Ligne 12 :', 'Révolution française');
    await carteOuverte(page);
    const curseurs = await carte(page).evaluate((el) => Object.fromEntries(
        [...el.querySelectorAll('.agent-widget-bord')].map((b) => [
            [...b.classList].find((c) => c.startsWith('mod-')), getComputedStyle(b).cursor,
        ])));
    expect(curseurs).toEqual({
        'mod-n': 'ns-resize', 'mod-s': 'ns-resize', 'mod-e': 'ew-resize', 'mod-w': 'ew-resize',
        'mod-ne': 'nesw-resize', 'mod-sw': 'nesw-resize', 'mod-nw': 'nwse-resize', 'mod-se': 'nwse-resize',
    });
    const a = (await carte(page).boundingBox())!;
    // Le coin est bien sous le pointeur au coin de la carte (pas masqué par le contenu).
    const sous = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.className ?? '', { x: a.x + a.width - 1, y: a.y + a.height - 1 });
    expect(sous).toContain('mod-se');

    // Le coin bas droit : le coin haut gauche ne bouge pas.
    await tirer(page, a.x + a.width - 2, a.y + a.height - 2, 80, 120);
    const b = (await carte(page).boundingBox())!;
    expect(Math.abs(b.x - a.x)).toBeLessThan(1.5);
    expect(Math.abs(b.y - a.y)).toBeLessThan(1.5);
    expect(Math.abs(b.width - (a.width + 80))).toBeLessThan(1.5);
    expect(Math.abs(b.height - (a.height + 120))).toBeLessThan(1.5);

    // Le bord gauche puis le haut : vers l'extérieur, les bords droit et bas restent.
    await tirer(page, b.x + 1, b.y + b.height / 2, -60, 0);
    await tirer(page, b.x - 60 + b.width / 2, b.y + 1, 0, -50);
    const c = (await carte(page).boundingBox())!;
    expect(Math.abs(c.x + c.width - (b.x + b.width))).toBeLessThan(1.5);
    expect(Math.abs(c.y + c.height - (b.y + b.height))).toBeLessThan(1.5);
    expect(Math.abs(c.width - (b.width + 60))).toBeLessThan(1.5);
    expect(Math.abs(c.height - (b.height + 50))).toBeLessThan(1.5);

    // Rapetissée : 220 px de large, jamais plus haute qu'à l'ouverture, et la réponse défile.
    await tirer(page, c.x + c.width - 2, c.y + c.height - 2, -1000, -1000);
    const d = (await carte(page).boundingBox())!;
    expect(Math.round(d.width)).toBe(220);
    expect(Math.round(d.height)).toBe(Math.round(Math.min(120, a.height)));
    expect(await carte(page).locator('.agent-action-corps').evaluate((el) => getComputedStyle(el).overflowY)).toBe('auto');
    const x = (await carte(page).locator('[aria-label="Fermer"]').boundingBox())!;
    expect(x.x + x.width).toBeLessThanOrEqual(d.x + d.width);
});

test('rouverte depuis la marge, la carte revient où on l\'a posée, à sa taille', async () => {
    const { page } = h;
    await surligner(page, 'Ligne 3 :', 'Révolution française');
    await carteOuverte(page);
    await deplacerCarte(page, -100, 140);
    const m = (await carte(page).boundingBox())!;
    await tirer(page, m.x + m.width - 2, m.y + m.height - 2, 40, 60);
    const posee = (await carte(page).boundingBox())!;
    await carte(page).locator('[aria-label="Fermer"]').click();

    await traces(page).click();
    await expect.poll(() => carte(page).evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    await page.waitForTimeout(300);
    const revenue = (await carte(page).boundingBox())!;
    for (const k of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(revenue[k] - posee[k])).toBeLessThan(1.5);
    await carte(page).locator('[aria-label="Fermer"]').click();

    // Un nouvel outil sur un autre passage repart de la place automatique.
    await surligner(page, 'Ligne 20 :', 'commence');
    await carteOuverte(page, 'Définir');
    const neuve = (await carte(page).boundingBox())!;
    expect(Math.round(neuve.width)).toBe(Math.round(posee.width - 40));
});

test('le chat se déplace et s\'agrandit, garde sa saisie en bas, et revient à sa place rouvert', async () => {
    const { page } = h;
    await surligner(page, 'Ligne 5 :', 'commence');
    await ouvrirChat(page);
    await page.locator('.agent-bulle-champ').fill('Pourquoi 1789 ?');
    await page.keyboard.press('Enter');
    await expect(page.locator('.agent-message.mod-agent')).toContainText('Réponse factice', { timeout: 5_000 });

    const e = (await page.locator('.agent-bulle-extrait').boundingBox())!;
    await tirer(page, e.x + 20, e.y + e.height / 2, -200, 40);
    const d = (await bulle(page).boundingBox())!;
    await tirer(page, d.x + d.width - 2, d.y + d.height - 2, 60, 100);
    const posee = (await bulle(page).boundingBox())!;
    expect(Math.abs(posee.height - (d.height + 100))).toBeLessThan(1.5);
    // La saisie reste collée en bas, au-dessus du pied.
    const champ = (await page.locator('.agent-bulle-saisie').boundingBox())!;
    expect(posee.y + posee.height - (champ.y + champ.height)).toBeLessThan(50);
    // Toujours utilisable.
    await page.locator('.agent-bulle-champ').fill('Et après ?');
    await page.keyboard.press('Enter');
    await expect(page.locator('.agent-message.mod-agent')).toHaveCount(2, { timeout: 5_000 });

    await page.locator('.agent-bulle [aria-label="Fermer"]').click();
    await page.keyboard.press('Escape');
    await expect(barre(page)).toHaveCount(0);
    await traces(page).click();
    await expect.poll(() => bulle(page).evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    await page.waitForTimeout(300);
    const revenue = (await bulle(page).boundingBox())!;
    for (const k of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(revenue[k] - posee[k])).toBeLessThan(1.5);
});

test('le widget reste dans le panneau : tiré au-delà, il s\'arrête au bord ; emporté par le défilement, il passe sous les onglets', async () => {
    const { page } = h;
    await surligner(page, 'Ligne 12 :', 'commence');
    await carteOuverte(page, 'Définir');
    await deplacerCarte(page, -2000, 0);
    const pane = await panneau(page);
    const b = (await carte(page).boundingBox())!;
    expect(Math.abs(b.x - (pane.left + 8))).toBeLessThan(1.5);
    // Tiré par le coin au-delà du bord droit, il s'arrête aussi.
    await tirer(page, b.x + b.width - 2, b.y + b.height - 2, 3000, 0);
    const c = (await carte(page).boundingBox())!;
    expect(Math.abs(c.x + c.width - (pane.right - 8))).toBeLessThan(1.5);

    // Posée dans le texte, elle défile avec lui jusque sous la barre d'onglets.
    const l = await ligne(page, 'Ligne 12 :');
    await page.mouse.move(l.x + 40, l.y + 200);
    for (let i = 0; i < 20; i++) {
        await page.mouse.wheel(0, 60);
        await page.waitForTimeout(80);
        if ((await carte(page).boundingBox())!.y < pane.top - 20) break;
    }
    const e = (await carte(page).boundingBox())!;
    expect(e.y).toBeLessThan(pane.top - 10);
    const sous = (y: number) => page.evaluate(({ x, y }) =>
        document.elementFromPoint(x, y)?.closest('.agent-action-carte') ? 'carte' : 'autre', { x: e.x + e.width / 2, y });
    // Au-dessus du pane, c'est la barre qu'on voit ; la partie encore dans le pane reste visible.
    expect(await sous(pane.top - 5)).toBe('autre');
    expect(await sous(e.y + e.height - 10)).toBe('carte');
});

test('un cadre gardé plus grand que le panneau revient plafonné à sa taille', async () => {
    const { page } = h;
    await surligner(page, 'Ligne 3 :', 'Révolution française');
    await carteOuverte(page);
    const a = (await carte(page).boundingBox())!;
    await tirer(page, a.x + a.width - 2, a.y + a.height - 2, 300, 250);
    const grande = (await carte(page).boundingBox())!;
    await carte(page).locator('[aria-label="Fermer"]').click();

    // La fenêtre rétrécit : le panneau devient plus étroit que la carte gardée.
    await page.setViewportSize({ width: 800, height: 500 });
    await page.waitForTimeout(300);
    // Si étroite, la marge n'a plus de place pour l'icône, qui se masque : on
    // la déclenche directement, c'est la taille rouverte qu'on vérifie ici.
    await traces(page).dispatchEvent('click');
    await expect.poll(() => carte(page).evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    await page.waitForTimeout(300);
    const pane = await panneau(page);
    const b = (await carte(page).boundingBox())!;
    expect(grande.width).toBeGreaterThan(pane.width - 16);
    expect(b.width).toBeLessThanOrEqual(pane.width - 16 + 0.5);
    expect(b.height).toBeLessThanOrEqual(pane.height - 16 + 0.5);
});

test('la tête de chat change une carte neuve en chat : à sa place et sa taille, commençant par sa réponse', async () => {
    const { page } = h;
    await surligner(page, 'Ligne 3 :', 'Révolution française');
    await carteOuverte(page);
    const reponse = (await carte(page).locator('.agent-action-corps').textContent()) ?? '';
    // Une réponse neuve n'est pas encore une annotation : pas de poubelle.
    await expect(discuter(page)).toBeVisible();
    await expect(carte(page).locator('.agent-pied-poubelle')).toBeHidden();
    await deplacerCarte(page, -120, 120);
    const m = (await carte(page).boundingBox())!;
    await tirer(page, m.x + m.width - 2, m.y + m.height - 2, 40, 80);
    const posee = (await carte(page).boundingBox())!;

    await discuter(page).click();
    await expect(carte(page)).toHaveCount(0);
    await chatVisible(page);
    const chat = (await bulle(page).boundingBox())!;
    for (const k of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(chat[k] - posee[k])).toBeLessThan(1.5);
    await expect(page.locator('.agent-message')).toHaveCount(1);
    await expect(page.locator('.agent-message.mod-agent')).toHaveText(reponse);
    await expect(bulle(page).locator('.agent-pied-poubelle')).toBeHidden();

    // La question part avec la réponse de l'outil dans l'historique.
    await page.locator('.agent-bulle-champ').fill('Et en 1792 ?');
    await page.keyboard.press('Enter');
    await expect(page.locator('.agent-message.mod-agent').nth(1)).toContainText('après 1 message', { timeout: 5_000 });

    // Une seule icône, celle de l'outil, qui rouvre toute la conversation.
    await page.locator('.agent-bulle [aria-label="Fermer"]').click();
    await expect(traces(page)).toHaveCount(1);
    await expect(traces(page)).toHaveAttribute('aria-label', /^Traduire :/);
    await traces(page).click();
    await chatVisible(page);
    await expect(page.locator('.agent-message')).toHaveCount(3);
    await expect(bulle(page).locator('.agent-pied-poubelle')).toBeVisible();
});

test('une carte rouverte depuis la marge devient un chat sans doubler son icône ; la confirmation de suppression cache la tête de chat', async () => {
    const { page } = h;
    await surligner(page, 'Ligne 3 :', 'Révolution française');
    await outilPuisFermer(page, 'Définir');
    await traces(page).click();
    await expect.poll(() => carte(page).evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    await carte(page).locator('.agent-pied-poubelle').click();
    await expect(discuter(page)).toBeHidden();
    await carte(page).locator('.agent-pied-annuler').click();
    await expect(discuter(page)).toBeVisible();

    await discuter(page).click();
    await chatVisible(page);
    await expect(bulle(page).locator('.agent-pied-poubelle')).toBeVisible();
    await page.locator('.agent-bulle [aria-label="Fermer"]').click();
    await expect(traces(page)).toHaveCount(1);
    await expect(traces(page)).toHaveAttribute('aria-label', /^Définir :/);

    // La poubelle du chat retire l'annotation entière.
    await traces(page).click();
    await chatVisible(page);
    await bulle(page).locator('.agent-pied-poubelle').click();
    await bulle(page).locator('.agent-pied-supprimer').click();
    await expect(traces(page)).toHaveCount(0);
});

test('fenêtre étroite : la réponse fermée laisse quand même son icône, qui rouvre et supprime', async () => {
    const { page } = h;
    // La colonne remplit presque le pane : la marge gauche passe sous les
    // 60 px où le cœur masque un widget de marge.
    await page.setViewportSize({ width: 960, height: 800 });
    const marge = await page.evaluate(() => {
        const w = window as unknown as { app: any };
        const view = w.app.workspace.getLeavesOfType('markdown')[0].view;
        return document.querySelector('.cm-content')!.getBoundingClientRect().left - view.contentEl.getBoundingClientRect().left;
    });
    expect(marge).toBeLessThan(60);

    await surligner(page, 'Ligne 3 :', 'Révolution française');
    await carteOuverte(page);
    await carte(page).locator('[aria-label="Fermer"]').click();
    await expect(traces(page)).toBeVisible();
    // Dans la marge : à gauche du texte, et dans le pane (pas sous l'explorateur).
    const t = (await traces(page).boundingBox())!;
    expect(t.x + t.width).toBeLessThanOrEqual(await bordGaucheTexte(page));
    expect(t.x).toBeGreaterThanOrEqual((await panneau(page)).left);

    await traces(page).click();
    await expect(carte(page)).toBeVisible();
    await carte(page).locator('.agent-pied-poubelle').click();
    await carte(page).locator('.agent-pied-supprimer').click();
    await expect(carte(page)).toHaveCount(0);
    await expect(traces(page)).toHaveCount(0);
});

test('la barre se déplace par sa poignée, puis défile avec le texte', async () => {
    const { page } = h;
    await surligner(page, 'Ligne 3 :', 'Révolution française');
    await expect(barre(page)).toBeVisible();
    const poignee = barre(page).locator('.toolbar-handle');
    await expect(poignee).toBeVisible();
    const a = (await barre(page).boundingBox())!;
    const p = (await poignee.boundingBox())!;
    await tirer(page, p.x + p.width / 2, p.y + p.height / 2, 120, 80);
    const b = (await barre(page).boundingBox())!;
    expect(Math.abs(b.x - a.x - 120)).toBeLessThan(2);
    expect(Math.abs(b.y - a.y - 80)).toBeLessThan(2);
    // Toujours ouverte, toujours horizontale.
    await expect(barre(page)).not.toHaveClass(/mod-vertical/);

    // Ancrée au texte : elle défile avec lui.
    await page.locator('.doc-scroll').evaluate((el) => { el.scrollTop += 100; });
    await page.waitForTimeout(100);
    const c = (await barre(page).boundingBox())!;
    expect(Math.abs(c.y - (b.y - 100))).toBeLessThan(2);
});

// Le Keymap du cœur écoute en capture sur window : sans la portée de clavier.ts,
// Mod+W tapé dans le chat fermait l'onglet, et Échap fermait la barre et le chat.
test('dans le chat, les raccourcis de l\'app ne passent pas, et Échap quitte le champ sans rien fermer', async () => {
    const { page } = h;
    const etat = () => page.evaluate(() => {
        const app = (window as unknown as { app: any }).app;
        return {
            feuilles: app.workspace.getLeavesOfType('markdown').length,
            texte: app.workspace.getLeavesOfType('markdown')[0]?.view.getEditor()?.getValue() as string,
        };
    });
    await surligner(page, 'Ligne 5 :', 'commence');
    await ouvrirChat(page);
    const avant = await etat();

    const champ = page.locator('.agent-bulle-champ');
    await champ.click();
    await page.keyboard.type('Pourquoi');
    await page.keyboard.press('ControlOrMeta+b');
    await page.keyboard.press('ControlOrMeta+w');
    await page.waitForTimeout(300);

    const apres = await etat();
    expect(apres.feuilles).toBe(avant.feuilles);
    expect(apres.texte).toBe(avant.texte);
    await expect(champ).toHaveValue('Pourquoi');

    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await expect(bulle(page)).toBeVisible();
    await expect(barre(page)).toBeVisible();
    expect(await champ.evaluate((el) => el === document.activeElement)).toBe(false);
});
