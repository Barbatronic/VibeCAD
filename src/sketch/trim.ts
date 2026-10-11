/**
 * Outil « Couper » de l'esquisse (calcul pur) : retirer le morceau d'une courbe compris entre les
 * deux intersections les plus proches du clic (ou jusqu'à une extrémité). Un segment coupé au
 * milieu devient deux segments alignés, un cercle devient un arc, un arc peut devenir deux arcs.
 *
 * Les nouvelles extrémités sont posées sur la courbe qui coupe (contrainte « point sur ») pour
 * rester attachées quand le dessin bouge. Les contraintes qui n'ont plus de sens après la coupe
 * (longueur, égalité de longueurs, milieu) sont retirées et comptées pour prévenir l'utilisateur.
 */
import type { SketchArc, SketchCircle, SketchConstraint, SketchCurve, SketchLine, SketchParams } from '../domain/model';
import type { Vec2 } from '../math/vec';
import { addConstraint, addPoint, arcContainsAngle, arcGeometry, curves, findEntity, linePoints, pointPosition, removeEntities, type ArcGeometry } from './model';
import { nextLocalId } from '../domain/ids';

type Primitive = { kind: 'seg'; a: Vec2; b: Vec2 } | { kind: 'circle'; c: Vec2; r: number } | { kind: 'arc'; c: Vec2; r: number; g: ArcGeometry };

function primitive(sketch: SketchParams, curve: SketchCurve): Primitive | null {
  if (curve.type === 'line') {
    const pts = linePoints(sketch, curve);
    return pts ? { kind: 'seg', a: pts[0], b: pts[1] } : null;
  }
  if (curve.type === 'circle') {
    const c = pointPosition(sketch, curve.center);
    return c ? { kind: 'circle', c, r: curve.radius } : null;
  }
  // Ellipses et splines : ni coupées, ni coupantes (pas encore gérées par l'outil Couper).
  if (curve.type !== 'arc') return null;
  const g = arcGeometry(sketch, curve);
  return g ? { kind: 'arc', c: g.center, r: g.radius, g } : null;
}

const EPS = 1e-9;

function onPrimitive(p: Primitive, q: Vec2, tol: number): boolean {
  if (p.kind === 'seg') {
    const dx = p.b.x - p.a.x;
    const dy = p.b.y - p.a.y;
    const len2 = dx * dx + dy * dy;
    const t = ((q.x - p.a.x) * dx + (q.y - p.a.y) * dy) / len2;
    return t >= -tol && t <= 1 + tol;
  }
  if (p.kind === 'arc') return arcContainsAngle(p.g, q) || Math.hypot(q.x - p.g.start.x, q.y - p.g.start.y) < tol * p.r || Math.hypot(q.x - p.g.end.x, q.y - p.g.end.y) < tol * p.r;
  return true;
}

/** Points d'intersection de deux courbes (droites portées, cercles), filtrés à leurs étendues. */
export function intersections(p: Primitive, q: Primitive): Vec2[] {
  const raw: Vec2[] = [];
  if (p.kind === 'seg' && q.kind === 'seg') {
    const d1 = { x: p.b.x - p.a.x, y: p.b.y - p.a.y };
    const d2 = { x: q.b.x - q.a.x, y: q.b.y - q.a.y };
    const den = d1.x * d2.y - d1.y * d2.x;
    if (Math.abs(den) > EPS * Math.hypot(d1.x, d1.y) * Math.hypot(d2.x, d2.y)) {
      const t = ((q.a.x - p.a.x) * d2.y - (q.a.y - p.a.y) * d2.x) / den;
      raw.push({ x: p.a.x + d1.x * t, y: p.a.y + d1.y * t });
    }
  } else if (p.kind === 'seg' || q.kind === 'seg') {
    const s = (p.kind === 'seg' ? p : q) as Extract<Primitive, { kind: 'seg' }>;
    const c = (p.kind === 'seg' ? q : p) as Exclude<Primitive, { kind: 'seg' }>;
    const d = { x: s.b.x - s.a.x, y: s.b.y - s.a.y };
    const f = { x: s.a.x - c.c.x, y: s.a.y - c.c.y };
    const A = d.x * d.x + d.y * d.y;
    const B = 2 * (f.x * d.x + f.y * d.y);
    const C = f.x * f.x + f.y * f.y - c.r * c.r;
    const disc = B * B - 4 * A * C;
    if (disc >= -1e-12 * A * c.r * c.r) {
      const sq = Math.sqrt(Math.max(0, disc));
      for (const t of sq < 1e-12 ? [-B / (2 * A)] : [(-B - sq) / (2 * A), (-B + sq) / (2 * A)]) raw.push({ x: s.a.x + d.x * t, y: s.a.y + d.y * t });
    }
  } else {
    const a = p as Exclude<Primitive, { kind: 'seg' }>;
    const b = q as Exclude<Primitive, { kind: 'seg' }>;
    const dx = b.c.x - a.c.x;
    const dy = b.c.y - a.c.y;
    const d = Math.hypot(dx, dy);
    if (d > EPS && d <= a.r + b.r + 1e-9 && d >= Math.abs(a.r - b.r) - 1e-9) {
      const l = (a.r * a.r - b.r * b.r + d * d) / (2 * d);
      const h = Math.sqrt(Math.max(0, a.r * a.r - l * l));
      const m = { x: a.c.x + (dx * l) / d, y: a.c.y + (dy * l) / d };
      raw.push({ x: m.x + (-dy * h) / d, y: m.y + (dx * h) / d });
      if (h > 1e-9) raw.push({ x: m.x - (-dy * h) / d, y: m.y - (dx * h) / d });
    }
  }
  const tol = 1e-7;
  return raw.filter((x) => onPrimitive(p, x, tol) && onPrimitive(q, x, tol));
}

