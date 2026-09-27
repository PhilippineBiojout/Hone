export interface ImageTranscrite {
  /** Relative to the directory containing the note, using forward slashes. */
  chemin: string;
  blob: Blob;
}
export interface Transcription {
  markdown: string;
  fichiers: { nom: string; donnees: ArrayBuffer | string }[];
}
export interface Diagramme {
  id: string; x: number; y: number; width: number; height: number; legends: string;
}
export interface Contenu {
  content: string;
  diagrams: Diagramme[];
  issues: string[];
}
