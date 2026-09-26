import type { DocumentSurface, TextSurface } from 'fragment';

// ═══════════════════════════════════════════════════════════════════════════
//  PONT PROVISOIRE, à supprimer quand le cœur exportera `hasText`
//  (core/editor/Editor.ts). Ce jour-là : effacer ce fichier, et importer
//  `hasText` depuis 'fragment' dans agentLayer.ts.
//
//  `WidgetLayer` est exporté depuis @usefragment/core 0.1.0 : il n'y a plus
//  que ce garde, recopié du cœur ligne pour ligne.
// ═══════════════════════════════════════════════════════════════════════════

export function hasText(surface: DocumentSurface): surface is TextSurface {
    return typeof (surface as Partial<TextSurface>).getLine === 'function';
}
