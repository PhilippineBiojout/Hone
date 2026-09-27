import { test, expect, type Page } from '@playwright/test';
import { barre, bulle, carte, lancer, ligne, nbTraits, surligner, traces, voix, type Harnais } from './hone-commun';

/**
 * La discussion orale (VoixAgent.ts) : le micro de la barre, après la tête de
 * chat, fait sortir une lumière du bas du panneau (voice-glow, libraries.dev/voice),
 * sans boîte. C'est un appel en direct : une phrase puis un silence font un tour,
 * Hone réfléchit puis répond à voix haute ; ■ lui coupe la parole, la croix raccroche
 * et laisse un bilan. En factice : l'appel factice de cerveau/appel.ts.
 *
 * Pas de vrai micro : `getUserMedia` est remplacé dans la page par un
 * oscillateur à 220 Hz dont on règle le volume, et la synthèse vocale par un
 * faux qui « parle » 1,5 s (assez pour que l'attente de Playwright voie l'état).
 */

const micro = (page: Page) => barre(page).locator('[aria-label="Parler à Hone"]');
const stop = (page: Page) => voix(page).locator('.agent-voix-stop');
const fermer = (page: Page) => voix(page).locator('[aria-label="Fermer"]');
const message = (page: Page) => voix(page).locator('.agent-voix-message');
/** La lueur de voice-glow : son enveloppe porte data-voice-type, et data-processing quand elle balaie. */
const lueur = (page: Page) => voix(page).locator('.agent-voix-lueur [data-voice-type]');
const dits = (page: Page) => page.evaluate(() => (window as unknown as { __voix: any }).__voix.dits as string[]);

/** Le faux micro et la fausse voix ; `refuser` fait échouer getUserMedia. */
async function simulerAudio(page: Page, refuser = false): Promise<void> {
    await page.evaluate((refuser) => {
        const etat = { pistes: [] as MediaStreamTrack[], gains: [] as GainNode[], niveau: 0, dits: [] as string[] };
        (window as unknown as { __voix: typeof etat }).__voix = etat;
        navigator.mediaDevices.getUserMedia = async () => {
            if (refuser) throw new DOMException('refusé', 'NotAllowedError');
            const ctx = new AudioContext();
            const osc = ctx.createOscillator();
            osc.frequency.value = 220;
            const gain = ctx.createGain();
            gain.gain.value = etat.niveau;
            const sortie = ctx.createMediaStreamDestination();
            osc.connect(gain).connect(sortie);
            osc.start();
            etat.gains.push(gain);
            etat.pistes.push(...sortie.stream.getTracks());
            return sortie.stream;
        };
        speechSynthesis.speak = (u: SpeechSynthesisUtterance) => {
            etat.dits.push(u.text);
            u.dispatchEvent(new Event('start'));
            setTimeout(() => u.dispatchEvent(new Event('end')), 1500);
        };
    }, refuser);
}

/** Surligne un passage, puis ouvre la discussion orale par le micro de la barre. */
async function ouvrirVoix(page: Page, refuser = false): Promise<void> {
    await simulerAudio(page, refuser);
    await surligner(page, 'Ligne 3 :', 'Révolution');
    await expect(barre(page)).toBeVisible();
    await micro(page).click();
    await expect(voix(page)).toBeVisible();
}

/** Une phrase au micro : le volume monte, puis le silence. */
async function parlerAuMicro(page: Page): Promise<void> {
    const volume = (n: number) => page.evaluate((n) => {
        const v = (window as unknown as { __voix: any }).__voix;
        v.niveau = n;
        for (const g of v.gains) g.gain.value = n;
    }, n);
    await volume(1);
    await page.waitForTimeout(400);
    await volume(0);
}

/** Un tour complet : une phrase, Hone réfléchit, répond à voix haute, puis la barre écoute de nouveau. */
async function unTour(page: Page): Promise<void> {
    await expect(voix(page)).toHaveAttribute('data-etat', 'ecoute', { timeout: 4_000 });
    await parlerAuMicro(page);
    await expect(voix(page)).toHaveAttribute('data-etat', 'repond', { timeout: 4_000 });
    await expect(voix(page)).toHaveAttribute('data-etat', 'ecoute', { timeout: 4_000 });
}

