import { test, expect, _electron, type ElectronApplication, type Page } from '@playwright/test';
import { cp, mkdtemp, mkdir, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

/**
 * La discussion orale (VoixAgent.ts) : le micro de la barre, après la tête de
 * chat, fait sortir une lumière du bas du panneau (voice-glow, libraries.dev/voice),
 * sans boîte. Elle suit le micro ; le rond ■ finit le tour, l'agent répond à voix
 * haute, la croix rend le micro.
 *
 * Pas de vrai micro : `getUserMedia` est remplacé dans la page par un
 * oscillateur à 220 Hz dont on règle le volume, et la synthèse vocale par un
 * faux qui « parle » 1,5 s (assez pour que l'attente de Playwright voie l'état).
 *
 * Se lance comme agent-widget.spec.ts, dont le harnais est recopié :
 *     npx playwright test e2e/agent-voix.spec.ts --workers=1
 */

const NB_LIGNES = 200;
const CONTENU = Array.from({ length: NB_LIGNES }, (_, i) =>
    i === 0
        ? '# Document de test pour l\'agent'
        : `Ligne ${i} : la Révolution française commence en 1789.`,
).join('\n');

interface Harnais {
    electronApp: ElectronApplication;
    page: Page;
}

async function fenetreApp(electronApp: ElectronApplication): Promise<Page> {
    const fin = Date.now() + 30_000;
    while (Date.now() < fin) {
        for (const w of electronApp.windows()) {
            if (w.url().includes('localhost:5123')) return w;
        }
        await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error('fenêtre app introuvable');
}

async function lancer(): Promise<Harnais> {
    const base = await mkdtemp(path.join(os.tmpdir(), 'prom-agent-'));
    const vault = path.join(base, 'vault');
    const userData = path.join(base, 'userdata');

    await mkdir(vault, { recursive: true });
    await mkdir(userData, { recursive: true });
    await writeFile(path.join(vault, 'note.md'), CONTENU, 'utf8');
    await cp('/Users/philippinebiojout/Documents/IA/fragment-notes/.fragment/plugins/hone', path.join(vault, '.fragment/plugins/hone'), { recursive: true, // Ni node_modules, ni le .env (la clé ne sort pas du plugin : sans lui, l'agent répond en factice), ni le journal des coûts.
        filter: (src) => !src.includes('node_modules') && !/[\\/](\.env|couts\.jsonl)$/.test(src) });
    // Depuis le cœur 3c4dbe4, un coffre sans community-plugins.json est en mode restreint : rien ne se charge.
    await writeFile(path.join(vault, '.fragment/community-plugins.json'), JSON.stringify(['hone']), 'utf8');
    await writeFile(path.join(userData, 'config.json'), JSON.stringify({ vaultRoot: vault }), 'utf8');

    const electronApp = await _electron.launch({
        args: ['.', `--user-data-dir=${userData}`],
        env: { ...process.env, NODE_ENV: 'development' } as Record<string, string>,
    });

    const page = await fenetreApp(electronApp);
    await page.waitForFunction(
        () => {
            const w = window as unknown as { app?: any };
            const leaves = w.app?.workspace?.getLeavesOfType?.('markdown') ?? [];
            return leaves.length > 0 && !!leaves[0].view?.editor;
        },
        undefined,
        { timeout: 30_000 },
    );
    // Assez large pour la colonne, la barre et le chat côte à côte.
    await page.setViewportSize({ width: 1400, height: 800 });

    // Le calque d'annotation est désactivé d'office : on l'arme.
    await page.evaluate(() => {
        const w = window as unknown as { app: any };
        w.app.workspace.getLeavesOfType('markdown')[0].view.toggleLayer('annotation');
    });
    await page.waitForSelector('.annotation-surface', { state: 'attached' });
    return { electronApp, page };
}

/** Le rectangle CLIENT de la première ligne rendue qui contient `texte`. */
async function ligne(page: Page, texte: string) {
    const loc = page.locator('.cm-line', { hasText: texte }).first();
    const box = await loc.boundingBox();
    if (!box) throw new Error(`ligne introuvable : ${texte}`);
    return box;
}

/**
 * La boîte CLIENT d'un morceau de texte d'une ligne, mesurée par un Range DOM :
 * c'est ce qu'on veut entourer ou surligner, au pixel près.
 */
async function boiteDuMot(page: Page, ligneTexte: string, mot: string) {
    return page.evaluate(({ ligneTexte, mot }) => {
        const el = [...document.querySelectorAll('.cm-line')].find((l) => l.textContent?.includes(ligneTexte))!;
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            const i = n.textContent!.indexOf(mot);
            if (i < 0) continue;
            const r = document.createRange();
            r.setStart(n, i);
            r.setEnd(n, i + mot.length);
            const b = r.getBoundingClientRect();
            return { x: b.left, y: b.top, width: b.width, height: b.height };
        }
        throw new Error(`mot introuvable : ${mot}`);
    }, { ligneTexte, mot });
}

async function armer(page: Page, outil: 'Crayon' | 'Surligneur'): Promise<void> {
    const item = page.locator(`.toolbar-item[aria-label="${outil}"]`);
    // Cliquer un outil déjà armé le désarme : on ne clique que s'il ne l'est pas.
    if (!(await item.evaluate((el) => el.classList.contains('is-active')))) await item.click();
}

async function trace(page: Page, points: { x: number; y: number }[]): Promise<void> {
    await page.mouse.move(points[0].x, points[0].y);
    await page.mouse.down();
    for (const p of points.slice(1)) await page.mouse.move(p.x, p.y);
    await page.mouse.up();
}

/** Surligne un mot d'une ligne, d'un bord à l'autre. */
async function surligner(page: Page, ligneTexte: string, mot: string): Promise<void> {
    await armer(page, 'Surligneur');
    const b = await boiteDuMot(page, ligneTexte, mot);
    const y = b.y + b.height / 2;
    const pts = Array.from({ length: 8 }, (_, i) => ({ x: b.x + 2 + ((b.width - 4) * i) / 7, y }));
    await trace(page, pts);
}

/** Entoure un mot d'une ellipse au crayon. */
async function entourer(page: Page, ligneTexte: string, mot: string): Promise<void> {
    await armer(page, 'Crayon');
    const b = await boiteDuMot(page, ligneTexte, mot);
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    const rx = b.width / 2 + 5;
    const ry = b.height / 2 + 6;
    const pts = [];
    for (let a = 0; a <= Math.PI * 2 - 0.25; a += 0.2) pts.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
    await trace(page, pts);
}

const barre = (page: Page) => page.locator('.agent-barre');
const voix = (page: Page) => page.locator('.agent-voix');
const micro = (page: Page) => barre(page).locator('[aria-label="Parler à Hone"]');
const stop = (page: Page) => voix(page).locator('.agent-voix-stop');

const nbTraits = (page: Page) => page.evaluate(() => {
    const w = window as unknown as { app: any };
    return w.app.plugins.plugins.get('annotation').source.strokes('note.md').length as number;
});

/** Le faux micro et la fausse voix ; `refuser` fait échouer getUserMedia. */
async function simulerAudio(page: Page, refuser = false): Promise<void> {
    await page.evaluate((refuser) => {
        const w = window as unknown as { __voix: any };
        const etat = { pistes: [] as MediaStreamTrack[], gains: [] as GainNode[], niveau: 0, dits: [] as string[] };
        w.__voix = etat;
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

async function volume(page: Page, niveau: number): Promise<void> {
    await page.evaluate((niveau) => {
        const v = (window as unknown as { __voix: any }).__voix;
        v.niveau = niveau;
        for (const g of v.gains) g.gain.value = niveau;
    }, niveau);
}

/** La lueur de voice-glow : son enveloppe porte data-voice-type, et data-processing quand elle balaie. */
const lueur = (page: Page) => voix(page).locator('.agent-voix-lueur [data-voice-type]');

/** Surligne un passage, puis ouvre la discussion orale par le micro de la barre. */
async function ouvrirVoix(page: Page): Promise<void> {
    await surligner(page, 'Ligne 3 :', 'Révolution');
    await expect(barre(page)).toBeVisible();
    await micro(page).click();
    await expect(voix(page)).toBeVisible();
}

/** Attend la fin de la montée : plus aucune animation sur la barre. */
async function attendrePosee(page: Page): Promise<void> {
    await expect(voix(page)).toHaveClass(/est-posee/, { timeout: 4_000 });
}

let h: Harnais;

test.beforeEach(async () => {
    h = await lancer();
});

test.afterEach(async () => {
    await h.electronApp.close();
});

test('le micro est dans la barre courte, juste après la tête de chat', async () => {
    const { page } = h;
    await surligner(page, 'Ligne 3 :', 'Révolution');
    await expect(barre(page)).toBeVisible();
    // La barre est une Toolbar du cœur : ses items sont des .toolbar-item.
    const libelles = await barre(page).locator('.toolbar-item:visible').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
    expect(libelles).toEqual(["Discuter avec Hone", "Parler à Hone", 'Définir', 'Visualiser', "Plus d'outils"]);
});

test('le micro fait sortir la lumière du bas du panneau : pas de boîte, deux ronds centrés', async () => {
    const { page } = h;
    await simulerAudio(page);
    await surligner(page, 'Ligne 3 :', 'Révolution');
    await expect(barre(page)).toBeVisible();
    await micro(page).click();
    await expect(barre(page)).toHaveCount(0);
    await expect(voix(page)).toHaveAttribute('data-etat', 'ecoute', { timeout: 4_000 });
    await attendrePosee(page);
    // L'état se lit dans la lumière : la ligne n'est là que pour les lecteurs d'écran.
    await expect(voix(page).locator('.agent-voix-message')).toHaveText('Je vous écoute…');
    await expect(voix(page).locator('.agent-voix-message')).not.toHaveClass(/est-visible/);

    // Pas de boîte : ni fond, ni filet, ni ombre, et les clics passent au travers.
    const style = await voix(page).evaluate((el) => {
        const c = getComputedStyle(el);
        return { fond: c.backgroundColor, filet: c.borderTopWidth, ombre: c.boxShadow, clics: c.pointerEvents };
    });
    expect(style).toEqual({ fond: 'rgba(0, 0, 0, 0)', filet: '0px', ombre: 'none', clics: 'none' });

    // 500 px (moins dans un panneau étroit), centrée, collée au bas du panneau.
    const b = (await voix(page).boundingBox())!;
    const pane = await page.evaluate(() => {
        const w = window as unknown as { app: any };
        const r = (w.app.workspace.getLeavesOfType('markdown')[0].view.contentEl as HTMLElement).getBoundingClientRect();
        return { x: r.left, width: r.width, bas: r.bottom };
    });
    expect(b.width).toBeCloseTo(Math.min(500, pane.width - 32), 0);
    expect(b.x + b.width / 2).toBeCloseTo(pane.x + pane.width / 2, -1);
    expect(b.y + b.height).toBeCloseTo(pane.bas, 0);

    // Deux ronds de 40 px, centrés, 12 px entre eux, à 28 px du bas : arrêter de parler, puis fermer.
    const s = (await stop(page).boundingBox())!;
    const f = (await voix(page).locator('.agent-voix-fermer').boundingBox())!;
    expect(s.width).toBeCloseTo(40, 0);
    expect(f.width).toBeCloseTo(40, 0);
    expect(f.x - (s.x + s.width)).toBeCloseTo(12, 0);
    expect((s.x + f.x + f.width) / 2).toBeCloseTo(b.x + b.width / 2, 0);
    expect(b.y + b.height - (f.y + f.height)).toBeCloseTo(28, 0);
    await expect(stop(page)).toHaveAttribute('aria-label', 'Finir de parler');
});

test('l\'ancien plugin agent, s\'il est activé, ne remet pas de boîte autour de la lumière', async () => {
    const { page } = h;
    // Sa feuille habille tout `.agent-voix` (fond, filet, ombre, rayon 24, 48 × 48, contenu en flex).
    await page.addStyleTag({ path: '/Users/philippinebiojout/Documents/IA/fragment-notes/.fragment/plugins/agent/styles.css' });
    await simulerAudio(page);
    await ouvrirVoix(page);
    await expect(voix(page)).toHaveAttribute('data-etat', 'ecoute', { timeout: 4_000 });
    await attendrePosee(page);
    const style = await voix(page).evaluate((el) => {
        const c = getComputedStyle(el);
        return { fond: c.backgroundColor, filet: c.borderTopWidth, ombre: c.boxShadow, rayon: c.borderTopLeftRadius, hauteur: c.height };
    });
    expect(style).toEqual({ fond: 'rgba(0, 0, 0, 0)', filet: '0px', ombre: 'none', rayon: '0px', hauteur: '160px' });
    for (const rond of [stop(page), voix(page).locator('.agent-voix-fermer')]) {
        const b = (await rond.boundingBox())!;
        expect(b.width).toBeCloseTo(40, 0);
        expect(await rond.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe('50%');
    }
});

test('sous la lumière, le texte de la note reste cliquable', async () => {
    const { page } = h;
    await simulerAudio(page);
    await ouvrirVoix(page);
    await attendrePosee(page);
    const b = (await voix(page).boundingBox())!;
    // Dans la zone de la lumière, hors des ronds : le point touche la note, pas la voix.
    const cible = await page.evaluate(({ x, y }) => {
        const el = document.elementFromPoint(x, y);
        return { voix: !!el?.closest('.agent-voix'), note: !!el?.closest('.cm-editor') };
    }, { x: b.x + 40, y: b.y + 40 });
    expect(cible).toEqual({ voix: false, note: true });
});

test('la barre reste en bas quand on fait défiler la note', async () => {
    const { page } = h;
    await simulerAudio(page);
    await ouvrirVoix(page);
    await attendrePosee(page);
    const avant = (await voix(page).boundingBox())!;
    await page.mouse.move(600, 300);
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(300);
    const apres = (await voix(page).boundingBox())!;
    expect(apres.y).toBeCloseTo(avant.y, 0);
});

test('la lueur de voice-glow est là, et balaie pendant que l\'agent réfléchit', async () => {
    const { page } = h;
    await simulerAudio(page);
    await ouvrirVoix(page);
    await expect(voix(page)).toHaveAttribute('data-etat', 'ecoute', { timeout: 4_000 });
    await expect(lueur(page)).toHaveCount(1);
    await expect(lueur(page)).toHaveAttribute('data-voice-type', 'default');
    await expect(lueur(page)).not.toHaveAttribute('data-processing', /.*/);
    // Sous le contenu : elle ne prend jamais un clic.
    expect(await voix(page).locator('.agent-voix-lueur').evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');

    await volume(page, 1);
    await page.waitForTimeout(300);
    await stop(page).click();
    await expect(voix(page)).toHaveAttribute('data-etat', 'reflechit');
    await expect(voix(page).locator('.agent-voix-message')).toHaveText('Hone réfléchit…');
    await expect(lueur(page)).toHaveAttribute('data-processing', /.*/);
    await expect(voix(page)).toHaveAttribute('data-etat', 'repond', { timeout: 4_000 });
    await expect(lueur(page)).not.toHaveAttribute('data-processing', /.*/);
    // La réponse s'écrit sur la ligne d'état (lue par les lecteurs d'écran).
    await expect(voix(page).locator('.agent-voix-message')).toContainText('numéro 1');
    // Pendant que Hone parle, le même bouton coupe sa voix.
    await expect(stop(page)).toHaveAttribute('aria-label', 'Couper la parole à Hone');
});

test('le micro de la barre orale envoie le tour : l\'agent réfléchit, répond à voix haute, puis la barre écoute de nouveau', async () => {
    const { page } = h;
    await simulerAudio(page);
    await ouvrirVoix(page);
    await expect(voix(page)).toHaveAttribute('data-etat', 'ecoute', { timeout: 4_000 });
    await volume(page, 1);
    await page.waitForTimeout(300);
    await stop(page).click();
    await expect(voix(page)).toHaveAttribute('data-etat', 'reflechit');
    await expect(stop(page)).toBeDisabled();
    await expect(voix(page)).toHaveAttribute('data-etat', 'repond', { timeout: 4_000 });
    const dits = await page.evaluate(() => (window as unknown as { __voix: any }).__voix.dits as string[]);
    expect(dits).toHaveLength(1);
    expect(dits[0]).toContain('numéro 1');
    expect(dits[0]).toContain('ton enregistrement');
    await expect(voix(page)).toHaveAttribute('data-etat', 'ecoute', { timeout: 4_000 });

    // Deuxième tour : l'historique a gardé le premier.
    await stop(page).click();
    await expect(voix(page)).toHaveAttribute('data-etat', 'repond', { timeout: 4_000 });
    const dits2 = await page.evaluate(() => (window as unknown as { __voix: any }).__voix.dits as string[]);
    expect(dits2[1]).toContain('numéro 2');
});

test('la croix ferme la barre, rend le micro et retire la lueur', async () => {
    const { page } = h;
    await simulerAudio(page);
    await ouvrirVoix(page);
    await attendrePosee(page);
    await voix(page).locator('[aria-label="Fermer"]').click();
    await expect(voix(page)).toHaveCount(0);
    await expect(page.locator('.agent-voix-lueur')).toHaveCount(0);
    await expect(page.locator('.agent-zone')).toHaveCount(0);
    const etats = await page.evaluate(() =>
        ((window as unknown as { __voix: any }).__voix.pistes as MediaStreamTrack[]).map((p) => p.readyState));
    expect(etats.length).toBeGreaterThan(0);
    expect(etats.every((e) => e === 'ended')).toBe(true);
});

test('barre ouverte : un trait à côté ne pose rien', async () => {
    const { page } = h;
    await simulerAudio(page);
    await ouvrirVoix(page);
    await attendrePosee(page);
    const avant = await nbTraits(page);
    await surligner(page, 'Ligne 8 :', 'commence');
    expect(await nbTraits(page)).toBe(avant);
    await expect(barre(page)).toHaveCount(0);
    await expect(voix(page)).toBeVisible();
});

test('micro refusé : la barre le dit, et sa croix la ferme', async () => {
    const { page } = h;
    await simulerAudio(page, true);
    await ouvrirVoix(page);
    await expect(voix(page)).toHaveAttribute('data-etat', 'refuse', { timeout: 4_000 });
    await expect(voix(page).locator('.agent-voix-message')).toHaveText('Micro refusé');
    await expect(voix(page).locator('.agent-voix-message')).toBeVisible();
    await expect(stop(page)).toBeHidden();
    await voix(page).locator('[aria-label="Fermer"]').click();
    await expect(voix(page)).toHaveCount(0);
});

// ── Le bilan, la trace dans la marge, la reprise au micro ──────────────────

const carte = (page: Page) => page.locator('.agent-action-carte');
const bulle = (page: Page) => page.locator('.agent-bulle');
const traces = (page: Page) => page.locator('.agent-trace');

/** Un tour de parole complet : on parle, micro, l'agent répond, la barre écoute de nouveau. */
async function unTour(page: Page): Promise<void> {
    await expect(voix(page)).toHaveAttribute('data-etat', 'ecoute', { timeout: 4_000 });
    await volume(page, 1);
    await page.waitForTimeout(300);
    await stop(page).click();
    await expect(voix(page)).toHaveAttribute('data-etat', 'repond', { timeout: 4_000 });
    await expect(voix(page)).toHaveAttribute('data-etat', 'ecoute', { timeout: 4_000 });
}

/** La croix de la barre, puis la carte du bilan arrivée. */
async function fermerVoix(page: Page): Promise<void> {
    await voix(page).locator('[aria-label="Fermer"]').click();
    await expect(voix(page)).toHaveCount(0);
    await expect(carte(page)).toBeVisible({ timeout: 4_000 });
}

test('après un tour, la croix de la barre ouvre la carte du bilan', async () => {
    const { page } = h;
    await simulerAudio(page);
    await ouvrirVoix(page);
    await unTour(page);
    await voix(page).locator('[aria-label="Fermer"]').click();
    // Le rond du micro tourne pendant que le bilan s'écrit.
    await expect(page.locator('.agent-action-cercle')).toBeVisible();
    await expect(carte(page)).toBeVisible({ timeout: 4_000 });
    await expect(carte(page).locator('.agent-action-titre')).toHaveText('Bilan');
    await expect(carte(page).locator('.agent-action-corps')).toContainText('1 tour de parole');
    // Le passage reste surligné tant que la carte est ouverte.
    await expect(page.locator('.agent-zone').first()).toBeAttached();
});

test('sans aucun tour, la croix ne laisse ni bilan ni trace', async () => {
    const { page } = h;
    await simulerAudio(page);
    await ouvrirVoix(page);
    await attendrePosee(page);
    await voix(page).locator('[aria-label="Fermer"]').click();
    await page.waitForTimeout(1_500);
    await expect(carte(page)).toHaveCount(0);
    await expect(page.locator('.agent-action-cercle')).toHaveCount(0);
    await expect(traces(page)).toHaveCount(0);
});

test('la croix du bilan laisse un micro dans la marge gauche, qui rouvre la discussion par écrit', async () => {
    const { page } = h;
    await simulerAudio(page);
    await ouvrirVoix(page);
    await unTour(page);
    await fermerVoix(page);
    await carte(page).locator('[aria-label="Fermer"]').click();
    await expect(carte(page)).toHaveCount(0);

    await expect(traces(page)).toHaveCount(1);
    await expect(traces(page)).toHaveAttribute('aria-label', /^Discussion orale : /);
    // Dans la marge GAUCHE : avant le début de la ligne.
    const ligne3 = await ligne(page, 'Ligne 3 :');
    expect((await traces(page).boundingBox())!.x).toBeLessThan(ligne3.x);

    await traces(page).click();
    await expect(bulle(page)).toBeVisible();
    await expect(barre(page)).toHaveCount(0);
    await expect(bulle(page).locator('.agent-bilan')).toContainText('Bilan');
    await expect(bulle(page).locator('.agent-bilan')).toContainText('1 tour de parole');
    // Le fil s'ouvre sur le bilan, pas sur la fin.
    expect(await bulle(page).locator('.agent-bulle-fil').evaluate((el) => el.scrollTop)).toBe(0);
    const messages = bulle(page).locator('.agent-message');
    await expect(messages).toHaveCount(2);
    await expect(messages.nth(0)).toHaveClass(/mod-moi/);
    await expect(messages.nth(0)).toHaveText('Transcription factice du tour 1.');
    await expect(messages.nth(1)).toContainText('numéro 1');
    await expect(bulle(page).locator('.agent-bulle-micro')).toBeVisible();
    await expect(bulle(page).locator('.agent-pied-poubelle')).toBeVisible();

    // Refermée sans rien changer : toujours une seule trace, toujours orale.
    await bulle(page).locator('.agent-bulle-fermer').click();
    await expect(traces(page)).toHaveCount(1);
    await expect(traces(page)).toHaveAttribute('aria-label', /^Discussion orale : /);
});

test('le micro du chat reprend la discussion à voix haute, et le nouveau bilan remplace l\'ancien', async () => {
    const { page } = h;
    await simulerAudio(page);
    await ouvrirVoix(page);
    await unTour(page);
    await fermerVoix(page);
    await carte(page).locator('[aria-label="Fermer"]').click();
    await traces(page).click();
    await expect(bulle(page)).toBeVisible();

    await bulle(page).locator('.agent-bulle-micro').click();
    await expect(bulle(page)).toHaveCount(0);
    await expect(voix(page)).toBeVisible();
    await unTour(page);
    // L'historique a gardé le premier tour.
    const dits = await page.evaluate(() => (window as unknown as { __voix: any }).__voix.dits as string[]);
    expect(dits.at(-1)).toContain('numéro 2');

    await fermerVoix(page);
    await expect(carte(page).locator('.agent-action-corps')).toContainText('2 tours de parole');
    await carte(page).locator('[aria-label="Fermer"]').click();
    await expect(traces(page)).toHaveCount(1);

    await traces(page).click();
    await expect(bulle(page).locator('.agent-bilan')).toContainText('2 tours de parole');
    await expect(bulle(page).locator('.agent-message')).toHaveCount(4);
});

test('la tête de chat de la carte bilan la change en chat oral', async () => {
    const { page } = h;
    await simulerAudio(page);
    await ouvrirVoix(page);
    await unTour(page);
    await fermerVoix(page);
    await carte(page).locator('.agent-pied-discuter').click();
    await expect(carte(page)).toHaveCount(0);
    await expect(bulle(page)).toBeVisible();
    await expect(bulle(page).locator('.agent-bilan')).toContainText('1 tour de parole');
    await expect(bulle(page).locator('.agent-message')).toHaveCount(2);
    await expect(bulle(page).locator('.agent-bulle-micro')).toBeVisible();
    // Pas venue de la marge : pas de poubelle.
    await expect(bulle(page).locator('.agent-pied-poubelle')).toBeHidden();
    await bulle(page).locator('.agent-bulle-fermer').click();
    await expect(traces(page)).toHaveCount(1);
    await expect(traces(page)).toHaveAttribute('aria-label', /^Discussion orale : /);
});

test('la poubelle d\'une discussion orale rouverte efface la trace et le trait', async () => {
    const { page } = h;
    await simulerAudio(page);
    await ouvrirVoix(page);
    await unTour(page);
    await fermerVoix(page);
    await carte(page).locator('[aria-label="Fermer"]').click();
    const avant = await nbTraits(page);
    await traces(page).click();
    await bulle(page).locator('.agent-pied-poubelle').click();
    await bulle(page).locator('.agent-pied-supprimer').click();
    await expect(bulle(page)).toHaveCount(0);
    await expect(traces(page)).toHaveCount(0);
    expect(await nbTraits(page)).toBe(avant - 1);
});

test('reprise au micro puis croix sans un mot : pas de nouveau bilan, la trace garde l\'ancien', async () => {
    const { page } = h;
    await simulerAudio(page);
    await ouvrirVoix(page);
    await unTour(page);
    await fermerVoix(page);
    await carte(page).locator('[aria-label="Fermer"]').click();
    await traces(page).click();
    await bulle(page).locator('.agent-bulle-micro').click();
    await expect(voix(page)).toHaveAttribute('data-etat', 'ecoute', { timeout: 4_000 });
    await voix(page).locator('[aria-label="Fermer"]').click();
    await expect(voix(page)).toHaveCount(0);
    await page.waitForTimeout(1_500);
    await expect(carte(page)).toHaveCount(0);
    await expect(page.locator('.agent-action-cercle')).toHaveCount(0);
    await expect(traces(page)).toHaveCount(1);
    await traces(page).click();
    await expect(bulle(page).locator('.agent-bilan')).toContainText('1 tour de parole');
    await expect(bulle(page).locator('.agent-message')).toHaveCount(2);
});
