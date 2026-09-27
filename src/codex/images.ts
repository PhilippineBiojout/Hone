import type { App } from 'fragment';

// Les images de Visualiser. Codex les génère (outil image_generation, permis au seul
// profil visualiser) et les rend en base64 ; Hone les range dans images/, à côté de
// data.json, et la carte ne garde que le chemin : sinon traces.json prendrait un
// mégaoctet par image.

const FORMATS: [prefixe: string, extension: string][] = [['iVBOR', 'png'], ['/9j/', 'jpg'], ['UklGR', 'webp']];

export function dossierImages(app: App): string {
    return `${app.plugins.pluginsDir}/hone/images`;
}

/** Écrit l'image reçue de Codex ; rend son chemin, ou null si ce n'est pas une image connue. */
export async function rangerImage(app: App, base64: string): Promise<string | null> {
    const extension = FORMATS.find(([prefixe]) => base64.startsWith(prefixe))?.[1];
    if (!extension) return null;
    const octets = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const adapter = app.vault.adapter;
    const dossier = dossierImages(app);
    if (!(await adapter.exists(dossier))) await adapter.mkdir(dossier);
    const chemin = `${dossier}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
    await adapter.writeBinary(chemin, octets.buffer);
    return chemin;
}

/** Vrai seulement pour un fichier rangé par rangerImage : la carte n'affiche rien d'autre. */
export function imageSure(app: App, chemin: string): boolean {
    const dossier = `${dossierImages(app)}/`;
    return chemin.startsWith(dossier) && /^[a-z0-9]+-[a-z0-9]+\.(png|jpg|webp)$/.test(chemin.slice(dossier.length));
}
