import { test, expect } from '@playwright/test';
import { readdir, readFile } from 'fs/promises';
import path from 'path';
import { deflateSync } from 'zlib';
import { createRequire } from 'module';
import { lancerInstallee, PLUGIN, type Harnais } from './hone-commun';

// pdf-lib vient du plugin : c'est lui qui écrit le PDF, lui qui le relit.
const { PDFDocument } = createRequire(path.join(PLUGIN, 'package.json'))('pdf-lib') as typeof import('pdf-lib');

/**
 * Le scan en PDF, dans l'app installée sur une copie de fragment-notes, par le vrai relais :
 * un faux téléphone (Node) rejoint la session du bureau et envoie des pages comme le site.
 * Deux pages donnent un PDF de deux pages, ouvert dans un onglet ; mettre à jour la page 1
 * refait le PDF (toujours deux pages) et met l'ancienne image à la corbeille.
 */

test.describe.configure({ timeout: 180_000 });

const RELAIS = 'wss://hone-relay.lasky.workers.dev';

/** Un PNG uni, assez pour pdf-lib : signature, IHDR, IDAT, IEND. */
function png(largeur: number, hauteur: number, [r, g, b]: [number, number, number]): Buffer {
    const crcTable = Array.from({ length: 256 }, (_, n) => {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        return c >>> 0;
    });
    const crc = (buf: Buffer) => {
        let c = 0xffffffff;
        for (const o of buf) c = crcTable[(c ^ o) & 0xff] ^ (c >>> 8);
        return (c ^ 0xffffffff) >>> 0;
    };
    const bloc = (type: string, data: Buffer) => {
        const t = Buffer.concat([Buffer.from(type, 'ascii'), data]);
        const out = Buffer.alloc(8 + data.length + 4);
        out.writeUInt32BE(data.length, 0);
        t.copy(out, 4);
        out.writeUInt32BE(crc(t), 8 + data.length);
        return out;
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(largeur, 0);
    ihdr.writeUInt32BE(hauteur, 4);
    ihdr[8] = 8; ihdr[9] = 2; // 8 bits, RGB
    const ligne = Buffer.concat([Buffer.from([0]), Buffer.alloc(largeur * 3).map((_, i) => [r, g, b][i % 3])]);
    const brut = Buffer.concat(Array.from({ length: hauteur }, () => ligne));
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        bloc('IHDR', ihdr), bloc('IDAT', deflateSync(brut)), bloc('IEND', Buffer.alloc(0)),
    ]);
}

/** Le faux téléphone : même protocole que docs/main.js de Hone-web_scan. */
async function telephone(session: string) {
    const ws = new WebSocket(`${RELAIS}/session/${session}?role=phone`);
    const recus = new Set<string>();
    let bureau = false;
    ws.addEventListener('message', (e) => {
        if (typeof e.data !== 'string') return;
        const m = JSON.parse(e.data);
        if (m.type === 'photo-received') recus.add(m.id);
        if (m.type === 'peer' && m.role === 'desktop') bureau = m.connected === true;
    });
    await new Promise<void>((ok, ko) => { ws.addEventListener('open', () => ok()); ws.addEventListener('error', ko); });
    // Comme le site : rien ne part tant que le relais n'a pas annoncé le bureau.
    await expect.poll(() => bureau, { timeout: 20_000 }).toBe(true);
    const doc = crypto.randomUUID();
    return {
        async envoyer(page: number, image: Buffer, replace = false) {
            const id = crypto.randomUUID();
            ws.send(JSON.stringify({ type: 'photo-start', id, mime: 'image/png', size: image.length, doc, page, replace }));
            ws.send(image);
            ws.send(JSON.stringify({ type: 'photo-end', id }));
            await expect.poll(() => recus.has(id), { timeout: 30_000 }).toBe(true);
        },
        fermer: () => ws.close(),
    };
}

/** Ses pages sont dans des flux compressés : on compte avec pdf-lib, pas dans le texte. */
async function nbPages(fichier: string): Promise<number> {
    const octets = await readFile(fichier).catch(() => null);
    if (!octets?.length) return 0;
    return (await PDFDocument.load(octets)).getPageCount();
}

let h: Harnais;
test.afterEach(async () => { await h?.electronApp.close(); });

test('deux pages scannées donnent un PDF de deux pages ; mettre à jour la page 1 le refait', async () => {
    h = await lancerInstallee();
    const { electronApp, vault } = h;
    // L'id de session ne sort que dans le QR : on relève l'adresse du WebSocket du bureau,
    // puis on recharge pour que le plugin rouvre sa session sous nos yeux.
    await electronApp.context().addInitScript(() => {
        const W = window.WebSocket;
        (window as unknown as { __ws: WebSocket[] }).__ws = [];
        window.WebSocket = class extends W {
            constructor(url: string | URL, p?: string | string[]) {
                super(url, p);
                (window as unknown as { __ws: WebSocket[] }).__ws.push(this);
            }
        } as typeof WebSocket;
    });
    const page = h.page;
    await page.reload();
    await page.waitForFunction(() => !!(window as any).app?.commands?.findCommand('hone:open-codex-panel'), undefined, { timeout: 30_000 });
    // Le relais refuse un téléphone tant que le bureau n'est pas en ligne (4404) : on attend l'ouverture.
    const adresse = await page.waitForFunction(
        () => (window as unknown as { __ws: WebSocket[] }).__ws
            .find((w) => w.url.includes('role=desktop') && w.readyState === WebSocket.OPEN)?.url,
        undefined, { timeout: 20_000 },
    ).then((r) => r.jsonValue() as Promise<string>);
    const session = /session\/([^?]+)/.exec(adresse)![1];

    const tel = await telephone(session);
    try {
        await tel.envoyer(1, png(200, 280, [220, 40, 40]));
        await tel.envoyer(2, png(200, 280, [40, 40, 220]));

        // Le PDF du document, dans son dossier à la racine du coffre, avec deux pages
        const dossier = async () => (await readdir(vault)).find((n) => n.startsWith('Scan '));
        await expect.poll(dossier, { timeout: 20_000 }).toBeTruthy();
        const nom = (await dossier())!;
        const pdf = path.join(vault, nom, `${nom}.pdf`);
        await expect.poll(() => nbPages(pdf), { timeout: 20_000 }).toBe(2);
        await expect(page.locator('.workspace-tab-header', { hasText: nom }).first()).toBeVisible();
        // Les images des pages restent à côté du PDF (nommées .jpg par pages.ts, quel que soit le format)
        const images = async () => (await readdir(path.join(vault, nom))).filter((n) => !n.endsWith('.pdf'));
        expect(await images()).toHaveLength(2);

        // Mise à jour de la page 1 : toujours deux pages, et l'ancienne image est partie
        const avant = await readFile(pdf);
        await page.waitForTimeout(1100); // l'heure dans le nom de l'image change à la seconde
        await tel.envoyer(1, png(200, 280, [40, 180, 40]), true);
        await expect.poll(async () => (await readFile(pdf)).equals(avant), { timeout: 20_000 }).toBe(false);
        expect(await nbPages(pdf)).toBe(2);
        await expect.poll(async () => (await images()).length, { timeout: 10_000 }).toBe(2);
        await page.screenshot({ path: 'test-results/hone-scan-pdf.png' });
    } finally {
        tel.fermer();
    }
});
