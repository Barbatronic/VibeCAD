/**
 * Chemin d'un balayage : les segments et arcs d'une esquisse (hors construction) qui se suivent
 * bout à bout (splines ouvertes comprises), en une seule chaîne ouverte ou fermée (ou un cercle,
 * une ellipse ou une spline fermée seuls). Chaque morceau est
 * orienté dans le sens du parcours.
 */
import { isConstructionCurve, type SketchParams } from '../domain/model';
import { TOLERANCES } from '../domain/tolerances';
import type { Vec2 } from '../math/vec';
import { ellipsePoint, reverseBeziers } from './curves';
import { arcGeometry, ellipseOf, pointPosition, splineOf } from './model';
import type { ProfileSegment } from './profiles';

export type PathResult =
  | { ok: true; segments: ProfileSegment[]; closed: boolean }
  | { ok: false; reason: 'empty' | 'branched' | 'several' };

export const PATH_MESSAGES: Record<Exclude<PathResult, { ok: true }>['reason'], string> = {
  empty: 'Le chemin est vide : dessinez des segments ou des arcs qui se suivent.',
  branched: 'Le chemin se divise en plusieurs branches : il doit être une seule ligne continue.',
  several: 'Le chemin est fait de plusieurs morceaux séparés : reliez-les bout à bout.',
};

interface Edge {
  a: number;
  b: number;
  /** Morceau orienté de a vers b. */
  forward: ProfileSegment;
  backward: ProfileSegment;
}

export function extractPath(sketch: SketchParams): PathResult {
  const nodes: Vec2[] = [];
  const nodeOf = (p: Vec2) => {
    const i = nodes.findIndex((n) => Math.hypot(n.x - p.x, n.y - p.y) <= TOLERANCES.linear);
    if (i >= 0) return i;
    nodes.push(p);
    return nodes.length - 1;
  };
  const edges: Edge[] = [];
  const circles: ProfileSegment[] = [];
  for (const e of sketch.entities) {
    if (e.type !== 'point' && isConstructionCurve(e)) continue;
    if (e.type === 'line') {
      const a = pointPosition(sketch, e.a);
      const b = pointPosition(sketch, e.b);
      if (!a || !b) continue;
      edges.push({ a: nodeOf(a), b: nodeOf(b), forward: { kind: 'line', entityId: e.id, start: a, end: b }, backward: { kind: 'line', entityId: e.id, start: b, end: a } });
    } else if (e.type === 'arc') {
      const g = arcGeometry(sketch, e);
      if (!g) continue;
      const base = { kind: 'arc' as const, entityId: e.id, center: g.center, radius: g.radius };
      edges.push({ a: nodeOf(g.start), b: nodeOf(g.end), forward: { ...base, start: g.start, end: g.end, clockwise: false }, backward: { ...base, start: g.end, end: g.start, clockwise: true } });
    } else if (e.type === 'spline') {
      // Spline : ouverte, un morceau du chemin ; fermée, un chemin à elle seule (comme un cercle).
      const bz = splineOf(sketch, e);
      if (bz.length === 0) continue;
      const start = bz[0]![0];
      const end = bz[bz.length - 1]![3];
      if (e.closed) circles.push({ kind: 'spline', entityId: e.id, start, end, beziers: bz });
      else edges.push({ a: nodeOf(start), b: nodeOf(end), forward: { kind: 'spline', entityId: e.id, start, end, beziers: bz }, backward: { kind: 'spline', entityId: e.id, start: end, end: start, beziers: reverseBeziers(bz) } });
    } else if (e.type === 'ellipse') {
      const g = ellipseOf(sketch, e);
      if (!g) continue;
      const start = ellipsePoint(g, 0);
      circles.push({ kind: 'ellipse', entityId: e.id, start, end: start, center: g.center, a: g.a, b: g.b, angle: g.angle, clockwise: false });
    } else if (e.type === 'circle') {
      const c = pointPosition(sketch, e.center);
      if (c) circles.push({ kind: 'circle', entityId: e.id, center: c, radius: e.radius, clockwise: false });
    }
  }
  if (edges.length === 0 && circles.length === 1) return { ok: true, segments: circles, closed: true };
  if (edges.length === 0 && circles.length === 0) return { ok: false, reason: 'empty' };
  if (circles.length > 0) return { ok: false, reason: 'several' };
  const degree = nodes.map((_n, i) => edges.filter((e) => e.a === i || e.b === i).length + edges.filter((e) => e.a === i && e.b === i).length);
  if (degree.some((d) => d > 2)) return { ok: false, reason: 'branched' };
  const ends = degree.flatMap((d, i) => (d === 1 ? [i] : []));
  const closed = ends.length === 0;
  let node = closed ? edges[0]!.a : ends[0]!;
  const used = new Set<number>();
  const segments: ProfileSegment[] = [];
  for (;;) {
    const k = edges.findIndex((e, i) => !used.has(i) && (e.a === node || e.b === node));
    if (k < 0) break;
    used.add(k);
    const e = edges[k]!;
    segments.push(e.a === node ? e.forward : e.backward);
    node = e.a === node ? e.b : e.a;
  }
  if (used.size !== edges.length) return { ok: false, reason: 'several' };
  return { ok: true, segments, closed };
}