/** Paramètre d'un point sur la courbe : segment [0, 1], cercle [0, 2π[ (angle), arc [0, 1] (fraction de l'ouverture). */
function paramOf(p: Primitive, q: Vec2): number {
  if (p.kind === 'seg') {
    const dx = p.b.x - p.a.x;
    const dy = p.b.y - p.a.y;
    return ((q.x - p.a.x) * dx + (q.y - p.a.y) * dy) / (dx * dx + dy * dy);
  }
  let a = Math.atan2(q.y - p.c.y, q.x - p.c.x);
  if (p.kind === 'circle') return a < 0 ? a + Math.PI * 2 : a;
  a -= p.g.startAngle;
  while (a < 0) a += Math.PI * 2;
  while (a >= Math.PI * 2) a -= Math.PI * 2;
  return a / p.g.sweep;
}

function pointAt(p: Primitive, t: number): Vec2 {
  if (p.kind === 'seg') return { x: p.a.x + (p.b.x - p.a.x) * t, y: p.a.y + (p.b.y - p.a.y) * t };
  const a = p.kind === 'circle' ? t : p.g.startAngle + p.g.sweep * t;
  return { x: p.c.x + p.r * Math.cos(a), y: p.c.y + p.r * Math.sin(a) };
}

interface Cut {
  t: number;
  point: Vec2;
  /** Courbe qui coupe à cet endroit (l'extrémité nouvelle y sera posée). */
  by: string;
}

/** Morceau retiré par un clic : bornes (absentes : jusqu'à l'extrémité) et forme pour l'aperçu. */
export interface TrimPiece {
  curveId: string;
  lo: Cut | null;
  hi: Cut | null;
  /** Polyligne du morceau retiré (aperçu en rouge). */
  path: Vec2[];
}

/** Morceau de la courbe `curveId` qui serait retiré par un clic en `at` (null : courbe inconnue). */
export function trimPiece(sketch: SketchParams, curveId: string, at: Vec2): TrimPiece | null {
  const curve = findEntity(sketch, curveId);
  if (!curve || curve.type === 'point' || curve.reference) return null;
  const prim = primitive(sketch, curve);
  if (!prim) return null;
  const cuts: Cut[] = [];
  for (const other of curves(sketch)) {
    if (other.id === curve.id) continue;
    const op = primitive(sketch, other);
    if (!op) continue;
    for (const point of intersections(prim, op)) cuts.push({ t: paramOf(prim, point), point, by: other.id });
  }
  const tc = paramOf(prim, at);
  const span = prim.kind === 'circle' ? Math.PI * 2 : 1;
  const margin = 1e-6 * span;
  let lo: Cut | null = null;
  let hi: Cut | null = null;
  if (prim.kind === 'circle') {
    // Sur un cercle, les bornes sont les intersections les plus proches de part et d'autre (en tournant).
    const ahead = (c: Cut) => (c.t - tc + Math.PI * 4) % (Math.PI * 2);
    const distinct = cuts.filter((c, i) => cuts.findIndex((d) => Math.abs(d.t - c.t) < margin) === i);
    if (distinct.length >= 2) {
      hi = distinct.reduce((best, c) => (ahead(c) < ahead(best) ? c : best));
      lo = distinct.reduce((best, c) => (ahead(c) > ahead(best) ? c : best));
    }
  } else {
    for (const c of cuts) {
      if (c.t <= margin || c.t >= span - margin) continue;
      if (c.t < tc && (!lo || c.t > lo.t)) lo = c;
      if (c.t > tc && (!hi || c.t < hi.t)) hi = c;
    }
  }
  // Polyligne du morceau retiré.
  const from = lo ? lo.t : 0;
  let to = hi ? hi.t : span;
  if (prim.kind === 'circle') {
    if (!lo || !hi) {
      to = from + Math.PI * 2;
    } else if (to < from) to += Math.PI * 2;
  }
  const n = prim.kind === 'seg' ? 1 : Math.max(8, Math.ceil(((to - from) / span) * 64));
  const path = Array.from({ length: n + 1 }, (_v, i) => pointAt(prim, from + ((to - from) * i) / n));
  return { curveId, lo, hi, path };
}

