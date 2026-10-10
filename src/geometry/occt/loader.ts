/**
 * Chargement du module WebAssembly Open CASCADE (build `replicad-opencascadejs`).
 * Le chemin du fichier `.wasm` est fourni par l'appelant : URL d'un fichier local servi par
 * l'application dans le navigateur, chemin de fichier sous Node (tests).
 */
import init, { type OpenCascadeInstance } from 'replicad-opencascadejs';

export type { OpenCascadeInstance } from 'replicad-opencascadejs';

export interface LoadOptions {
  /** URL ou chemin du fichier `replicad_single.wasm`. */
  wasmUrl?: string;
  /** Contenu binaire du fichier WASM (évite un téléchargement). */
  wasmBinary?: ArrayBuffer;
}

export async function loadOpenCascade(options: LoadOptions = {}): Promise<OpenCascadeInstance> {
  const overrides: Record<string, unknown> = {
    print: () => undefined,
    printErr: () => undefined,
  };
  if (options.wasmBinary) overrides.wasmBinary = options.wasmBinary;
  if (options.wasmUrl) {
    const url = options.wasmUrl;
    overrides.locateFile = (path: string) => (path.endsWith('.wasm') ? url : path);
  }
  return init(overrides);
}
