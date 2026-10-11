/**
 * Outil « Décalage » de l'esquisse (calcul pur) : recopier un contour fermé à une distance donnée,
 * vers l'extérieur (distance positive) ou l'intérieur (négative). Chaque segment est déplacé le
 * long de sa normale, chaque arc garde son centre et change de rayon ; les coins sont recalculés
 * à l'intersection des courbes décalées (coins vifs, comme le contour d'origine).
 *
 * Le contour décalé reste lié à l'original : segments parallèles à distance cotée, arcs et cercles
 * sur le même centre. Modifier la cote de distance déplace tout le contour.
 */
import { nextLocalId } from '../domain/ids';
import type { SketchArc, SketchCircle, SketchLine, SketchParams } from '../domain/model';
import { add2, distance2, dot2, scale2, sub2, type Vec2 } from '../math/vec';
import { addConstraint, addPoint, findEntity } from './model';
import { extractProfiles, type ProfileLoop, type ProfileSegment as AnySegment } from './profiles';

/** Le décalage sait recopier segments, arcs et cercles (pas encore ellipses ni splines). */
type ProfileSegment = Extract<AnySegment, { kind: 'line' | 'arc' | 'circle' }>;
const simpleSegments = (loop: ProfileLoop) => loop.segments as ProfileSegment[];

export type OffsetFailure = { error: string };

/** Contour fermé (extérieur ou trou d'une région) qui contient la courbe. */
export function loopOfCurve(sketch: SketchParams, curveId: string): { loop: ProfileLoop } | OffsetFailure {
  const profiles = extractProfiles(sketch);
  if (!profiles.ok) return { error: 'Le dessin a un contour ouvert ou qui se croise : fermez-le d’abord, le décalage part d’un contour fermé.' };
  for (const region of profiles.regions) {
    for (const loop of [region.outer, ...region.holes]) {
      if (!loop.segments.some((s) => s.entityId === curveId)) continue;
      if (loop.segments.some((s) => s.kind === 'spline' || s.kind === 'ellipse')) return { error: 'Le décalage ne sait pas encore recopier un contour qui contient une ellipse ou une spline.' };
      return { loop };
    }
  }
  return { error: 'Ce trait ne fait pas partie d’un contour fermé (les traits de construction sont ignorés).' };
}

/** Normale extérieure (unitaire) d'un segment du contour au point `p`, et rayon décalé d'un arc. */
function outward(loop: ProfileLoop, seg: ProfileSegment, p: Vec2): Vec2 {
  const s = Math.sign(loop.signedArea) || 1;
  if (seg.kind === 'line') {
    const t = scale2(sub2(seg.end, seg.start), 1 / distance2(seg.start, seg.end));
    return scale2({ x: t.y, y: -t.x }, s);
  }
  const r = scale2(sub2(p, seg.center), 1 / seg.radius);
  return scale2(r, radiusSign(loop, seg));
}

/** +1 si le rayon grandit quand on décale vers l'extérieur, −1 sinon. */
function radiusSign(loop: ProfileLoop, seg: Extract<ProfileSegment, { kind: 'arc' | 'circle' }>): number {
  if (seg.kind === 'circle') return 1;
  const s = Math.sign(loop.signedArea) || 1;
  return seg.clockwise ? -s : s;
}

type Curve = { kind: 'line'; p: Vec2; dir: Vec2 } | { kind: 'circle'; c: Vec2; r: number };

function intersect(a: Curve, b: Curve): Vec2[] {
  if (a.kind === 'line' && b.kind === 'line') {
    const den = a.dir.x * b.dir.y - a.dir.y * b.dir.x;
    if (Math.abs(den) < 1e-12) return [];
    const t = ((b.p.x - a.p.x) * b.dir.y - (b.p.y - a.p.y) * b.dir.x) / den;
    return [add2(a.p, scale2(a.dir, t))];
  }
  if (a.kind === 'circle' && b.kind === 'circle') {
    const d = distance2(a.c, b.c);
    if (d < 1e-12 || d > a.r + b.r + 1e-9 || d < Math.abs(a.r - b.r) - 1e-9) return [];
    const x = (d * d + a.r * a.r - b.r * b.r) / (2 * d);
    const h = Math.sqrt(Math.max(0, a.r * a.r - x * x));
    const u = scale2(sub2(b.c, a.c), 1 / d);
    const m = add2(a.c, scale2(u, x));
    return [add2(m, scale2({ x: -u.y, y: u.x }, h)), add2(m, scale2({ x: u.y, y: -u.x }, h))];
  }
  const l = (a.kind === 'line' ? a : b) as Extract<Curve, { kind: 'line' }>;
  const c = (a.kind === 'line' ? b : a) as Extract<Curve, { kind: 'circle' }>;
  const f = sub2(l.p, c.c);
  const A = dot2(l.dir, l.dir);
  const B = 2 * dot2(f, l.dir);
  const C = dot2(f, f) - c.r * c.r;
  const disc = B * B - 4 * A * C;
  if (disc < -1e-9) return [];
  const sq = Math.sqrt(Math.max(0, disc));
  return [(-B - sq) / (2 * A), (-B + sq) / (2 * A)].map((t) => add2(l.p, scale2(l.dir, t)));
}

