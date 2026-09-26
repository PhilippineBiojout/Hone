// Ce qui reste de l'onde à cinq traits (Skiper25) depuis que la lueur de
// voice-glow l'a remplacée dans la barre : la lecture du spectre en cinq bandes,
// qui sert encore à mesurer la voix de Hone quand le back renvoie un vrai audio.

export const TRAITS = 5;
const PLANCHER = 0.2;     // Skiper25 : Math.random() * 0.8 + 0.2
const HZ_BAS = 80;        // la voix, en cinq bandes logarithmiques
const HZ_HAUT = 4000;
const PLEIN = 160;        // l'énergie moyenne (sur 255) qui remplit une bande

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

/**
 * Un seul niveau, dans [0 ; 1], pour la lueur : la bande la plus forte, plancher
 * retiré. La plus forte plutôt que la moyenne : une voix tient surtout dans une ou
 * deux bandes, la moyenne la diluerait de moitié.
 */
export function niveauVoix(bandes: number[]): number {
    const fort = Math.max(PLANCHER, ...bandes);
    return (fort - PLANCHER) / (1 - PLANCHER);
}
