/**
 * Image de la scène de rendu : rendue hors écran à la taille voulue (éclairage, sol et fond de la
 * scène), cadrée sur les pièces ou comme la vue, enregistrée en PNG.
 */
import type { AppController } from '../app/controller';

export async function renderStill(c: AppController, options: { width: number; height: number; fit: boolean }): Promise<Blob> {
  const viewport = c.currentViewport();
  if (!viewport) throw new Error('La vue n’est pas prête.');
  const bounds = options.fit ? viewport.modelBounds() : null;
  if (options.fit && !bounds) throw new Error('Aucune pièce à montrer.');
  await viewport.beginCapture({ width: options.width, height: options.height, studio: true, background: viewport.sceneBackground(), fit: bounds ? { ...bounds, sphere: false } : null });
  // Copie aussitôt rendue : le tampon WebGL peut être effacé ensuite.
  const copy = document.createElement('canvas');
  copy.width = options.width;
  copy.height = options.height;
  try {
    copy.getContext('2d')!.drawImage(viewport.captureFrame(0), 0, 0);
  } finally {
    viewport.endCapture();
  }
  return new Promise((resolve, reject) => copy.toBlob((b) => (b ? resolve(b) : reject(new Error('Image impossible à enregistrer.'))), 'image/png'));
}
