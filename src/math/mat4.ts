/**
 * Matrices 4 × 4 de placement (rotation + translation), rangées par colonnes comme dans Three.js.
 * Utilisées pour placer les pièces d'un assemblage.
 */
import { cross3, normalize3, type Vec3 } from './vec';
import type { Frame3D } from './frame';

export type Mat4 = number[];

export const identity4 = (): Mat4 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function multiply4(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r]! * b[c * 4 + k]!;
      out[c * 4 + r] = s;
    }
  }
  return out;
}

/** Matrice dont les colonnes sont les axes du repère et la translation son origine. */
export function frameMatrix4(f: Frame3D): Mat4 {
  return [f.xAxis.x, f.xAxis.y, f.xAxis.z, 0, f.yAxis.x, f.yAxis.y, f.yAxis.z, 0, f.normal.x, f.normal.y, f.normal.z, 0, f.origin.x, f.origin.y, f.origin.z, 1];
}

/** Inverse d'un placement (rotation orthonormée + translation). */
export function invertRigid4(m: Mat4): Mat4 {
  const r = [m[0]!, m[1]!, m[2]!, m[4]!, m[5]!, m[6]!, m[8]!, m[9]!, m[10]!];
  const t = [m[12]!, m[13]!, m[14]!];
  // Rᵀ et −Rᵀ·t
  return [
    r[0]!, r[3]!, r[6]!, 0,
    r[1]!, r[4]!, r[7]!, 0,
    r[2]!, r[5]!, r[8]!, 0,
    -(r[0]! * t[0]! + r[1]! * t[1]! + r[2]! * t[2]!),
    -(r[3]! * t[0]! + r[4]! * t[1]! + r[5]! * t[2]!),
    -(r[6]! * t[0]! + r[7]! * t[1]! + r[8]! * t[2]!),
    1,
  ];
}

export function translation4(v: Vec3): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, v.x, v.y, v.z, 1];
}

export function rotationX4(radians: number): Mat4 {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
}

export function rotationZ4(radians: number): Mat4 {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/** Demi-tour autour de l'axe X : retourne l'axe Z (et Y). */
export const flipX4 = (): Mat4 => [1, 0, 0, 0, 0, -1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1];

export function transformPoint4(m: Mat4, p: Vec3): Vec3 {
  return {
    x: m[0]! * p.x + m[4]! * p.y + m[8]! * p.z + m[12]!,
    y: m[1]! * p.x + m[5]! * p.y + m[9]! * p.z + m[13]!,
    z: m[2]! * p.x + m[6]! * p.y + m[10]! * p.z + m[14]!,
  };
}

export function transformDirection4(m: Mat4, d: Vec3): Vec3 {
  return { x: m[0]! * d.x + m[4]! * d.y + m[8]! * d.z, y: m[1]! * d.x + m[5]! * d.y + m[9]! * d.z, z: m[2]! * d.x + m[6]! * d.y + m[10]! * d.z };
}

/** Repère d'axe Z donné, axes X / Y canoniques (stables quand la pièce change). */
export function frameFromAxis(origin: Vec3, axis: Vec3): Frame3D {
  const z = normalize3(axis);
  // X : la projection de l'axe X du monde (ou de Y si l'axe est presque X).
  const ref = Math.abs(z.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  const y = normalize3(cross3(z, ref));
  const x = cross3(y, z);
  return { origin, xAxis: x, yAxis: y, normal: z };
}