/** La croix de la barre, puis la carte du bilan arrivée. */
async function fermerVoix(page: Page): Promise<void> {
    await fermer(page).click();
    await expect(voix(page)).toHaveCount(0);
    await expect(carte(page)).toBeVisible({ timeout: 4_000 });
}

let h: Harnais;
test.beforeEach(async () => { h = await lancer(); });
test.afterEach(async () => { await h.electronApp.close(); });

test('le micro, juste après la tête de chat, fait sortir la lumière du bas du panneau : sans boîte, traversable, fixe', async () => {
    const { page } = h;
    // L'ancien plugin agent habille tout `.agent-voix` (fond, filet, ombre, rayon 24) : sa feuille ne doit rien changer.
    await page.addStyleTag({ path: '/Users/philippinebiojout/Documents/IA/fragment-notes/.fragment/plugins/agent/styles.css' });
    await simulerAudio(page);
    await surligner(page, 'Ligne 3 :', 'Révolution');
    const libelles = await barre(page).locator('.toolbar-item:visible').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
    expect(libelles).toEqual(['Discuter avec Hone', 'Parler à Hone', 'Définir', 'Visualiser', "Plus d'outils"]);

    await micro(page).click();
    await expect(barre(page)).toHaveCount(0);
    await expect(voix(page)).toHaveAttribute('data-etat', 'ecoute', { timeout: 4_000 });
    await expect(voix(page)).toHaveClass(/est-posee/, { timeout: 4_000 });
    // L'état se lit dans la lumière : la ligne n'est là que pour les lecteurs d'écran.
    await expect(message(page)).toHaveText('Je vous écoute…');
    await expect(message(page)).not.toHaveClass(/est-visible/);
    await expect(lueur(page)).toHaveAttribute('data-voice-type', 'default');

    const style = await voix(page).evaluate((el) => {
        const c = getComputedStyle(el);
        return { fond: c.backgroundColor, filet: c.borderTopWidth, ombre: c.boxShadow, rayon: c.borderTopLeftRadius, clics: c.pointerEvents };
    });
    expect(style).toEqual({ fond: 'rgba(0, 0, 0, 0)', filet: '0px', ombre: 'none', rayon: '0px', clics: 'none' });

    // 500 px (moins dans un panneau étroit), centrée, collée au bas du panneau.
    const b = (await voix(page).boundingBox())!;
    const pane = await page.evaluate(() => {
        const r = ((window as unknown as { app: any }).app.workspace.getLeavesOfType('markdown')[0].view.contentEl as HTMLElement).getBoundingClientRect();
        return { x: r.left, width: r.width, bas: r.bottom };
    });
    expect(b.width).toBeCloseTo(Math.min(500, pane.width - 32), 0);
    expect(b.x + b.width / 2).toBeCloseTo(pane.x + pane.width / 2, -1);
    expect(b.y + b.height).toBeCloseTo(pane.bas, 0);

    // Deux ronds de 40 px, centrés, 12 px entre eux, à 28 px du bas : arrêter de parler, puis fermer.
    const s = (await stop(page).boundingBox())!;
    const f = (await fermer(page).boundingBox())!;
    expect([s.width, f.width]).toEqual([40, 40]);
    expect(f.x - (s.x + s.width)).toBeCloseTo(12, 0);
    expect((s.x + f.x + f.width) / 2).toBeCloseTo(b.x + b.width / 2, 0);
    expect(b.y + b.height - (f.y + f.height)).toBeCloseTo(28, 0);
    expect(await fermer(page).evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe('50%');
    // ■ ne sert qu'à couper Hone : pendant qu'on parle, il ne fait rien.
    await expect(stop(page)).toBeDisabled();

    // Dans la lumière, hors des ronds, un clic touche la note.
    const cible = await page.evaluate(({ x, y }) => {
        const el = document.elementFromPoint(x, y);
        return { voix: !!el?.closest('.agent-voix'), note: !!el?.closest('.cm-editor') };
    }, { x: b.x + 40, y: b.y + 40 });
    expect(cible).toEqual({ voix: false, note: true });

    // Elle reste en bas quand la note défile.
    await page.mouse.move(600, 300);
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(300);
    expect((await voix(page).boundingBox())!.y).toBeCloseTo(b.y, 0);
});

test('une phrase puis un silence : Hone réfléchit (la lueur balaie), répond à voix haute, écoute de nouveau ; ■ lui coupe la parole', async () => {
    const { page } = h;
    await ouvrirVoix(page);
    await unTour(page);
    expect((await dits(page))[0]).toContain('numéro 1');

    // Second tour, regardé de près.
    await parlerAuMicro(page);
    await expect(voix(page)).toHaveAttribute('data-etat', 'reflechit', { timeout: 4_000 });
    await expect(stop(page)).toBeDisabled();
    await expect(message(page)).toHaveText('Hone réfléchit…');
    await expect(lueur(page)).toHaveAttribute('data-processing', /.*/);
    await expect(voix(page)).toHaveAttribute('data-etat', 'repond', { timeout: 4_000 });
    await expect(lueur(page)).not.toHaveAttribute('data-processing', /.*/);
    // La réponse s'écrit sur la ligne d'état (lue par les lecteurs d'écran), et l'historique garde le premier tour.
    await expect(message(page)).toContainText('numéro 2');
    expect(await dits(page)).toHaveLength(2);

    await expect(stop(page)).toHaveAttribute('aria-label', 'Couper la parole à Hone');
    await stop(page).click();
    await expect(voix(page)).toHaveAttribute('data-etat', 'ecoute');
});

test('sans un mot, la croix rend le micro et ne laisse rien ; pendant l\'oral, un trait ne pose rien', async () => {
    const { page } = h;
    await ouvrirVoix(page);
    await expect(voix(page)).toHaveClass(/est-posee/, { timeout: 4_000 });
    const avant = await nbTraits(page);
    await surligner(page, 'Ligne 8 :', 'commence');
    expect(await nbTraits(page)).toBe(avant);
    await expect(barre(page)).toHaveCount(0);

    await fermer(page).click();
    await expect(voix(page)).toHaveCount(0);
    await expect(page.locator('.agent-voix-lueur')).toHaveCount(0);
    await expect(page.locator('.agent-zone')).toHaveCount(0);
    const etats = await page.evaluate(() => ((window as unknown as { __voix: any }).__voix.pistes as MediaStreamTrack[]).map((p) => p.readyState));
    expect(etats.length).toBeGreaterThan(0);
    expect(etats.every((e) => e === 'ended')).toBe(true);
    await page.waitForTimeout(1_500);
    await expect(carte(page)).toHaveCount(0);
    await expect(page.locator('.agent-action-cercle')).toHaveCount(0);
    await expect(traces(page)).toHaveCount(0);
});

test('micro refusé : la barre le dit, et sa croix la ferme', async () => {
    const { page } = h;
    await ouvrirVoix(page, true);
    await expect(voix(page)).toHaveAttribute('data-etat', 'refuse', { timeout: 4_000 });
    await expect(message(page)).toHaveText('Micro refusé');
    await expect(message(page)).toBeVisible();
    await expect(stop(page)).toBeHidden();
    await fermer(page).click();
    await expect(voix(page)).toHaveCount(0);
});

test('le bilan laisse un micro dans la marge ; rouvert, il reprend à voix haute et le nouveau bilan remplace l\'ancien', async () => {
    const { page } = h;
    await ouvrirVoix(page);
    await unTour(page);
    await fermer(page).click();
    // Le rond du micro tourne pendant que le bilan s'écrit ; le passage reste surligné.
    await expect(page.locator('.agent-action-cercle')).toBeVisible();
    await expect(carte(page)).toBeVisible({ timeout: 4_000 });
    await expect(carte(page).locator('.agent-action-titre')).toHaveText(/^Bilan/);
    await expect(carte(page).locator('.agent-action-corps')).toContainText('1 tour de parole');
    await expect(page.locator('.agent-zone').first()).toBeAttached();
    await carte(page).locator('[aria-label="Fermer"]').click();

    // Dans la marge GAUCHE : avant le début de la ligne.
    await expect(traces(page)).toHaveCount(1);
    await expect(traces(page)).toHaveAttribute('aria-label', /^Discussion orale : /);
    expect((await traces(page).boundingBox())!.x).toBeLessThan((await ligne(page, 'Ligne 3 :')).x);

    // Rouverte : le chat s'ouvre sur le bilan, puis les échanges transcrits.
    await traces(page).click();
    await expect(bulle(page)).toBeVisible();
    await expect(barre(page)).toHaveCount(0);
    await expect(bulle(page).locator('.agent-bilan')).toContainText('1 tour de parole');
    expect(await bulle(page).locator('.agent-bulle-fil').evaluate((el) => el.scrollTop)).toBe(0);
    const messages = bulle(page).locator('.agent-message');
    await expect(messages).toHaveCount(2);
    await expect(messages.nth(0)).toHaveClass(/mod-moi/);
    await expect(messages.nth(0)).toHaveText('Transcription factice du tour 1.');
    await expect(messages.nth(1)).toContainText('numéro 1');
    await expect(bulle(page).locator('.agent-pied-poubelle')).toBeVisible();

    // Reprise au micro puis croix sans un mot : rien ne change.
    await bulle(page).locator('.agent-bulle-micro').click();
    await expect(bulle(page)).toHaveCount(0);
    await expect(voix(page)).toHaveAttribute('data-etat', 'ecoute', { timeout: 4_000 });
    await fermer(page).click();
    await page.waitForTimeout(1_500);
    await expect(carte(page)).toHaveCount(0);
    await expect(traces(page)).toHaveCount(1);

    // Reprise avec un tour : l'historique garde le premier, le bilan en compte deux.
    await traces(page).click();
    await bulle(page).locator('.agent-bulle-micro').click();
    await unTour(page);
    expect((await dits(page)).at(-1)).toContain('numéro 2');
    await fermerVoix(page);
    await expect(carte(page).locator('.agent-action-corps')).toContainText('2 tours de parole');
    await carte(page).locator('[aria-label="Fermer"]').click();
    await expect(traces(page)).toHaveCount(1);
    await traces(page).click();
    await expect(bulle(page).locator('.agent-bilan')).toContainText('2 tours de parole');
    await expect(bulle(page).locator('.agent-message')).toHaveCount(4);
});

test('la carte bilan devient un chat oral ; sa poubelle efface la trace et le trait', async () => {
    const { page } = h;
    await ouvrirVoix(page);
    await unTour(page);
    await fermerVoix(page);
    await carte(page).locator('.agent-pied-discuter').click();
    await expect(carte(page)).toHaveCount(0);
    await expect(bulle(page).locator('.agent-bilan')).toContainText('1 tour de parole');
    await expect(bulle(page).locator('.agent-message')).toHaveCount(2);
    await expect(bulle(page).locator('.agent-bulle-micro')).toBeVisible();
    // Pas venue de la marge : pas de poubelle.
    await expect(bulle(page).locator('.agent-pied-poubelle')).toBeHidden();
    await bulle(page).locator('.agent-bulle-fermer').click();
    await expect(traces(page)).toHaveAttribute('aria-label', /^Discussion orale : /);

    const avant = await nbTraits(page);
    await traces(page).click();
    await bulle(page).locator('.agent-pied-poubelle').click();
    await bulle(page).locator('.agent-pied-supprimer').click();
    await expect(bulle(page)).toHaveCount(0);
    await expect(traces(page)).toHaveCount(0);
    expect(await nbTraits(page)).toBe(avant - 1);
});
