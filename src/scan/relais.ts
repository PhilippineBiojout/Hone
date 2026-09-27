// Le relais entre le téléphone et le bureau : une WebSocket vers le worker
// Cloudflare (dépôt Hone, `relay/`). Le téléphone envoie la photo par morceaux ;
// on la recompose et on la rend au plugin, qui la range dans le vault.

const RELAY_URL = 'wss://hone-relay.lasky.workers.dev';

/**
 * Où ranger la photo, d'après le téléphone (champs de `photo-start`) : la page `page`
 * du document `doc`, à ajouter ou à remplacer (`replace`). Un ancien site n'envoie
 * rien de tout ça : les champs sont alors absents.
 */
export interface PhotoMeta {
    doc?: string;
    page?: number;
    replace?: boolean;
}

export class Relais {
    socket: WebSocket | null = null;
    sessionId: string;
    stopped = false;
    onPhone: (connected: boolean) => void;
    onPhoto: (photo: Blob, id: string, meta: PhotoMeta) => void;
    incoming: { id: string; mime: string; size: number; meta: PhotoMeta; chunks: ArrayBuffer[] } | null = null;

    constructor(
        sessionId: string,
        onPhone: (connected: boolean) => void,
        onPhoto: (photo: Blob, id: string, meta: PhotoMeta) => void,
    ) {
        this.sessionId = sessionId;
        this.onPhone = onPhone;
        this.onPhoto = onPhoto;
    }

    connect(): void {
        const ws = new WebSocket(`${RELAY_URL}/session/${encodeURIComponent(this.sessionId)}?role=desktop`);
        ws.binaryType = 'arraybuffer';
        this.socket = ws;

        ws.onmessage = (event) => {
            if (typeof event.data !== 'string') {
                this.incoming?.chunks.push(event.data);
                return;
            }
            const message = JSON.parse(event.data);
            if (message.type === 'peer' && message.role === 'phone') {
                this.onPhone(message.connected);
            } else if (message.type === 'photo-start') {
                this.incoming = { id: message.id, mime: message.mime || 'image/jpeg', size: message.size, meta: lireMeta(message), chunks: [] };
            } else if (message.type === 'photo-end') {
                if (this.incoming === null || this.incoming.id !== message.id) return;
                const photo = new Blob(this.incoming.chunks, { type: this.incoming.mime });
                const meta = this.incoming.meta;
                this.incoming = null;
                this.onPhoto(photo, message.id, meta);
            }
        };

        ws.onclose = (event) => {
            this.onPhone(false);
            this.incoming = null;
            if (!this.stopped && event.code !== 4000) {
                setTimeout(() => this.connect(), 2000);
            }
        };
    }

    send(message: object): void {
        if (this.socket?.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify(message));
        }
    }

    close(): void {
        this.stopped = true;
        this.socket?.close(1000);
    }
}

/** Garde de `photo-start` seulement des champs du bon type : le reste est ignoré. */
function lireMeta(message: { doc?: unknown; page?: unknown; replace?: unknown }): PhotoMeta {
    return {
        doc: typeof message.doc === 'string' ? message.doc : undefined,
        page: Number.isInteger(message.page) && (message.page as number) > 0 ? (message.page as number) : undefined,
        replace: message.replace === true,
    };
}
