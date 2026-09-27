import { ErreurOcr } from './errors';
import type { Diagramme, ImageTranscrite } from './types';
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
export const MAX_PIXELS = 40_000_000;
export const MAX_PNG_BYTES = 20 * 1024 * 1024;
export const MAX_CROPS_BYTES = 12 * 1024 * 1024;

// Reject oversized JPEG dimensions before Chromium allocates the decoded bitmap.
export function dimensionsJpeg(bytes: Uint8Array): { width: number; height: number } {
  const invalid = () => new ErreurOcr('La photo JPEG est corrompue ou non prise en charge.');
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw invalid();
  let position = 2;
  while (position < bytes.length) {
    if (bytes[position++] !== 0xff) throw invalid();
    while (bytes[position] === 0xff) position++;
    const marker = bytes[position++];
    if (marker === 0xda || marker === 0xd9 || marker === undefined) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const length = (bytes[position] << 8) | bytes[position + 1];
    if (length < 2 || position + length > bytes.length) throw invalid();
    if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
      if (length < 8) throw invalid();
      const height = (bytes[position+3] << 8) | bytes[position+4];
      const width = (bytes[position+5] << 8) | bytes[position+6];
      if (!width || !height) throw invalid();
      if (width * height > MAX_PIXELS) throw new ErreurOcr('La photo dépasse 40 mégapixels.');
      return { width, height };
    }
    position += length;
  }
  throw invalid();
}
export function versDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new ErreurOcr('Lecture de l’image impossible.'));
    reader.onerror = reader.onabort = () => reject(new ErreurOcr('Lecture de l’image impossible.'));
    reader.readAsDataURL(blob);
  });
}
async function png(bitmap: ImageBitmap, left: number, top: number, width: number, height: number): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  try {
    const context = canvas.getContext('2d');
    if (!context) throw new ErreurOcr('Canvas indisponible pour traiter la photo.');
    context.drawImage(bitmap, left, top, width, height, 0, 0, width, height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new ErreurOcr('Encodage PNG impossible.')), 'image/png'));
    if (blob.type !== 'image/png') throw new ErreurOcr('Encodage PNG indisponible.');
    return blob;
  } finally { canvas.width = canvas.height = 1; }
}
export async function preparerImage(image: Blob): Promise<{ bitmap: ImageBitmap; dataUrl: string }> {
  if (!(image instanceof Blob) || !image.size) throw new ErreurOcr('La photo est vide ou invalide.');
  if (image.type !== 'image/jpeg') throw new ErreurOcr('Cette intégration attend une photo JPEG (image/jpeg).');
  if (image.size > MAX_IMAGE_BYTES) throw new ErreurOcr('La photo dépasse 12 Mo.');
  const dimensions = dimensionsJpeg(new Uint8Array(await image.arrayBuffer()));
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(image, { imageOrientation: 'from-image' }); }
  catch { throw new ErreurOcr('Impossible de décoder la photo JPEG.'); }
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > MAX_PIXELS || bitmap.width * bitmap.height !== dimensions.width * dimensions.height) throw new ErreurOcr('Dimensions de la photo invalides.');
    // Send the same EXIF-oriented pixels used by the crops, with no rescaling.
    const normalized = await png(bitmap, 0, 0, bitmap.width, bitmap.height);
    if (normalized.size > MAX_PNG_BYTES) throw new ErreurOcr('La photo normalisée dépasse 20 Mo. Recadrez-la avant de réessayer.');
    return { bitmap, dataUrl: await versDataUrl(normalized) };
  } catch (error) { bitmap.close(); throw error; }
}
function dossierUnique(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return 'diagrams-' + Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('');
}
export async function recadrer(bitmap: ImageBitmap, diagrams: Diagramme[], maxBytes = MAX_CROPS_BYTES): Promise<ImageTranscrite[]> {
  if (!diagrams.length) return [];
  const directory = dossierUnique();
  const images: ImageTranscrite[] = [];
  let total = 0;
  for (const [index, d] of diagrams.entries()) {
    const left = Math.max(0, Math.floor((d.x - d.width * .02) * bitmap.width));
    const top = Math.max(0, Math.floor((d.y - d.height * .02) * bitmap.height));
    const right = Math.min(bitmap.width, Math.ceil((d.x + d.width * 1.02) * bitmap.width));
    const bottom = Math.min(bitmap.height, Math.ceil((d.y + d.height * 1.02) * bitmap.height));
    const blob = await png(bitmap, left, top, Math.max(1, right-left), Math.max(1, bottom-top));
    total += blob.size;
    if (total > maxBytes) throw new ErreurOcr('Les schémas recadrés dépassent 12 Mo cumulés.');
    images.push({ chemin: `${directory}/diagram-${index+1}.png`, blob });
  }
  return images;
}