export interface TrimOutcome {
  sketch: SketchParams;
  /** Toute la courbe a été supprimée (aucune intersection pour la borner). */
  deleted: boolean;
  /** Nombre de cotes ou contraintes retirées parce qu'elles n'avaient plus de sens. */
  droppedConstraints: number;
}

/** Contraintes d'un segment qui gardent leur sens sur la droite qui le porte. */
const LINE_KEEPS = new Set<SketchConstraint['type']>(['horizontal', 'vertical', 'parallel', 'perpendicular', 'collinear', 'angle', 'tangent', 'pointOn', 'pointLineDistance', 'coincident', 'distance', 'distanceX', 'distanceY']);

/** Retire le morceau désigné par un clic en `at` sur la courbe `curveId`. */
export function trimAt(sketch: SketchParams, curveId: string, at: Vec2): TrimOutcome | null {
  const piece = trimPiece(sketch, curveId, at);
  if (!piece) return null;
  const curve = findEntity(sketch, curveId) as SketchCurve;
  const { lo, hi } = piece;
  if (!lo && !hi) return { sketch: removeEntities(sketch, [curveId]), deleted: true, droppedConstraints: 0 };
  if (curve.type === 'circle') {
    if (!lo || !hi) return { sketch: removeEntities(sketch, [curveId]), deleted: true, droppedConstraints: 0 };
    return circleToArc(sketch, curve, lo, hi);
  }
  if (curve.type === 'line') return trimLine(sketch, curve, lo, hi);
  return curve.type === 'arc' ? trimArc(sketch, curve, lo, hi) : null;
}

/**
 * Nouveau point à l'intersection : relié par une coïncidence à l'extrémité de la courbe qui coupe
 * si elle s'y trouve déjà (coin d'un contour, courbe déjà coupée là), sinon posé sur cette courbe.
 */
function cutPoint(sketch: SketchParams, cut: Cut): { sketch: SketchParams; id: string } {
  const r = addPoint(sketch, cut.point);
  const by = findEntity(sketch, cut.by);
  const ends = by?.type === 'line' ? [by.a, by.b] : by?.type === 'arc' ? [by.start, by.end] : [];
  const scale = Math.max(1, Math.hypot(cut.point.x, cut.point.y));
  const shared = ends.find((id) => {
    const q = pointPosition(sketch, id);
    return q && Math.hypot(q.x - cut.point.x, q.y - cut.point.y) < 1e-6 * scale;
  });
  const constraint = shared ? ({ type: 'coincident', a: shared, b: r.id } as const) : ({ type: 'pointOn', point: r.id, curve: cut.by } as const);
  return { sketch: addConstraint(r.sketch, constraint).sketch, id: r.id };
}

function replaceEntity<T extends SketchCurve>(sketch: SketchParams, id: string, next: T): SketchParams {
  return { ...sketch, entities: sketch.entities.map((e) => (e.id === id ? next : e)) };
}

/** Retire un point devenu inutile et les contraintes qui le visaient. */
function dropPoint(sketch: SketchParams, pointId: string): SketchParams {
  return {
    ...sketch,
    entities: sketch.entities.filter((e) => e.id !== pointId),
    constraints: sketch.constraints.filter((c) => !constraintRefs(c).includes(pointId)),
  };
}

