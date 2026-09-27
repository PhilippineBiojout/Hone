import { describe, expect, it } from 'vitest';
import type { App } from 'fragment';
import { dossierImages, imageSure, rangerImage } from '../codex/images';

// Un faux coffre : il retient ce qu'on écrit.
function fauxApp() {
    const ecrits = new Map<string, ArrayBuffer>();
    const dossiers = new Set<string>();
    const app = {
        plugins: { pluginsDir: '.fragment/plugins' },
        vault: {
            adapter: {
                exists: async (p: string) => dossiers.has(p) || ecrits.has(p),
                mkdir: async (p: string) => void dossiers.add(p),
                writeBinary: async (p: string, d: ArrayBuffer) => void ecrits.set(p, d),
            },
        },
    } as unknown as App;
    return { app, ecrits, dossiers };
}

describe('images de Visualiser', () => {
    it('range une image PNG dans le dossier du plugin, octets décodés', async () => {
        const { app, ecrits, dossiers } = fauxApp();
        const png = btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a));
        const chemin = await rangerImage(app, png);

        expect(chemin).toMatch(/^\.fragment\/plugins\/hone\/images\/[a-z0-9]+-[a-z0-9]+\.png$/);
        expect(dossiers.has(dossierImages(app))).toBe(true);
        expect([...new Uint8Array(ecrits.get(chemin!)!)].slice(0, 4)).toEqual([0x89, 0x50, 0x4e, 0x47]);
        expect(imageSure(app, chemin!)).toBe(true);
    });

    it('refuse ce qui n\'est pas une image connue', async () => {
        const { app, ecrits } = fauxApp();
        expect(await rangerImage(app, btoa('<svg onload="x">'))).toBeNull();
        expect(ecrits.size).toBe(0);
    });

    it('la carte n\'affiche qu\'un fichier rangé par Hone', () => {
        const { app } = fauxApp();
        expect(imageSure(app, '.fragment/plugins/hone/images/abc-def.png')).toBe(true);
        expect(imageSure(app, '.fragment/plugins/hone/images/../data.json')).toBe(false);
        expect(imageSure(app, '.fragment/plugins/hone/images/abc-def.svg')).toBe(false);
        expect(imageSure(app, 'poly/abc-def.png')).toBe(false);
        expect(imageSure(app, 'https://exemple.fr/abc-def.png')).toBe(false);
    });
});
