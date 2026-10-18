/**
 * Images de référence : décodage des fichiers (une fois par empreinte) et image redressée
 * (perspective) calculée pixel par pixel sur un canevas, mise en cache selon ses réglages.
 * Quand une image devient prête, `onImageReady` prévient l'application (nouveau rendu).
 */
import { imageAspect, rectifiedToSource, sourcePoint } from '../app/images';
import type { ImageParams, StepResource } from '../domain/model';
import { resourceBytes } from '../io/resources';

type Decoded = { status: 'loading' } | { status: 'ready'; image: ImageBitmap } | { status: 'error' };

const decoded = new Map<string, Decoded>();
const warped = new Map<string, HTMLCanvasElement>();
let notify: () => void = () => undefined;

export function onImageReady(listener: () => void): void {
  notify = listener;
}

/** Image décodée (null tant qu'elle se charge, ou si le fichier est illisible). */
export function decodedImage(resource: StepResource): ImageBitmap | null {
  const hit = decoded.get(resource.sha256);
  if (hit) return hit.status === 'ready' ? hit.image : null;
  decoded.set(resource.sha256, { status: 'loading' });
  const blob = new Blob([resourceBytes(resource) as Uint8Array<ArrayBuffer>], { type: resource.mime ?? 'image/png' });
  createImageBitmap(blob).then(
    (image) => {
      decoded.set(resource.sha256, { status: 'ready', image });
      notify();
    },
    () => decoded.set(resource.sha256, { status: 'error' }),
  );
  return null;
}

/** Dimensions (pixels) d'un fichier image, pour créer le calque. */
export async function imagePixels(bytes: Uint8Array, mime: string): Promise<{ w: number; h: number }> {
  const image = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime }));
  const size = { w: image.width, h: image.height };
  image.close();
  return size;
}

/** Image à afficher : d'origine, ou redressée selon les réglages de perspective. */
export function imageSource(resource: StepResource, params: Pick<ImageParams, 'perspective' | 'pixels'>): CanvasImageSource | null {
  const image = decodedImage(resource);
  if (!image || !params.perspective) return image;
  const key = `${resource.sha256}|${JSON.stringify(params.perspective)}`;
  let canvas = warped.get(key);
  if (!canvas) {
    canvas = rectify(image, params as Required<Pick<ImageParams, 'perspective' | 'pixels'>>);
    warped.set(key, canvas);
    // Peu de réglages différents à la fois : on garde les 12 derniers.
    if (warped.size > 12) warped.delete(warped.keys().next().value!);
  }
  return canvas;
}

/** Image redressée : chaque pixel va chercher sa couleur dans l'image d'origine (homographie inverse). */
function rectify(image: ImageBitmap, params: Required<Pick<ImageParams, 'perspective' | 'pixels'>>): HTMLCanvasElement {
  const H = rectifiedToSource(params.perspective);
  const outW = Math.max(16, Math.min(1600, Math.round(image.width * 1.5)));
  const outH = Math.max(16, Math.round(outW / imageAspect(params)));
  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  if (!H) return out;
  // Pixels de l'image d'origine (réduite à 2 048 px au plus).
  const k = Math.min(1, 2048 / Math.max(image.width, image.height));
  const src = document.createElement('canvas');
  src.width = Math.max(1, Math.round(image.width * k));
  src.height = Math.max(1, Math.round(image.height * k));
  const sctx = src.getContext('2d')!;
  sctx.drawImage(image, 0, 0, src.width, src.height);
  const sdata = sctx.getImageData(0, 0, src.width, src.height).data;
  const octx = out.getContext('2d')!;
  const odata = octx.createImageData(outW, outH);
  const o = odata.data;
  for (let j = 0; j < outH; j++) {
    for (let i = 0; i < outW; i++) {
      // Coordonnées normalisées, y vers le haut.
      const q = sourcePoint(H, { x: (i + 0.5) / outW, y: 1 - (j + 0.5) / outH });
      if (q.x < 0 || q.x >= 1 || q.y < 0 || q.y >= 1) continue;
      const sx = Math.floor(q.x * src.width);
      const sy = Math.floor((1 - q.y) * src.height);
      const si = 4 * (sy * src.width + sx);
      const oi = 4 * (j * outW + i);
      o[oi] = sdata[si]!;
      o[oi + 1] = sdata[si + 1]!;
      o[oi + 2] = sdata[si + 2]!;
      o[oi + 3] = sdata[si + 3]!;
    }
  }
  octx.putImageData(odata, 0, 0);
  return out;
}
