import { ErreurOcr } from './errors';
import type { Contenu, Diagramme } from './types';
const texte = { type: 'string' };
const coordonnee = { type: 'number', minimum: 0, maximum: 1 };
export const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['content', 'diagrams', 'issues'],
  properties: {
    content: texte,
    diagrams: { type: 'array', maxItems: 8, items: {
      type: 'object', additionalProperties: false,
      required: ['id', 'x', 'y', 'width', 'height', 'legends'],
      properties: { id: texte, x: coordonnee, y: coordonnee, width: coordonnee, height: coordonnee, legends: texte },
    } },
    issues: { type: 'array', items: texte },
  },
};
function invalide(): never { throw new ErreurOcr('Réponse OCR invalide : contenu ou emplacements des schémas incohérents.'); }
function objet(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalide();
  const obj = value as Record<string, unknown>;
  if (Object.keys(obj).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(obj, key))) return invalide();
  return obj;
}
export function analyserContenu(raw: string): Contenu {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return invalide(); }
  const root = objet(value, ['content', 'diagrams', 'issues']);
  if (typeof root.content !== 'string' || !root.content.trim() || !Array.isArray(root.diagrams) || root.diagrams.length > 8 || !Array.isArray(root.issues) || root.issues.some(x => typeof x !== 'string')) return invalide();
  const diagrams = root.diagrams.map((value: unknown): Diagramme => {
    const d = objet(value, ['id', 'x', 'y', 'width', 'height', 'legends']);
    if (typeof d.id !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(d.id) || typeof d.legends !== 'string') return invalide();
    if (![d.x,d.y,d.width,d.height].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1)) return invalide();
    const x = d.x as number, y = d.y as number, width = d.width as number, height = d.height as number;
    if (width <= 0 || height <= 0 || x + width > 1 || y + height > 1) return invalide();
    return { id: d.id, x, y, width, height, legends: d.legends };
  });
  const ids = new Set(diagrams.map(d => d.id));
  if (ids.size !== diagrams.length) return invalide();
  const seen = new Set<string>();
  for (const line of root.content.split(/\r?\n/)) {
    if (!line.includes('[[diagram:')) continue;
    const match = /^\[\[diagram:([a-zA-Z0-9-]{1,64})\]\]$/.exec(line.trim());
    if (!match || !ids.has(match[1]) || seen.has(match[1])) return invalide();
    seen.add(match[1]);
  }
  if (seen.size !== ids.size || JSON.stringify([root.issues, diagrams.map(d => d.legends)]).includes('[[diagram:')) return invalide();
  return { content: root.content, diagrams, issues: root.issues as string[] };
}
