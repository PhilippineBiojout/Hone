// Les préférences : une petite mémoire toujours chargée, que l'agent tient lui-même
// quand l'utilisateur dit comment il veut ses réponses (« définitions plus courtes »,
// « exemples en physique »). Rangée dans data.json, jamais dans les notes. Elle part
// dans les consignes de chaque agent ; elle change rarement, le cache tient.

export const PREFERENCES_MAX = 15;
export const PREFERENCE_MAX = 200;

const plier = (t: string) => t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

/** Relit la liste de data.json : chaînes non vides, bornées, sans doublon. */
export function lirePreferences(data: unknown): string[] {
    const brut = (data as { preferences?: unknown } | null)?.preferences;
    if (!Array.isArray(brut)) return [];
    const vues = new Set<string>();
    return brut.filter((p): p is string => typeof p === 'string' && p.trim() !== '')
        .map((p) => p.trim().slice(0, PREFERENCE_MAX))
        .filter((p) => !vues.has(plier(p)) && Boolean(vues.add(plier(p))))
        .slice(0, PREFERENCES_MAX);
}

export class Preferences {
    constructor(private liste: string[], private readonly sauver: () => void) {}

    toutes(): readonly string[] {
        return this.liste;
    }

    /** Ajoute ou retire une préférence ; rend le message pour le modèle. */
    noter(preference: string, retirer: boolean): string {
        const p = preference.trim().slice(0, PREFERENCE_MAX);
        if (!p) return 'Préférence vide.';
        const existe = this.liste.findIndex((x) => plier(x) === plier(p));
        if (retirer) {
            if (existe < 0) return `Préférence inconnue : « ${p} ». Les préférences : ${this.liste.join(' | ') || 'aucune'}.`;
            this.liste.splice(existe, 1);
            this.sauver();
            return `Préférence retirée : « ${p} ».`;
        }
        if (existe >= 0) return 'Déjà notée.';
        if (this.liste.length >= PREFERENCES_MAX) {
            return `${PREFERENCES_MAX} préférences au plus : retire d'abord celle qui ne vaut plus (retirer: true).`;
        }
        this.liste.push(p);
        this.sauver();
        return `Préférence notée : « ${p} ».`;
    }

    /** Ce qui s'ajoute aux consignes ; vide s'il n'y a rien. */
    bloc(): string {
        return this.liste.length === 0 ? ''
            : `\nPréférences de l'utilisateur (à respecter) :\n${this.liste.map((p) => `- ${p}`).join('\n')}`;
    }
}
