// Les types de domaine de Hone, partagés entre les composants (page) et le cerveau
// (cerveau/). Des types seulement.

export type Outil = 'definir' | 'visualiser' | 'aider' | 'traduire' | 'resumer';
export type NomAgent = 'chat' | 'bilan' | 'titre' | Outil;
/** D'où vient une réponse : le symbole que la carte affiche. */
export type Source = 'vault' | 'web' | 'modele';

export interface Passage { texte: string; chemin: string }
export interface Message { auteur: 'moi' | 'agent'; texte: string }
/** Un outil que l'agent vient d'appeler (son nom, et la requête, le chemin ou la fonction visée).
 *  Montré pendant l'attente puis replié au pied de la carte : c'est ce qui rend la boucle visible. */
export interface Etape { outil: string; detail: string }

export type Demande =
    | { agent: 'chat'; passage: Passage; question: string; historique: Message[] }
    | { agent: 'bilan'; passage: Passage; historique: Message[] }
    | { agent: 'titre'; passage: Passage }
    | { agent: 'aider'; passage: Passage; indices: string[] }
    | { agent: Exclude<Outil, 'aider'>; passage: Passage };

export interface Sorties {
    chat: { texte: string; source: Source };
    bilan: { texte: string };
    /** Le sujet du passage, pour la tête du chat et des cartes. */
    titre: { sujet: string };
    definir: { texte: string; source: Source };
    resumer: { texte: string; source: Source };
    traduire: { texte: string; langue: string };
    aider: { texte: string; stop: boolean };
    visualiser: { possible: boolean; svg: string | null; raison: string | null };
}
export type Sortie = Sorties[NomAgent];