/** Contour décalé : mêmes segments (dans le même ordre), extrémités recalculées. */
export function offsetSegments(loop: ProfileLoop, distance: number): ProfileSegment[] | OffsetFailure {
  const segs = simpleSegments(loop);
  const tooFar = { error: 'Distance trop grande pour ce contour : le contour décalé se retournerait. Essayez une distance plus petite.' };
  if (segs.length === 1 && segs[0]!.kind === 'circle') {
    const c = segs[0]!;
    const r = c.radius + distance;
    return r > 1e-6 ? [{ ...c, radius: r }] : tooFar;
  }
  const curves: Curve[] = segs.map((seg) => {
    if (seg.kind === 'line') {
      const n = outward(loop, seg, seg.start);
      return { kind: 'line', p: add2(seg.start, scale2(n, distance)), dir: sub2(seg.end, seg.start) };
    }
    const c = seg as Extract<ProfileSegment, { kind: 'arc' | 'circle' }>;
    return { kind: 'circle', c: c.center, r: c.radius + distance * radiusSign(loop, c) };
  });
  if (curves.some((c) => c.kind === 'circle' && c.r <= 1e-6)) return tooFar;
  // Coin i : entre la fin du segment i et le début du segment i + 1.
  const corners: Vec2[] = [];
  for (let i = 0; i < segs.length; i++) {
    const a = segs[i]!;
    const b = segs[(i + 1) % segs.length]!;
    const p = 'end' in a ? a.end : a.center;
    const qa = add2(p, scale2(outward(loop, a, p), distance));
    const qb = add2(p, scale2(outward(loop, b, p), distance));
    // Raccord tangent : les deux courbes décalées se touchent au même point.
    if (distance2(qa, qb) < 1e-9 * Math.max(1, Math.abs(distance))) {
      corners.push(qa);
      continue;
    }
    const target = scale2(add2(qa, qb), 0.5);
    const hits = intersect(curves[i]!, curves[(i + 1) % segs.length]!);
    if (hits.length === 0) return tooFar;
    corners.push(hits.reduce((best, h) => (distance2(h, target) < distance2(best, target) ? h : best)));
  }
  const out: ProfileSegment[] = [];
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]!;
    const start = corners[(i - 1 + segs.length) % segs.length]!;
    const end = corners[i]!;
    if (seg.kind === 'line') {
      // Un segment qui change de sens a disparu dans le décalage.
      if (dot2(sub2(end, start), sub2(seg.end, seg.start)) <= 1e-9) return tooFar;
      out.push({ ...seg, start, end });
    } else if (seg.kind === 'arc') {
      const c = curves[i] as Extract<Curve, { kind: 'circle' }>;
      const sweep = (v: Vec2, w: Vec2) => {
        let d = Math.atan2(w.y - seg.center.y, w.x - seg.center.x) - Math.atan2(v.y - seg.center.y, v.x - seg.center.x);
        if (seg.clockwise) d = -d;
        while (d <= 0) d += Math.PI * 2;
        return d;
      };
      if (Math.abs(sweep(start, end) - sweep(seg.start, seg.end)) > Math.PI / 2 || distance2(start, end) < 1e-6) return tooFar;
      out.push({ ...seg, start, end, radius: c.r });
    }
  }
  return out;
}

