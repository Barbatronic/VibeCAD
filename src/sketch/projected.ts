/**
 * Projection d'arêtes de la pièce sur le plan d'une esquisse (outil Projeter, et mise à jour des
 * éléments repris quand la pièce change) : un cercle reste un cercle s'il est vu de face, devient
 * une ellipse s'il est vu de biais ; les autres courbes sont reprises en spline par des points
 * répartis le long de l'arête.
 */
import type { SketchArc, SketchCircle, SketchEllipse, SketchEntity, SketchLine, SketchSpline } from '../domain/model';
import { worldToFrame, type Frame3D } from '../math/frame';
import { cross3, dot3, normalize3, type Vec2, type Vec3 } from '../math/vec';

/** Points de passage d'une spline reprise de la pièce. */
export const PROJECTED_SPLINE_POINTS = 16;

export type ProjectedCircle = { kind: 'circle'; center: Vec2; radius: number } | { kind: 'ellipse'; center: Vec2; major: Vec2; minorRadius: number } | null;

/**
 * Cercle de l'espace projeté sur le plan : cercle si son axe est perpendiculaire au plan, ellipse
 * s'il est incliné (grand axe : le diamètre parallèle au plan, de longueur conservée ; petit rayon :
 * rayon × |cos| de l'inclinaison), null s'il est vu par la tranche (il se réduit à un segment).
 */
export function projectCircle(frame: Frame3D, center: Vec3, axis: Vec3, radius: number): ProjectedCircle {
  const c = worldToFrame(frame, center);
  const cos = Math.abs(dot3(normalize3(axis), frame.normal));
  if (cos > 1 - 1e-6) return { kind: 'circle', center: c, radius };
  if (cos < 1e-3) return null;
  // Diamètre du cercle parallèle au plan de l'esquisse : il garde sa longueur une fois projeté.
  const e1 = normalize3(cross3(axis, frame.normal));
  const end = worldToFrame(frame, { x: center.x + radius * e1.x, y: center.y + radius * e1.y, z: center.z + radius * e1.z });
  return { kind: 'ellipse', center: c, major: end, minorRadius: radius * cos };
}

/** `n` points régulièrement répartis (en longueur) sur la polyligne `points`, extrémités comprises. */
export function resamplePolyline(points: readonly Vec2[], n: number): Vec2[] {
  if (points.length < 2) return points.slice();
  const lengths = [0];
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1]! + Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y));
  const total = lengths[lengths.length - 1]!;
  if (total < 1e-12) return Array.from({ length: n }, () => ({ ...points[0]! }));
  const out: Vec2[] = [];
  let k = 0;
  for (let i = 0; i < n; i++) {
    const at = (total * i) / (n - 1);
    while (k < lengths.length - 2 && lengths[k + 1]! < at) k++;
    const span = lengths[k + 1]! - lengths[k]!;
    const t = span > 0 ? (at - lengths[k]!) / span : 0;
    out.push({ x: points[k]!.x + t * (points[k + 1]!.x - points[k]!.x), y: points[k]!.y + t * (points[k + 1]!.y - points[k]!.y) });
  }
  return out;
}

/**
 * Points de passage d'une spline reprise : la polyligne projetée de l'arête, rééchantillonnée ;
 * `closed` si l'arête se referme (le dernier point, confondu avec le premier, est retiré).
 */
export function splineThrough(points3: readonly Vec3[], frame: Frame3D, count = PROJECTED_SPLINE_POINTS): { points: Vec2[]; closed: boolean } | null {
  const pts = points3.map((p) => worldToFrame(frame, p));
  if (pts.length < 2) return null;
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  const span = Math.max(...pts.map((p) => Math.hypot(p.x - first.x, p.y - first.y)));
  if (span < 1e-6) return null;
  const closed = Math.hypot(last.x - first.x, last.y - first.y) < span * 1e-4;
  const sampled = resamplePolyline(pts, closed ? count + 1 : count);
  return { points: closed ? sampled.slice(0, -1) : sampled, closed };
}

/** Courbe d'esquisse qui peut être reprise de la pièce (et porter une référence d'arête). */
export type ProjectedEntity = SketchLine | SketchCircle | SketchArc | SketchEllipse | SketchSpline;

export function isProjectable(e: SketchEntity): e is ProjectedEntity {
  return e.type === 'line' || e.type === 'circle' || e.type === 'arc' || e.type === 'ellipse' || e.type === 'spline';
}
