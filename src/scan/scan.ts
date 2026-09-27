import { Modal, Notice, type App, type Plugin } from 'fragment';
import QRCodeStyling from 'qr-code-styling';
import { imageName, pageLine, putPage } from './pages';
import { Relais, type PhotoMeta } from './relais';

// Scanner des feuilles avec le téléphone : une icône de ruban montre un QR code,
// un relais WebSocket relie le téléphone au bureau, et les photos reçues se rangent
// dans « Scans/ ». Les pages d'un même document vont dans UNE seule note, les unes
// à la suite des autres (une image par page) ; mettre à jour une page remplace son
// image. Pas de transcription ici : le texte, c'est Codex qui s'en charge dans Fragment.
// Le site du téléphone et le relais vivent dans le dépôt Hone-web_scan
// (GitHub Pages + worker Cloudflare) ; ici, seul le côté bureau.
// Retrait : ce fichier, `relais.ts`, `pages.ts`, l'appel dans main.ts, la section de styles.css.

/** Le site que le téléphone ouvre : les pages GitHub du dossier docs/ de Hone-web_scan. */
const SITE_URL = 'https://philippinebiojout.github.io/Hone-web_scan/';

/** Durée de l'animation de fermeture — la même que dans styles.css. */
const CLOSE_MS = 140;

/**
 * Branche « scanner une feuille » sur le plugin : le relais (fermé au démontage),
 * puis l'icône de ruban qui fait jaillir le QR code à côté d'elle.
 */
export function setupScan(plugin: Plugin): void {
    const sessionId = crypto.randomUUID();
    // La note de chaque document de la session, par identifiant `doc` (envoyé par le téléphone)
    const notes = new Map<string, Note>();
    // Les photos sont rangées UNE PAR UNE, dans l'ordre d'arrivée : deux pages envoyées
    // coup sur coup ne réécrivent jamais la note en même temps (l'une effacerait l'autre).
    let queue: Promise<void> = Promise.resolve();
    const relais = new Relais(
        sessionId,
        (connected) => { new Notice(connected ? 'Téléphone connecté' : 'Téléphone déconnecté'); },
        (photo, id, meta) => {
            queue = queue
                .then(() => savePhoto(plugin.app, relais, notes, photo, id, meta))
                .catch((error) => {
                    // La file continue quand même pour les photos suivantes
                    console.error('[scan]', error);
                    new Notice('Scan : impossible de ranger la photo dans le vault', 8000);
                });
        },
    );
    relais.connect();
    plugin.register(() => relais.close());

    const button = plugin.addRibbonIcon('qr-code', 'Scanner une feuille', () => {
        // Anti-cache : `?v=<horodatage>` rend l'adresse du site neuve à chaque QR affiché.
        // Le téléphone ne peut donc pas ressortir un vieux HTML de son cache, et le site
        // recopie ce même `?v=…` sur son CSS et son JS (voir docs/index.html de Hone-web_scan).
        // L'horodatage, et pas l'id de session : ce qui suit `?` part au serveur GitHub,
        // l'id de session (après `#`) reste dans le téléphone.
        const url = `${SITE_URL}?v=${Date.now().toString(36)}#${sessionId}`;
        new ScanModal(plugin.app, url, button).open();
    });
}

/** La note d'un document : `Scans/<base>.md`, et `<base>` préfixe les images de ses pages. */
interface Note {
    base: string;
    path: string;
}

/**
 * Range une photo reçue : l'image dans « Scans/ » (créé au besoin), puis sa ligne dans
 * la note de son document. Première page d'un document → on crée la note et on l'ouvre ;
 * page suivante → elle s'ajoute à la fin ; page mise à jour → sa ligne est remplacée.
 */
