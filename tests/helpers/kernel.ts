import type { GeometryKernel } from '../../src/geometry/kernel';
import { loadOpenCascade } from '../../src/geometry/occt/loader';
import { OcctKernel } from '../../src/geometry/occt/occt-kernel';

let kernel: Promise<OcctKernel> | null = null;

/** Noyau Open CASCADE réel (WASM) chargé une seule fois par fichier de test. */
export function getKernel(): Promise<GeometryKernel & OcctKernel> {
  kernel ??= loadOpenCascade().then((oc) => new OcctKernel(oc));
  return kernel;
}
