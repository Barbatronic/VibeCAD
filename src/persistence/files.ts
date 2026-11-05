/**
 * Fichiers : téléchargement explicite (toujours disponible) et ouverture par sélecteur de
 * fichier. La File System Access API (navigateurs Chromium) est une amélioration progressive :
 * elle permet de réenregistrer directement dans le même fichier.
 */
import { sizedSvg } from '../io/svg-import';
import type { GrayImage } from '../io/trace-bitmap';

export interface SaveTarget {
  /** Nom du fichier choisi (affiché dans la barre d'état). */
  name: string;
  handle?: FileSystemFileHandleLike;
}

interface FileSystemWritableLike {
  write(data: Blob | BufferSource | string): Promise<void>;
  close(): Promise<void>;
}

export interface FileSystemFileHandleLike {
  name: string;
  createWritable(): Promise<FileSystemWritableLike>;
  getFile(): Promise<File>;
}

interface PickerWindow {
  showSaveFilePicker?: (options: unknown) => Promise<FileSystemFileHandleLike>;
  showOpenFilePicker?: (options: unknown) => Promise<FileSystemFileHandleLike[]>;
}

export function supportsFileSystemAccess(): boolean {
  const w = globalThis as unknown as PickerWindow;
  return typeof w.showSaveFilePicker === 'function' && typeof w.showOpenFilePicker === 'function';
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Nom de fichier sûr (sans caractères interdits par les systèmes de fichiers). */
export function safeFileName(name: string, extension: string): string {
  const base = name.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').slice(0, 80) || 'projet';
  return base.toLowerCase().endsWith(extension) ? base : `${base}${extension}`;
}

/**
 * Enregistre un contenu : dans le fichier déjà choisi (si l'API le permet), sinon propose un
 * emplacement (API) ou télécharge le fichier (repli universel).
 */
export async function saveFile(
  blob: Blob,
  suggestedName: string,
  options: { description: string; mime: string; extension: string; reuse?: SaveTarget | null; forcePicker?: boolean; download?: boolean },
): Promise<SaveTarget | null> {
  const w = globalThis as unknown as PickerWindow;
  if (options.download) {
    downloadBlob(blob, suggestedName);
    return { name: suggestedName };
  }
  if (options.reuse?.handle && !options.forcePicker) {
    const writable = await options.reuse.handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return options.reuse;
  }
  if (supportsFileSystemAccess()) {
    try {
      const handle = await w.showSaveFilePicker!({
        suggestedName,
        types: [{ description: options.description, accept: { [options.mime]: [options.extension] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return { name: handle.name, handle };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return null;
      // Repli sur le téléchargement en cas de refus ou d'erreur de l'API.
    }
  }
  downloadBlob(blob, suggestedName);
  return { name: suggestedName };
}

/** Ouvre un sélecteur de fichier ; renvoie le fichier choisi (ou null si l'utilisateur annule). */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    let settled = false;
    input.addEventListener('change', () => {
      settled = true;
      resolve(input.files?.[0] ?? null);
      input.remove();
    });
    input.addEventListener('cancel', () => {
      if (!settled) resolve(null);
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  });
}

export async function readFileBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

/** Plus grand côté (pixels) d'une image à vectoriser : assez fin, et le réglage reste fluide. */
const TRACE_MAX_SIDE = 900;

/** Niveaux de gris d'une image dessinée sur fond blanc. */
function grayOf(source: CanvasImageSource, width: number, height: number): GrayImage {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(source, 0, 0, width, height);
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const data = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i++) data[i] = Math.round(0.299 * rgba[i * 4]! + 0.587 * rgba[i * 4 + 1]! + 0.114 * rgba[i * 4 + 2]!);
  return { width, height, data };
}

/** Image d'un fichier en niveaux de gris ; null si elle est illisible. */
export async function readGrayImage(file: File): Promise<GrayImage | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return null;
  }
  const scale = Math.min(1, TRACE_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const image = grayOf(bitmap, Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
  bitmap.close();
  return image;
}

/**
 * SVG dessiné par le navigateur, en niveaux de gris ; null s'il n'y parvient pas. Passé par une
 * balise image, le fichier ne peut ni exécuter de script ni charger de ressource.
 */
export async function renderSvgGray(svg: string): Promise<GrayImage | null> {
  const sized = sizedSvg(svg, TRACE_MAX_SIDE);
  if (!sized) return null;
  const url = URL.createObjectURL(new Blob([sized.svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return grayOf(img, sized.width, sized.height);
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}