/** Distance signée du point au contour (positive dehors). */
export function signedDistanceToLoop(loop: ProfileLoop, p: Vec2): number {
  let best = Infinity;
  let inside = false;
  const poly: Vec2[] = [];
  for (const seg of simpleSegments(loop)) {
    if (seg.kind === 'line') {
      const d = sub2(seg.end, seg.start);
      const t = Math.max(0, Math.min(1, dot2(sub2(p, seg.start), d) / dot2(d, d)));
      best = Math.min(best, distance2(p, add2(seg.start, scale2(d, t))));
      poly.push(seg.start);
    } else {
      best = Math.min(best, Math.abs(distance2(p, seg.center) - seg.radius));
      const a0 = seg.kind === 'circle' ? 0 : Math.atan2(seg.start.y - seg.center.y, seg.start.x - seg.center.x);
      let sw = Math.PI * 2;
      if (seg.kind === 'arc') {
        sw = Math.atan2(seg.end.y - seg.center.y, seg.end.x - seg.center.x) - a0;
        if (seg.clockwise) while (sw >= 0) sw -= Math.PI * 2;
        else while (sw <= 0) sw += Math.PI * 2;
      }
      for (let k = 0; k < 24; k++) poly.push(add2(seg.center, scale2({ x: Math.cos(a0 + (sw * k) / 24), y: Math.sin(a0 + (sw * k) / 24) }, seg.radius)));
    }
  }
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside ? -best : best;
}

/**
 * Ajoute le contour décalé à l'esquisse : nouveaux points aux coins, segments parallèles aux
 * originaux avec une cote de distance, arcs et cercles sur le même centre.
 */
export function addOffsetLoop(sketch: SketchParams, loop: ProfileLoop, distance: number, construction: boolean): { sketch: SketchParams; curves: string[] } | OffsetFailure {
  const segs = offsetSegments(loop, distance);
  if ('error' in segs) return segs;
  let sk = sketch;
  const ids = () => sk.entities.map((e) => e.id);
  const flag = construction ? { construction: true } : {};
  const curves: string[] = [];
  const gap = Math.abs(distance);
  if (segs.length === 1 && segs[0]!.kind === 'circle') {
    const orig = findEntity(sk, segs[0]!.entityId) as SketchCircle;
    const id = nextLocalId('c', ids());
    sk = { ...sk, entities: [...sk.entities, { id, type: 'circle', center: orig.center, radius: segs[0]!.radius, ...flag }] };
    sk = addConstraint(sk, { type: 'diameter', circle: id, value: Math.round(2 * segs[0]!.radius * 1e6) / 1e6 }).sketch;
    return { sketch: sk, curves: [id] };
  }
  // Un point par coin (fin du segment i = début du segment i + 1).
  const corners: string[] = [];
  for (const seg of segs) {
    const r = addPoint(sk, (seg as Extract<ProfileSegment, { kind: 'line' | 'arc' }>).end);
    sk = r.sketch;
    corners.push(r.id);
  }
  segs.forEach((seg, i) => {
    const start = corners[(i - 1 + segs.length) % segs.length]!;
    const end = corners[i]!;
    if (seg.kind === 'line') {
      const id = nextLocalId('l', ids());
      const line: SketchLine = { id, type: 'line', a: start, b: end, ...flag };
      sk = { ...sk, entities: [...sk.entities, line] };
      sk = addConstraint(sk, { type: 'parallel', a: id, b: seg.entityId }).sketch;
      sk = addConstraint(sk, { type: 'pointLineDistance', point: start, line: seg.entityId, value: gap }).sketch;
      curves.push(id);
    } else if (seg.kind === 'arc') {
      const orig = findEntity(sk, seg.entityId) as SketchArc;
      const id = nextLocalId('a', ids());
      // L'arc du modèle va toujours de `start` à `end` dans le sens trigonométrique.
      const arc: SketchArc = { id, type: 'arc', center: orig.center, start: seg.clockwise ? end : start, end: seg.clockwise ? start : end, ...flag };
      sk = { ...sk, entities: [...sk.entities, arc] };
      curves.push(id);
    }
  });
  // Contour décalé fait seulement d'arcs : un rayon coté pour le tenir.
  if (segs.every((s) => s.kind !== 'line')) {
    const first = segs[0] as Extract<ProfileSegment, { kind: 'arc' }>;
    sk = addConstraint(sk, { type: 'radius', circle: curves[0]!, value: Math.round(first.radius * 1e6) / 1e6 }).sketch;
  }
  return { sketch: sk, curves };
}

