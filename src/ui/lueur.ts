import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { VoiceBeam } from 'voice-glow';

// La lueur de la discussion orale : le VoiceBeam de voice-glow (libraries.dev/voice,
// MIT), un faisceau coloré au bord bas qui monte avec la voix et balaie pendant
// que Hone réfléchit. Le paquet est un composant React : plutôt que de le
// refaire (55 ko de canvas et de filtres, qu'on aurait fait dériver), on lui
// donne un petit îlot React, un calque vide posé sur toute la barre. Le reste de
// la barre reste en DOM pur. Retirer ce fichier, c'est retirer React du bundle.

/** Une source de niveau (0 à 1), relue à chaque image par voice-glow sans re-render. */
export type LireNiveau = () => number;

/** Ce que la lueur écoute : le flux du micro (analysé par voice-glow) ou un niveau qu'on lui lit. */
export type Source = { flux: MediaStream } | { niveau: LireNiveau } | null;

export class Lueur {

    readonly el = document.createElement('div');
    private readonly racine: Root;
    private source: Source = null;
    private reflechit = false;

    constructor() {
        this.el.classList.add('agent-voix-lueur');
        this.el.setAttribute('aria-hidden', 'true');
        this.racine = createRoot(this.el);
        this.rendre();
    }

    suivre(source: Source): void {
        this.source = source;
        this.rendre();
    }

    /** Le faisceau se ramasse et balaie la barre ; voice-glow fond l'entrée et la sortie. */
    reflechir(oui: boolean): void {
        if (this.reflechit === oui) return;
        this.reflechit = oui;
        this.rendre();
    }

    detruire(): void {
        this.racine.unmount();
    }

    private rendre(): void {
        const s = this.source;
        this.racine.render(createElement(VoiceBeam, {
            type: 'default',
            // L'app suit prefers-color-scheme : voice-glow aussi.
            theme: 'auto',
            stream: s && 'flux' in s ? s.flux : null,
            level: s && 'niveau' in s ? s.niveau : 0,
            processing: this.reflechit,
            className: 'agent-voix-faisceau',
            // L'enfant vide dont voice-glow lit le border-radius : celui de la barre.
            children: createElement('div', { className: 'agent-voix-cadre' }),
        }));
    }
}

/** Une voix qu'on n'entend pas (la synthèse du système) : un niveau qui ondule comme une phrase. */
export function ondulation(t = performance.now() / 1000): number {
    const v = 0.5 + 0.22 * Math.sin(t * 6.1) + 0.14 * Math.sin(t * 13.7 + 1.3) + 0.08 * Math.sin(t * 2.3);
    return Math.min(1, Math.max(0, v));
}
