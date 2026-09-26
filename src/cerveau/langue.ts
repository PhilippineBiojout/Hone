import type { AccesVault } from './vault';

type Langue = 'français' | 'anglais';

const MOTS: Record<Langue, Set<string>> = {
    français: new Set(['le', 'la', 'les', 'des', 'est', 'et', 'une', 'du', 'que', 'qui', 'dans', 'pour', 'pas', 'sur', 'avec', 'sont', 'ce', 'il', 'au']),
    anglais: new Set(['the', 'of', 'and', 'is', 'to', 'in', 'that', 'it', 'for', 'with', 'are', 'on', 'this', 'as', 'be', 'by', 'was', 'from']),
};

// Un cache par accès (donc par session/moteur) : recalculé si les réglages changent.
const cache = new WeakMap<AccesVault, Langue>();

/** La langue majoritaire des notes (vers laquelle Traduire traduit), comptée sans appel au modèle. */
export async function langueDuVault(acces: AccesVault): Promise<Langue> {
    const vu = cache.get(acces);
    if (vu) return vu;
    const total: Record<Langue, number> = { français: 0, anglais: 0 };
    for (const rel of acces.fichiers().slice(0, 40)) {
        const texte = await acces.lire(rel);
        if (texte == null) continue;
        for (const mot of texte.slice(0, 5000).toLowerCase().split(/[^\p{L}]+/u)) {
            if (MOTS.français.has(mot)) total.français++;
            if (MOTS.anglais.has(mot)) total.anglais++;
        }
    }
    const langue: Langue = total.anglais > total.français ? 'anglais' : 'français';
    cache.set(acces, langue);
    return langue;
}
