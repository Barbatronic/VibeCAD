/**
 * Demi-espace : une très grande boîte posée sur un plan, du côté où pointe `normal` (ou du côté
 * opposé). Sert à couper une pièce ou un corps outil par un plan (découpe, extrusion jusqu'à une
 * face). La face de la boîte posée sur le plan est étiquetée au nom de l'étape : rôle `start` pour
 * la boîte du côté de la normale, `end` pour celle du côté opposé.
 */
import type { Id } from '../domain/model';
import type { GeometryKernel, KernelShape } from '../geometry/kernel';
import { canonicalFrame } from '../math/frame';
import type { Vec3 } from '../math/vec';

export function halfSpace(kernel: GeometryKernel, featureId: Id, origin: Vec3, normal: Vec3, size: number, side: 'normal' | 'opposite'): KernelShape {
  const f = canonicalFrame(origin, normal);
  const matrix = [f.xAxis.x, f.xAxis.y, f.xAxis.z, 0, f.yAxis.x, f.yAxis.y, f.yAxis.z, 0, f.normal.x, f.normal.y, f.normal.z, 0, f.origin.x, f.origin.y, f.origin.z, 1];
  // Le repère canonique part du point du plan le plus proche de l'origine du modèle.
  const reach = size + Math.hypot(origin.x - f.origin.x, origin.y - f.origin.y, origin.z - f.origin.z);
  const local = kernel.makePrimitive({
    featureId,
    shape: 'box',
    position: { x: -reach, y: -reach, z: side === 'normal' ? 0 : -reach },
    width: 2 * reach,
    depth: 2 * reach,
    height: reach,
    diameter: 1,
    thickness: 1,
  });
  try {
    return kernel.transformed(local, matrix, { keep: true });
  } finally {
    kernel.dispose(local);
  }
}
