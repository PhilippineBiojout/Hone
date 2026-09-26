// Ce qui passe entre la page (lienAgent.ts) et le processus de l'agent (serveur/). Des types seulement.

export type Outil = 'definir' | 'visualiser' | 'aider' | 'traduire' | 'resumer';
export type NomAgent = 'chat' | 'bilan' | Outil;
/** D'où vient une réponse : le symbole que la carte affiche. */
export type Source = 'vault' | 'web' | 'modele';

export interface Passage { texte: string; chemin: string }
export interface Message { auteur: 'moi' | 'agent'; texte: string }

export type Demande =
    | { agent: 'chat'; passage: Passage; question: string; historique: Message[] }
    | { agent: 'bilan'; passage: Passage; historique: Message[] }
    | { agent: 'aider'; passage: Passage; indices: string[] }
    | { agent: Exclude<Outil, 'aider'>; passage: Passage };

export interface Sorties {
    chat: { texte: string; source: Source };
    bilan: { texte: string };
    definir: { texte: string; source: Source };
    resumer: { texte: string; source: Source };
    traduire: { texte: string; langue: string };
    aider: { texte: string; stop: boolean };
    visualiser: { possible: boolean; svg: string | null; raison: string | null };
}
export type Sortie = Sorties[NomAgent];

export interface Requete { id: number; demande: Demande }
/** `morceau` : le chat s'écrit en direct ; `pause` : AGENT_BLOQUE=1, la page répond en factice. */
export type Retour =
    | { id: number; type: 'morceau'; texte: string }
    | { id: number; type: 'fin'; sortie: Sortie }
    | { id: number; type: 'erreur'; message: string }
    | { id: number; type: 'pause' };
