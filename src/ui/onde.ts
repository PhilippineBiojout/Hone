import { ressort } from './animations';

// L'onde à cinq traits du bouton musique de Skiper (Skiper25). scaleY plutôt
// que height : pas de mise en page dix fois par seconde.

export const TRAITS = 5;
const HAUTEUR = 14;       // Skiper25 : Math.max(4, height * 14)
const HAUTEUR_MIN = 4;
const PLANCHER = 0.2;     // Skiper25 : Math.random() * 0.8 + 0.2
const REPOS = 0.1;        // Skiper25 : fill(0.1)
const PERIODE = 100;      // Skiper25 : setInterval(…, 100)
const HZ_BAS = 80;        // la voix, en cinq bandes logarithmiques
const HZ_HAUT = 4000;
const PLEIN = 160;        // l'énergie moyenne (sur 255) qui remplit un trait

/** Les cinq niveaux, dans [0,2 ; 1], lus dans un spectre (`getByteFrequencyData`). */
export function niveaux(spectre: Uint8Array, hzParCase: number): number[] {
    const ratio = Math.pow(HZ_HAUT / HZ_BAS, 1 / TRAITS);
    return Array.from({ length: TRAITS }, (_, i) => {
        const debut = Math.floor((HZ_BAS * Math.pow(ratio, i)) / hzParCase);
        const fin = Math.min(spectre.length, Math.max(debut + 1, Math.floor((HZ_BAS * Math.pow(ratio, i + 1)) / hzParCase)));
        let somme = 0;
        for (let k = debut; k < fin; k++) somme += spectre[k];
        const moyenne = fin > debut ? somme / (fin - debut) : 0;
        return PLANCHER + (1 - PLANCHER) * Math.min(1, moyenne / PLEIN);
    });
}

/** Des hauteurs au hasard, pour une voix qu'on ne peut pas écouter. */
export function auHasard(): number[] {
    return Array.from({ length: TRAITS }, () => Math.random() * (1 - PLANCHER) + PLANCHER);
}

let transition: string | null = null;

export class Onde {

    readonly el = document.createElement('div');
    private readonly traits: HTMLElement[];
    private minuterie = 0;

    constructor() {
        this.el.classList.add('agent-onde');
        this.el.setAttribute('aria-hidden', 'true');
        if (!transition) {
            const { easing, duree } = ressort(300, 10);
            transition = `transform ${duree}ms ${easing}`;
        }
        this.traits = Array.from({ length: TRAITS }, () => {
            const trait = this.el.appendChild(document.createElement('span'));
            trait.classList.add('agent-onde-trait');
            trait.style.transition = transition ?? '';
            return trait;
        });
        this.repos();
    }

    /** Relit `lire` toutes les 100 ms et pose les traits à ces niveaux. */
    suivre(lire: () => number[]): void {
        window.clearInterval(this.minuterie);
        this.poser(lire());
        this.minuterie = window.setInterval(() => this.poser(lire()), PERIODE);
    }

    repos(): void {
        window.clearInterval(this.minuterie);
        this.poser(Array(TRAITS).fill(REPOS));
    }

    private poser(niveaux: number[]): void {
        this.traits.forEach((trait, i) => {
            trait.style.transform = `scaleY(${Math.max(HAUTEUR_MIN, (niveaux[i] ?? REPOS) * HAUTEUR) / HAUTEUR})`;
        });
    }
}