function constraintRefs(c: SketchConstraint): string[] {
  return Object.entries(c)
    .filter(([k, v]) => typeof v === 'string' && k !== 'id' && k !== 'type')
    .map(([, v]) => v as string);
}

function trimLine(sketch: SketchParams, line: SketchLine, lo: Cut | null, hi: Cut | null): TrimOutcome {
  let sk = sketch;
  const before = sk.constraints.length;
  // Contraintes du segment qui ne survivent pas à la coupe (longueur, égalité, milieu).
  sk = { ...sk, constraints: sk.constraints.filter((c) => !(constraintRefs(c).includes(line.id) && !LINE_KEEPS.has(c.type))) };
  const dropped = before - sk.constraints.length;
  if (lo && hi) {
    // Coupe au milieu : a → lo et hi → b, maintenus alignés.
    const pa = cutPoint(sk, lo);
    sk = pa.sketch;
    const pb = cutPoint(sk, hi);
    sk = pb.sketch;
    const secondId = nextLocalId('l', sk.entities.map((e) => e.id));
    const second: SketchLine = { ...line, id: secondId, a: pb.id, b: line.b };
    sk = replaceEntity(sk, line.id, { ...line, b: pa.id });
    sk = { ...sk, entities: [...sk.entities, second] };
    sk = addConstraint(sk, { type: 'collinear', a: line.id, b: secondId }).sketch;
    return { sketch: sk, deleted: false, droppedConstraints: dropped };
  }
  // Coupe d'un bout : l'extrémité retirée est remplacée par le point d'intersection.
  const cut = (lo ?? hi)!;
  const p = cutPoint(sk, cut);
  sk = p.sketch;
  const old = lo ? line.b : line.a;
  sk = replaceEntity(sk, line.id, lo ? { ...line, b: p.id } : { ...line, a: p.id });
  const withPoint = sk.constraints.length;
  sk = dropPoint(sk, old);
  return { sketch: sk, deleted: false, droppedConstraints: dropped + (withPoint - sk.constraints.length) };
}

function trimArc(sketch: SketchParams, arc: SketchArc, lo: Cut | null, hi: Cut | null): TrimOutcome {
  let sk = sketch;
  if (lo && hi) {
    // Coupe au milieu : départ → lo et hi → arrivée, même centre et même rayon.
    const pa = cutPoint(sk, lo);
    sk = pa.sketch;
    const pb = cutPoint(sk, hi);
    sk = pb.sketch;
    const center = pointPosition(sk, arc.center)!;
    const c2 = addPoint(sk, center);
    sk = c2.sketch;
    const secondId = nextLocalId('a', sk.entities.map((e) => e.id));
    const second: SketchArc = { ...arc, id: secondId, center: c2.id, start: pb.id, end: arc.end };
    sk = replaceEntity(sk, arc.id, { ...arc, end: pa.id });
    sk = { ...sk, entities: [...sk.entities, second] };
    sk = addConstraint(sk, { type: 'coincident', a: arc.center, b: c2.id }).sketch;
    sk = addConstraint(sk, { type: 'equal', a: arc.id, b: secondId }).sketch;
    return { sketch: sk, deleted: false, droppedConstraints: 0 };
  }
  const cut = (lo ?? hi)!;
  const p = cutPoint(sk, cut);
  sk = p.sketch;
  const old = lo ? arc.end : arc.start;
  sk = replaceEntity(sk, arc.id, lo ? { ...arc, end: p.id } : { ...arc, start: p.id });
  const before = sk.constraints.length;
  sk = dropPoint(sk, old);
  return { sketch: sk, deleted: false, droppedConstraints: before - sk.constraints.length };
}

/** Cercle coupé : il devient l'arc qui reste, de `hi` à `lo` dans le sens trigonométrique. */
function circleToArc(sketch: SketchParams, circle: SketchCircle, lo: Cut, hi: Cut): TrimOutcome {
  let sk = sketch;
  const ps = cutPoint(sk, hi);
  sk = ps.sketch;
  const pe = cutPoint(sk, lo);
  sk = pe.sketch;
  const arc: SketchArc = { id: circle.id, type: 'arc', center: circle.center, start: ps.id, end: pe.id, ...(circle.construction ? { construction: true } : {}) };
  sk = { ...sk, entities: sk.entities.map((e) => (e.id === circle.id ? arc : e)) };
  return { sketch: sk, deleted: false, droppedConstraints: 0 };
}

