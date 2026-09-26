import fs from 'node:fs';
import { cheminSur, fichiersLisibles } from './garde';

type Langue = 'français' | 'anglais';

const MOTS: Record<Langue, Set<string>> = {
    français: new Set(['le', 'la', 'les', 'des', 'est', 'et', 'une', 'du', 'que', 'qui', 'dans', 'pour', 'pas', 'sur', 'avec', 'sont', 'ce', 'il', 'au']),
    anglais: new Set(['the', 'of', 'and', 'is', 'to', 'in', 'that', 'it', 'for', 'with', 'are', 'on', 'this', 'as', 'be', 'by', 'was', 'from']),
};

let enCache: { racine: string; langue: Langue } | null = null;

/** La langue majoritaire des notes (vers laquelle Traduire traduit), comptée sans appel au modèle. */
export function langueDuVault(racine: string): Langue {
    if (enCache?.racine === racine) return enCache.langue;
    const total: Record<Langue, number> = { français: 0, anglais: 0 };
    for (const rel of fichiersLisibles(racine).slice(0, 40)) {
        try {
            const texte = fs.readFileSync(cheminSur(racine, rel), 'utf-8').slice(0, 5000);
            for (const mot of texte.toLowerCase().split(/[^\p{L}]+/u)) {
                if (MOTS.français.has(mot)) total.français++;
                if (MOTS.anglais.has(mot)) total.anglais++;
            }
        } catch {
            // une note illisible ne vote pas
        }
    }
    const langue: Langue = total.anglais > total.français ? 'anglais' : 'français';
    enCache = { racine, langue };
    return langue;
}
