import { FileView, type TFile, Modal, Notice, type App, type Plugin } from 'fragment';
import QRCodeStyling from 'qr-code-styling';
import { Relais, type PhotoMeta } from './relais';
import { putPageInPdf } from './pdf';

// Scanner des feuilles avec le téléphone : une icône de ruban montre un QR code, un
// relais WebSocket relie le téléphone au bureau, et chaque photo devient une page du
// PDF de son document (un document = un PDF). Mettre à jour une page remplace cette
// page-là, sans toucher aux autres. Aucune image n'est gardée à côté : tout est dans le PDF.
// Le site du téléphone et le relais vivent dans le dépôt Hone-web_scan
// (GitHub Pages + worker Cloudflare) ; ici, seul le côté bureau.
// Retrait : ce fichier, `relais.ts`, `pdf.ts`, l'appel dans main.ts, la section de styles.css.

/** Le site que le téléphone ouvre : les pages GitHub du dossier docs/ de Hone-web_scan. */
const SITE_URL = 'https://philippinebiojout.github.io/Hone-web_scan/';

/** Où vont les PDF des scans : '' = la racine du vault, 'Scans' = un dossier « Scans/ » (créé au besoin). */
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
    // Le PDF de chaque document de la session, par identifiant `doc` (envoyé par le téléphone)
    const docs = new Map<string, ScanDoc>();
    // Les photos sont rangées UNE PAR UNE, dans l'ordre d'arrivée : deux pages envoyées
    // coup sur coup liraient sinon le même ancien PDF, et la seconde effacerait la première.
    let queue: Promise<void> = Promise.resolve();
    const relais = new Relais(
        sessionId,
        (connected) => { new Notice(connected ? 'Téléphone connecté' : 'Téléphone déconnecté'); },
        (photo, id, meta) => {
            queue = queue
                .then(() => savePhoto(plugin.app, relais, docs, photo, id, meta))
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

/** Un document scanné : son nom `base` (« Scan 27-09-2026 02h36m01 ») et le chemin de son PDF. */
interface ScanDoc {
    base: string;
    path: string;
}

/**
 * Range une photo reçue : on lit le PDF de son document (s'il existe déjà), on y met la
 * photo à sa page (ajoutée à la fin, ou à la place de l'ancienne pour une mise à jour),
 * puis on le réécrit. Premier envoi d'un document → on crée le PDF et on l'ouvre dans
 * un nouvel onglet ; ensuite → on le remplace et on recharge l'onglet qui l'affiche.
 */
async function savePhoto(
    app: App,
    relais: Relais,
    docs: Map<string, ScanDoc>,
    photo: Blob,
    id: string,
    meta: PhotoMeta,
): Promise<void> {
    // Un ancien site n'envoie ni `doc` ni `page` : chaque photo est alors son propre document
    const docId = meta.doc ?? crypto.randomUUID();
    const page = meta.page ?? 1;
    let scanDoc = docs.get(docId);
    if (scanDoc === undefined) {
        // Premier envoi du document : son nom = la date et l'heure locales de cette photo
        const now = new Date();
        const base = `Scan ${jour(now)} ${heure(now)}`;
        scanDoc = { base, path: inScanFolder(`${base}.pdf`) };
        docs.set(docId, scanDoc);
    }

    // Le dossier des scans, si SCAN_FOLDER en demande un (la racine existe toujours)
    if (SCAN_FOLDER !== '') await ensureFolder(app, SCAN_FOLDER);

    // Le PDF actuel du document (null au premier envoi, ou s'il a été supprimé entre-temps)
    const existing = app.vault.getFileByPath(scanDoc.path);
    const oldPdf = existing ? await app.vault.readBinary(existing) : null;
    const newPdf = await putPageInPdf(oldPdf, page, await photo.arrayBuffer());

    if (existing === null){
        // Nouveau PDF : on l'ouvre dans un NOUVEL onglet (getLeaf() sans argument
        // remplacerait la note qu'on était en train de lire)
        const created = await app.vault.createBinary(scanDoc.path, newPdf);
        await app.workspace.getLeaf('tab').openFile(created);
    }
    else{
        await app.vault.modifyBinary(existing, newPdf);
        await reloadPdf(app, existing);
    }
    // Après l'écriture : « Envoyé ! » sur le téléphone veut dire « la page est dans le PDF »
    relais.send({type: 'photo-received', id});
    new Notice(meta.replace ? `Page ${page} mise à jour` : `Page ${page} ajoutée`);
}

/**
 * Recharge les onglets qui affichent ce PDF (la vue PDF du cœur n'écoute pas `modify`),
 * en gardant le zoom et l'endroit où on lisait. Repris de remarkable/synchro.ts::recharger.
 */
async function reloadPdf(app: App, file: TFile): Promise<void> {
    for (const leaf of app.workspace.getLeavesOfFile(file)){
        const view = leaf.view;
        if (!(view instanceof FileView) || view.getViewType() !== 'pdf') continue;
        const state = view.getEphemeralState();                        // zoom, page…
        const scroller = view.contentEl.querySelector('.pdf-scroll');
        const top = scroller?.scrollTop ?? 0;                          // où on en était
        await view.onUnloadFile(file);
        await view.onLoadFile(file);                                   // relit le fichier modifié
        view.setEphemeralState(state);
        if (scroller) scroller.scrollTop = top;
    }
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
