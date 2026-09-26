import { Modal, Notice, type App, type Plugin } from 'fragment';
import QRCodeStyling from 'qr-code-styling';
import { Relais } from './relais';

// Scanner une feuille avec le téléphone : une icône de ruban montre un QR code,
// un relais WebSocket relie le téléphone au bureau, et la photo reçue se range
// dans « Scans/ ». Le site du téléphone et le relais vivent dans le dépôt Hone
// (GitHub Pages + worker Cloudflare) ; ici, seul le côté bureau.
// Retrait : ce fichier, `relais.ts`, l'appel dans main.ts, la section de styles.css.

/** Le site que le téléphone ouvre : les pages GitHub du dossier docs/ de Hone. */
const SITE_URL = 'https://rebornflamme.github.io/Hone/';

/** Durée de l'animation de fermeture — la même que dans styles.css. */
const CLOSE_MS = 140;

/**
 * Branche « scanner une feuille » sur le plugin : le relais (fermé au démontage),
 * puis l'icône de ruban qui fait jaillir le QR code à côté d'elle.
 */
export function brancherScan(plugin: Plugin): void {
    const sessionId = crypto.randomUUID();
    const relais = new Relais(
        sessionId,
        (connecte) => { new Notice(connecte ? 'Téléphone connecté' : 'Téléphone déconnecté'); },
        (photo, id) => void sauverPhoto(plugin.app, relais, photo, id),
    );
    relais.connect();
    plugin.register(() => relais.close());

    const bouton = plugin.addRibbonIcon('qr-code', 'Scanner une feuille', () => {
        new ScanModal(plugin.app, `${SITE_URL}#${sessionId}`, bouton).open();
    });
}

/** Range la photo reçue dans « Scans/ » (créé au besoin) et accuse réception. */
async function sauverPhoto(app: App, relais: Relais, photo: Blob, id: string): Promise<void> {
    if (app.vault.getFolderByPath('Scans') === null) {
        await app.vault.createFolder('Scans');
    }
    const horodatage = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    const octets = await photo.arrayBuffer();
    await app.vault.createBinary(`Scans/scan-${horodatage}.jpg`, octets);
    relais.send({ type: 'photo-received', id });
    new Notice('Scan reçu');
}

/**
 * Le QR code : une Modal de Fragment (Échap, clic à côté, portée clavier) mais
 * sortie du centre — elle jaillit de l'icône du ruban, comme un widget. Tout est
 * sous `.scan-popover` pour ne toucher à aucune autre modale (styles.css).
 */
class ScanModal extends Modal {
    private closing = false;

    constructor(app: App, private readonly url: string, private readonly ancre: HTMLElement) {
        super(app);
        // Nos classes à nous : styles.css ne touche qu'à cette fenêtre-là.
        this.containerEl.classList.remove('mod-dim');
        this.containerEl.classList.add('scan-popover');
    }

    onOpen(): void {
        this.closing = false;
        this.containerEl.classList.remove('is-closing');
        this.ancre.classList.add('scan-ribbon-open');

        const boite = document.createElement('div');
        boite.classList.add('scan-qr');
        afficherQrCode(this.url, boite);
        this.contentEl.append(boite);

        this.placerContreAncre();
    }

    /** Pose le widget à droite de l'icône, centré sur elle, sans sortir de l'écran. */
    private placerContreAncre(): void {
        const icone = this.ancre.getBoundingClientRect();
        // offsetHeight (et non getBoundingClientRect) : la vraie taille, sans le
        // scale de l'animation d'entrée.
        const hauteur = this.modalEl.offsetHeight;
        const marge = 8;

        const gauche = icone.right + 12;
        const centreIcone = icone.top + icone.height / 2;
        const haut = Math.min(
            Math.max(centreIcone - hauteur / 2, marge),
            window.innerHeight - hauteur - marge,
        );

        this.modalEl.style.left = `${gauche}px`;
        this.modalEl.style.top = `${haut}px`;
        // La pointe et l'origine de l'animation restent en face de l'icône.
        this.modalEl.style.setProperty('--scan-anchor-y', `${centreIcone - haut}px`);
    }

    /** Échap, clic à côté et croix passent par ici : on joue la sortie avant de démonter. */
    close(): void {
        if (!this._loaded || this.closing) return;
        this.closing = true;
        this.ancre.classList.remove('scan-ribbon-open');

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

/** Affiche un QR code de `url` dans `conteneur` (SVG : net à toutes les tailles). */
function afficherQrCode(url: string, conteneur: HTMLElement): void {
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
    qr.append(conteneur);
}
