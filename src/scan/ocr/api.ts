import { ErreurOcr } from './errors';
import { TRANSCRIPTION_INSTRUCTIONS, DIAGRAM_INSTRUCTIONS } from './prompt';
import { SCHEMA } from './schema';
export const MODELE = 'gpt-6-sol';
export const TIMEOUT_MS = 180_000;
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
export function texteReponse(value: unknown): string {
  if (!record(value) || value.status !== 'completed') throw new ErreurOcr('Transcription incomplète. Réessayez avec une partie plus petite de la feuille.');
  if (!Array.isArray(value.output)) throw new ErreurOcr('Réponse OpenAI invalide.');
  const parts: string[] = [];
  for (const item of value.output) {
    if (!record(item) || item.type !== 'message') continue;
    if (item.status !== 'completed' || !Array.isArray(item.content)) throw new ErreurOcr('Message OpenAI incomplet.');
    for (const part of item.content) {
      if (!record(part)) throw new ErreurOcr('Réponse OpenAI invalide.');
      if (part.type === 'refusal') throw new ErreurOcr('Le modèle a refusé de transcrire cette photo.');
      if (part.type === 'output_text') {
        if (typeof part.text !== 'string') throw new ErreurOcr('Réponse OpenAI invalide.');
        parts.push(part.text);
      }
    }
  }
  const text = parts.join('');
  if (!text.trim()) throw new ErreurOcr('OpenAI n’a renvoyé aucun texte.');
  return text;
}
export async function appelerOpenAI(dataUrl: string, cle: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', redirect: 'error', credentials: 'omit', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cle },
      body: JSON.stringify({ model: MODELE, store: false, max_output_tokens: 16_000,
        instructions: TRANSCRIPTION_INSTRUCTIONS + DIAGRAM_INSTRUCTIONS,
        input: [{ role: 'user', content: [
          { type: 'input_text', text: 'Transcris intégralement cette feuille au niveau 1, avec les schémas extraits et le format JSON demandé.' },
          { type: 'input_image', image_url: dataUrl, detail: 'high' },
        ] }],
        text: { format: { type: 'json_schema', name: 'transcription_schemas', strict: true, schema: SCHEMA } },
      }),
    });
    if (!response.ok) {
      // Do not parse or expose provider error bodies: they can contain sensitive request data.
      if (response.status === 401) throw new ErreurOcr('Clé OpenAI refusée. Vérifiez la clé dans les paramètres du plugin.');
      if (response.status === 403 || response.status === 404) throw new ErreurOcr('Accès au modèle OpenAI indisponible pour cette clé.');
      if (response.status === 429) throw new ErreurOcr('Quota ou limite OpenAI atteint. Réessayez plus tard.');
      if (response.status >= 500) throw new ErreurOcr('OpenAI est temporairement indisponible.');
      throw new ErreurOcr('La requête OCR a été refusée par OpenAI.');
    }
    return texteReponse(await response.json() as unknown);
  } catch (error) {
    if (controller.signal.aborted) throw new ErreurOcr('Le délai de transcription de 180 secondes est dépassé.');
    if (error instanceof ErreurOcr) throw error;
    throw new ErreurOcr('Impossible de recevoir une réponse valide d’OpenAI. Vérifiez la connexion.');
  } finally { clearTimeout(timer); }
}
