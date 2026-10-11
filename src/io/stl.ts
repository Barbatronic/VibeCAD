/**
 * Export STL binaire (impression 3D). Le format STL ne porte pas d'unité : les coordonnées sont
 * écrites en millimètres, ce qui est rappelé dans l'en-tête et à l'utilisateur.
 */
import type { MeshData } from '../geometry/kernel';

export const STL_UNIT_NOTE =
  "Le format STL n’enregistre pas d’unité : ce fichier est en millimètres. Dans le logiciel d’impression, vérifiez que l’unité choisie est le millimètre.";

export function meshesToBinaryStl(meshes: MeshData[], label = 'VibeCAD'): Uint8Array {
  let triangles = 0;
  for (const m of meshes) triangles += m.indices.length / 3;
  const buffer = new ArrayBuffer(84 + triangles * 50);
  const view = new DataView(buffer);
  const header = `${label} - STL binaire - unites : millimetres (mm)`.slice(0, 80);
  for (let i = 0; i < header.length; i++) view.setUint8(i, header.charCodeAt(i) & 0x7f);
  view.setUint32(80, triangles, true);
  let offset = 84;
  for (const m of meshes) {
    const p = m.positions;
    for (let t = 0; t < m.indices.length; t += 3) {
      const ia = m.indices[t]! * 3;
      const ib = m.indices[t + 1]! * 3;
      const ic = m.indices[t + 2]! * 3;
      const ax = p[ia]!, ay = p[ia + 1]!, az = p[ia + 2]!;
      const bx = p[ib]!, by = p[ib + 1]!, bz = p[ib + 2]!;
      const cx = p[ic]!, cy = p[ic + 1]!, cz = p[ic + 2]!;
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = cx - ax, vy = cy - ay, vz = cz - az;
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
      for (const value of [nx, ny, nz, ax, ay, az, bx, by, bz, cx, cy, cz]) {
        view.setFloat32(offset, value, true);
        offset += 4;
      }
      view.setUint16(offset, 0, true);
      offset += 2;
    }
  }
  return new Uint8Array(buffer);
}

/** Lecture minimale d'un STL binaire (tests) : nombre de triangles et volume signé. */
export function readBinaryStl(bytes: Uint8Array): { triangles: number; volume: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const triangles = view.getUint32(80, true);
  let volume = 0;
  for (let t = 0; t < triangles; t++) {
    const o = 84 + t * 50 + 12;
    const f = (k: number) => view.getFloat32(o + k * 4, true);
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = [f(0), f(1), f(2), f(3), f(4), f(5), f(6), f(7), f(8)];
    volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return { triangles, volume };
}

/**
 * Nombre de triangles au plus pour un import STL : au-delà, la pièce (une face par triangle non
 * coplanaire) deviendrait trop lente à afficher et à modifier sur un ordinateur d'école.
 */
export const STL_MAX_TRIANGLES = 30_000;

/** Nombre de triangles d'un fichier STL, binaire ou texte (avant toute lecture géométrique). */
export function stlTriangleCount(bytes: Uint8Array): number {
  if (bytes.length >= 84) {
    const n = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(80, true);
    if (84 + 50 * n === bytes.length) return n;
  }
  const text = new TextDecoder('latin1').decode(bytes);
  return (text.match(/\bfacet\s+normal\b/gi) ?? []).length;
}
