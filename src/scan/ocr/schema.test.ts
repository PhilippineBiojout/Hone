import { describe, it, expect } from 'vitest';
import { analyserContenu } from './schema';
import { texteReponse } from './api';

const diagram = { id: 'a', x: 0, y: 0, width: .5, height: .5, legends: '' };
const valid = () => ({ content: 'Avant\n\n[[diagram:a]]\n\nAprès', diagrams: [diagram], issues: [] });

describe('OCR : validation locale sans appel réseau', () => {
  it('accepte le texte seul et les schémas placés', () => {
    expect(analyserContenu(JSON.stringify(valid()))).toEqual(valid());
    expect(analyserContenu(JSON.stringify({ content: 'Texte', diagrams: [], issues: [] })).diagrams).toEqual([]);
  });
  it('refuse les rectangles et marqueurs incohérents', () => {
    for (const payload of [
      { ...valid(), content: 'Sans emplacement' },
      { ...valid(), content: '[[diagram:a]]\n[[diagram:a]]' },
      { ...valid(), diagrams: [{ ...diagram, x: .9 }] },
      { ...valid(), diagrams: [{ ...diagram, width: 0 }] },
      { ...valid(), diagrams: [{ ...diagram, id: '../escape' }] },
    ]) expect(() => analyserContenu(JSON.stringify(payload))).toThrow('invalide');
  });
  it('lit les messages après les éléments de raisonnement', () => {
    expect(texteReponse({ status: 'completed', output: [
      { type: 'reasoning' },
      { type: 'message', status: 'completed', content: [{ type: 'output_text', text: 'abc' }] },
    ] })).toBe('abc');
  });
  it('rejette les réponses incomplètes et les refus sans exposer leur contenu', () => {
    expect(() => texteReponse({ status: 'incomplete', output: [] })).toThrow('incomplète');
    expect(() => texteReponse({ status: 'completed', output: [{ type: 'message', status: 'completed', content: [{ type: 'refusal', refusal: 'secret-factice' }] }] })).toThrow('refusé');
  });
});
