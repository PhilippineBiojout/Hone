import { Modal, Notice, type App, type Plugin } from 'fragment';
import QRCodeStyling from 'qr-code-styling';
import { imageName, pageLine, putPage } from './pages';
import { Relais, type PhotoMeta } from './relais';

// Scanner des feuilles avec le téléphone : une icône de ruban montre un QR code,
// un relais WebSocket relie le téléphone au bureau, et les photos reçues se rangent
// dans le vault (SCAN_FOLDER). Les pages d'un même document vont dans UNE seule note, les unes
// à la suite des autres (une image par page) ; mettre à jour une page remplace son
// image. Pas de transcription ici : le texte, c'est Codex qui s'en charge dans Fragment.
// Le site du téléphone et le relais vivent dans le dépôt Hone-web_scan
// (GitHub Pages + worker Cloudflare) ; ici, seul le côté bureau.
// Retrait : ce fichier, `relais.ts`, `pages.ts`, l'appel dans main.ts, la section de styles.css.

/** Le site que le téléphone ouvre : les pages GitHub du dossier docs/ de Hone-web_scan. */
const SITE_URL = 'https://philippinebiojout.github.io/Hone-web_scan/';

/**
 * Où vont les documents scannés. Chaque document a SON dossier, qui contient sa note et
 * les images de ses pages : « Scan 27-09-2026 02h36m01/Scan 27-09-2026 02h36m01.md ».
 * SCAN_FOLDER dit où poser ces dossiers : '' = la racine du vault (choix actuel),
 * 'Scans' = dans un dossier « Scans/ » (créé au besoin). Note et images restent
 * ensemble : la note affiche ses images par leur seul nom (`![[…jpg]]`).
 */
const SCAN_FOLDER = '';

/** Le chemin d'un fichier ou dossier dans SCAN_FOLDER. */
function inScanFolder(name: string): string {
    return SCAN_FOLDER === '' ? name : `${SCAN_FOLDER}/${name}`;
}

/** Crée le dossier `path` s'il n'existe pas encore (createFolder échoue sur un dossier existant). */
async function ensureFolder(app: App, path: string): Promise<void> {
    if (app.vault.getFolderByPath(path) === null) {
        await app.vault.createFolder(path);
    }
}

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

/** « 27-09-2026 », à l'heure locale. */
function jour(d: Date): string {
    return `${deux(d.getDate())}-${deux(d.getMonth() + 1)}-${d.getFullYear()}`;
}

/** « 02h36m01 », à l'heure locale. Pas de « : », interdit dans les noms de fichiers sous Windows. */
function heure(d: Date): string {
    return `${deux(d.getHours())}h${deux(d.getMinutes())}m${deux(d.getSeconds())}`;
}

function deux(n: number): string {
    return String(n).padStart(2, '0');
}

/**
 * Un document : son dossier `folder`, sa note `path` (`<folder>/<base>.md`), et `base`
 * qui préfixe les images de ses pages (rangées dans le même dossier).
 */
interface Note {
    base: string;
    folder: string;
    path: string;
}

/**
 * Range une photo reçue : l'image dans le dossier de son document (créé au besoin), puis
 * sa ligne dans la note du document. Première page d'un document → on crée le dossier et
 * la note, et on l'ouvre ; page suivante → elle s'ajoute à la fin ; page mise à jour →
 * sa ligne est remplacée.
 */
async function savePhoto(
    app: App,
    relais: Relais,
    notes: Map<string, Note>,
    photo: Blob,
    id: string,
    meta: PhotoMeta,
): Promise<void> {
    const now = new Date();

    // Un ancien site n'envoie ni `doc` ni `page` : chaque photo est alors son propre document
    const doc = meta.doc ?? crypto.randomUUID();
    const page = meta.page ?? 1;
    let note = notes.get(doc);
    if (note === undefined) {
        // « Scan 27-09-2026 02h36m01 » : la date et l'heure de la première page, à l'heure
        // locale (toISOString donnait l'heure UTC, deux heures de moins en été en France).
        // Les secondes évitent que deux documents commencés la même minute se marchent dessus.
        const base = `Scan ${jour(now)} ${heure(now)}`;
        const folder = inScanFolder(base);
        note = { base, folder, path: `${folder}/${base}.md` };
        notes.set(doc, note);
    }

    // Le dossier du document (et « Scans/ » au-dessus si SCAN_FOLDER le demande). Vérifié
    // à chaque photo, pas seulement à la première : il a pu être supprimé entre-temps.
    if (SCAN_FOLDER !== '') await ensureFolder(app, SCAN_FOLDER);
    await ensureFolder(app, note.folder);

    // Toujours une nouvelle image, même pour une mise à jour (createBinary refuse d'écraser) :
    // l'ancienne reste dans le dossier, seule la note ne l'affiche plus. L'heure suffit
    // à la rendre unique : la date est déjà dans le nom du document.
    const image = imageName(note.base, page, heure(now));
    await app.vault.createBinary(`${note.folder}/${image}`, await photo.arrayBuffer());
    // Le téléphone affiche « Envoyé ! » dès que l'image est dans le vault
    relais.send({ type: 'photo-received', id });

    const line = pageLine(image);
    const existing = app.vault.getFileByPath(note.path);
    if (existing === null) {
        // Premier envoi du document (ou note supprimée entre-temps) : on la crée et on l'ouvre
        // dans un NOUVEL onglet. getLeaf() sans argument réutilise l'onglet actif : la note du
        // document précédent (ou celle qu'on lisait) disparaissait de l'écran, remplacée.
        const created = await app.vault.create(note.path, `${line}\n`);
        await app.workspace.getLeaf('tab').openFile(created);
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
