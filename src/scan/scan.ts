import { Modal, Notice, type App, type Plugin } from 'fragment';
import QRCodeStyling from 'qr-code-styling';
import { Relais } from './relais';
import { transcrire } from './transcrire';

// Scanner une feuille avec le téléphone : une icône de ruban montre un QR code,
// un relais WebSocket relie le téléphone au bureau, et la photo reçue se range
// dans « Scans/ ». Le site du téléphone et le relais vivent dans le dépôt
// Hone-web_scan (GitHub Pages + worker Cloudflare) ; ici, seul le côté bureau.
// Retrait : ce fichier, `relais.ts`, l'appel dans main.ts, la section de styles.css.

/** Le site que le téléphone ouvre : les pages GitHub du dossier docs/ de Hone-web_scan. */
const SITE_URL = 'https://philippinebiojout.github.io/Hone-web_scan/';

/** Durée de l'animation de fermeture — la même que dans styles.css. */
const CLOSE_MS = 140;

/**
 * Branche « scanner une feuille » sur le plugin : le relais (fermé au démontage),
 * puis l'icône de ruban qui fait jaillir le QR code à côté d'elle.
 */
export function setupScan(plugin: Plugin, getKey: () => string): void {
    const sessionId = crypto.randomUUID();
    const relais = new Relais(
        sessionId,
        (connected) => { new Notice(connected ? 'Téléphone connecté' : 'Téléphone déconnecté'); },
        (photo, id) => void savePhoto(plugin.app, relais, photo, id, getKey),
    );
    relais.connect();
    plugin.register(() => relais.close());

    const button = plugin.addRibbonIcon('qr-code', 'Scanner une feuille', () => {
        new ScanModal(plugin.app, `${SITE_URL}#${sessionId}`, button).open();
    });
}

/** Range la photo reçue dans « Scans/ » (créé au besoin) et accuse réception. */
async function savePhoto(app: App, relais: Relais, photo: Blob, id: string, getKey: () => string): Promise<void> {
    if (app.vault.getFolderByPath('Scans') === null) {
        await app.vault.createFolder('Scans');
    }
    const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    const name = `scan-${stamp}`;
    const octets = await photo.arrayBuffer();
    await app.vault.createBinary(`Scans/${name}.jpg`, octets);
    relais.send({ type: 'photo-received', id });
    new Notice('Scan reçu — transcription…');
    try {
        const { markdown, fichiers } = await transcrire(photo, getKey());
        for (const file of fichiers) {
            const path = `Scans/${file.nom}`;
            const folder = path.slice(0, path.lastIndexOf('/'));
            if (app.vault.getFolderByPath(folder) === null) await app.vault.createFolder(folder);
            if (typeof file.donnees === 'string') await app.vault.create(path, file.donnees);
            else await app.vault.createBinary(path, file.donnees);
        }

        const note = await app.vault.create(`Scans/${name}.md`, `${markdown}\n\n![[${name}.jpg]]\n`);
        await app.workspace.getLeaf().openFile(note);
        new Notice('Note créée');
    } catch (error) {
        new Notice(error instanceof Error ? error.message : 'Transcription impossible', 8000);
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
