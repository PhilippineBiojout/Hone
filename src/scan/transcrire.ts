import { preparerImage, recadrer } from './ocr/image';
import { appelerOpenAI } from './ocr/api';
import { analyserContenu } from './ocr/schema';
import { ErreurOcr } from './ocr/errors';
import type { Transcription } from './ocr/types';
export type { Transcription } from './ocr/types';

/** One API call, in-memory only. The plugin owns persistence in the vault. */
export async function transcrire(image: Blob, cle: string): Promise<Transcription> {
  let bitmap: ImageBitmap | undefined;
  try {
    if (typeof cle !== 'string' || !cle.trim()) throw new ErreurOcr('Renseignez une clé OpenAI dans les paramètres du plugin.');
    const prepared = await preparerImage(image);
    bitmap = prepared.bitmap;
    const contenu = analyserContenu(await appelerOpenAI(prepared.dataUrl, cle.trim()));
    const images = await recadrer(bitmap, contenu.diagrams);
    const markdown = contenu.content.replace(/\[\[diagram:([a-zA-Z0-9-]{1,64})\]\]/g, (_marker, id: string) => {
      const i = contenu.diagrams.findIndex(d => d.id === id);
      return `![Schéma ${i+1}](${images[i].chemin})`;
    }).replace(/\[illisible\]/g, '?');
    const fichiers = await Promise.all(images.map(async image => ({
      nom: image.chemin,
      donnees: await image.blob.arrayBuffer(),
    })));
    return { markdown, fichiers };
  } catch (error) {
    if (error instanceof ErreurOcr) throw error;
    throw new ErreurOcr('Impossible de traiter la photo. Aucun document partiel n’a été retourné.');
  } finally { if (bitmap) bitmap.close(); }
}