async function savePhoto(
    app: App,
    relais: Relais,
    notes: Map<string, Note>,
    photo: Blob,
    id: string,
    meta: PhotoMeta,
): Promise<void> {
    if (app.vault.getFolderByPath('Scans') === null) {
        await app.vault.createFolder('Scans');
    }
    const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');

    // Un ancien site n'envoie ni `doc` ni `page` : chaque photo est alors son propre document
    const doc = meta.doc ?? crypto.randomUUID();
    const page = meta.page ?? 1;
    let note = notes.get(doc);
    if (note === undefined) {
        const base = `scan-${stamp}`;
        note = { base, path: `Scans/${base}.md` };
        notes.set(doc, note);
    }

    // Toujours une nouvelle image, même pour une mise à jour (createBinary refuse d'écraser) :
    // l'ancienne reste dans « Scans/ », seule la note ne l'affiche plus.
    const image = imageName(note.base, page, stamp);
    await app.vault.createBinary(`Scans/${image}`, await photo.arrayBuffer());
    // Le téléphone affiche « Envoyé ! » dès que l'image est dans le vault
    relais.send({ type: 'photo-received', id });

    const line = pageLine(image);
    const existing = app.vault.getFileByPath(note.path);
    if (existing === null) {
        // Premier envoi du document (ou note supprimée entre-temps) : on la crée et on l'ouvre
        const created = await app.vault.create(note.path, `${line}\n`);
        await app.workspace.getLeaf().openFile(created);
    } else {
        // `process` lit et réécrit la note d'un seul coup : ce qu'on y a tapé entre-temps est gardé
        await app.vault.process(existing, (text) => putPage(text, note.base, page, line));
    }
    new Notice(meta.replace ? `Page ${page} mise à jour` : `Page ${page} ajoutée`);
}

/**
 * Le QR code : une Modal de Fragment (Échap, clic à côté, portée clavier) mais
 * sortie du centre — elle jaillit de l'icône du ruban, comme un widget. Tout est
 * sous `.scan-popover` pour ne toucher à aucune autre modale (styles.css).
 */
class ScanModal extends Modal {
    private closing = false;

    constructor(app: App, private readonly url: string, private readonly anchor: HTMLElement) {
        super(app);
        // Nos classes à nous : styles.css ne touche qu'à cette fenêtre-là.
        this.containerEl.classList.remove('mod-dim');
        this.containerEl.classList.add('scan-popover');
    }

    onOpen(): void {
        this.closing = false;
        this.containerEl.classList.remove('is-closing');
        this.anchor.classList.add('scan-ribbon-open');

        const qrBox = document.createElement('div');
        qrBox.classList.add('scan-qr');
        showQrCode(this.url, qrBox);
        this.contentEl.append(qrBox);

        this.placeNextToAnchor();
    }

    /** Pose le widget à droite de l'icône, centré sur elle, sans sortir de l'écran. */
    private placeNextToAnchor(): void {
        const icon = this.anchor.getBoundingClientRect();
        // offsetHeight (et non getBoundingClientRect) : la vraie taille, sans le
        // scale de l'animation d'entrée.
        const height = this.modalEl.offsetHeight;
        const margin = 8;

        const left = icon.right + 12;
        const iconCenter = icon.top + icon.height / 2;
        const top = Math.min(
            Math.max(iconCenter - height / 2, margin),
            window.innerHeight - height - margin,
        );

        this.modalEl.style.left = `${left}px`;
        this.modalEl.style.top = `${top}px`;
        // La pointe et l'origine de l'animation restent en face de l'icône.
        this.modalEl.style.setProperty('--scan-anchor-y', `${iconCenter - top}px`);
    }

    /** Échap, clic à côté et croix passent par ici : on joue la sortie avant de démonter. */
    close(): void {
        if (!this._loaded || this.closing) return;
        this.closing = true;
        this.anchor.classList.remove('scan-ribbon-open');

        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            super.close();
            return;
        }
        this.containerEl.classList.add('is-closing');
        window.setTimeout(() => super.close(), CLOSE_MS);
    }

    onClose(): void {
        this.contentEl.replaceChildren();
    }
}

/** Affiche un QR code de `url` dans `container` (SVG : net à toutes les tailles). */
function showQrCode(url: string, container: HTMLElement): void {
    const qr = new QRCodeStyling({
        type: 'svg',
        width: 200,
        height: 200,
        data: url,
        margin: 8, // la zone blanche autour aide les téléphones à repérer le QR
        dotsOptions: { color: '#16161a', type: 'rounded' },
        cornersSquareOptions: { color: '#646cff', type: 'extra-rounded' },
        cornersDotOptions: { color: '#646cff' },
        backgroundOptions: { color: '#ffffff' },
    });
    qr.append(container);

}
