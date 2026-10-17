/**
 * Opérations pures sur le contenu d'une esquisse (aucune mutation : chaque fonction renvoie une
 * nouvelle esquisse). Les identifiants locaux sont lisibles et stables : p1, l1, c1, k1…
 */
import { nextLocalId } from '../domain/ids';
import {
  constraintReferences,
  ORIGIN_POINT_ID,
  type SketchArc,
  type SketchCircle,
  type SketchCurve,
  type SketchEllipse,
  type SketchSpline,
  type SketchConstraint,
  type SketchEntity,
  type SketchLine,
  type SketchParams,
  type SketchPoint,
  type SketchSupport,
} from '../domain/model';
import type { Vec2 } from '../math/vec';
import { ellipseGeometry, splineBeziers, type Bezier, type EllipseGeometry } from './curves';

export function emptySketch(support: SketchSupport): SketchParams {
  return { support, entities: [], constraints: [] };
}

export function findEntity(sketch: SketchParams, id: string): SketchEntity | undefined {
  return sketch.entities.find((e) => e.id === id);
}

export function findPoint(sketch: SketchParams, id: string): SketchPoint | undefined {
  const e = findEntity(sketch, id);
  return e?.type === 'point' ? e : undefined;
}

export function findLine(sketch: SketchParams, id: string): SketchLine | undefined {
  const e = findEntity(sketch, id);
  return e?.type === 'line' ? e : undefined;
}

export function findCircle(sketch: SketchParams, id: string): SketchCircle | undefined {
  const e = findEntity(sketch, id);
  return e?.type === 'circle' ? e : undefined;
}

export function findArc(sketch: SketchParams, id: string): SketchArc | undefined {
  const e = findEntity(sketch, id);
  return e?.type === 'arc' ? e : undefined;
}

/** Cercle ou arc : ce qui a un centre et un rayon. */
export function findRound(sketch: SketchParams, id: string): SketchCircle | SketchArc | undefined {
  const e = findEntity(sketch, id);
  return e?.type === 'circle' || e?.type === 'arc' ? e : undefined;
}

export interface ArcGeometry {
  center: Vec2;
  start: Vec2;
  end: Vec2;
  radius: number;
  /** Angle du point de départ (radians). */
  startAngle: number;
  /** Ouverture de l'arc dans le sens trigonométrique, dans ]0, 2π]. */
  sweep: number;
}

export function arcGeometry(sketch: SketchParams, arc: SketchArc): ArcGeometry | undefined {
  const center = pointPosition(sketch, arc.center);
  const start = pointPosition(sketch, arc.start);
  const end = pointPosition(sketch, arc.end);
  if (!center || !start || !end) return undefined;
  const radius = Math.hypot(start.x - center.x, start.y - center.y);
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
  let sweep = Math.atan2(end.y - center.y, end.x - center.x) - startAngle;
  while (sweep <= 1e-12) sweep += Math.PI * 2;
  while (sweep > Math.PI * 2) sweep -= Math.PI * 2;
  return { center, start, end, radius, startAngle, sweep };
}

/** Point de l'arc à une fraction `t` de son ouverture (0 : départ, 1 : arrivée). */
export function arcPointAt(g: ArcGeometry, t: number): Vec2 {
  const a = g.startAngle + g.sweep * t;
  return { x: g.center.x + g.radius * Math.cos(a), y: g.center.y + g.radius * Math.sin(a) };
}

/** Vrai si la direction `p - centre` tombe dans l'ouverture de l'arc. */
export function arcContainsAngle(g: ArcGeometry, p: Vec2): boolean {
  let d = Math.atan2(p.y - g.center.y, p.x - g.center.x) - g.startAngle;
  while (d < 0) d += Math.PI * 2;
  while (d > Math.PI * 2) d -= Math.PI * 2;
  return d <= g.sweep + 1e-12;
}

/** Position d'un point (l'origine est toujours en 0, 0). */
export function pointPosition(sketch: SketchParams, id: string): Vec2 | undefined {
  if (id === ORIGIN_POINT_ID) return { x: 0, y: 0 };
  const p = findPoint(sketch, id);
  return p ? { x: p.x, y: p.y } : undefined;
}

export function linePoints(sketch: SketchParams, line: SketchLine): [Vec2, Vec2] | undefined {
  const a = pointPosition(sketch, line.a);
  const b = pointPosition(sketch, line.b);
  return a && b ? [a, b] : undefined;
}

export function curves(sketch: SketchParams): SketchCurve[] {
  return sketch.entities.filter((e): e is SketchCurve => e.type !== 'point');
}

const entityIds = (sketch: SketchParams) => sketch.entities.map((e) => e.id);
const constraintIds = (sketch: SketchParams) => sketch.constraints.map((c) => c.id);

export function addPoint(sketch: SketchParams, at: Vec2): { sketch: SketchParams; id: string } {
  const id = nextLocalId('p', entityIds(sketch));
  const point: SketchPoint = { id, type: 'point', x: at.x, y: at.y };
  return { sketch: { ...sketch, entities: [...sketch.entities, point] }, id };
}

export function addLine(
  sketch: SketchParams,
  from: Vec2,
  to: Vec2,
): { sketch: SketchParams; lineId: string; a: string; b: string } {
  const r1 = addPoint(sketch, from);
  const r2 = addPoint(r1.sketch, to);
  const lineId = nextLocalId('l', entityIds(r2.sketch));
  const line: SketchLine = { id: lineId, type: 'line', a: r1.id, b: r2.id };
  return { sketch: { ...r2.sketch, entities: [...r2.sketch.entities, line] }, lineId, a: r1.id, b: r2.id };
}

/** Contour fermé de segments qui partagent leurs sommets (dans l'ordre, sans répéter le premier). */
export function addClosedPolyline(sketch: SketchParams, points: Vec2[]): { sketch: SketchParams; lineIds: string[] } {
  const next = (prefix: string) => {
    const re = new RegExp(`^${prefix}(\\d+)$`);
    let max = 0;
    for (const e of sketch.entities) {
      const m = re.exec(e.id);
      if (m) max = Math.max(max, Number(m[1]));
    }
    return max + 1;
  };
  const p0 = next('p');
  const l0 = next('l');
  const pts: SketchPoint[] = points.map((at, i) => ({ id: `p${p0 + i}`, type: 'point', x: at.x, y: at.y }));
  const lines: SketchLine[] = points.map((_, i) => ({ id: `l${l0 + i}`, type: 'line', a: `p${p0 + i}`, b: `p${p0 + ((i + 1) % points.length)}` }));
  return { sketch: { ...sketch, entities: [...sketch.entities, ...pts, ...lines] }, lineIds: lines.map((l) => l.id) };
}

export function addCircle(
  sketch: SketchParams,
  center: Vec2,
  radius: number,
): { sketch: SketchParams; circleId: string; center: string } {
  const r1 = addPoint(sketch, center);
  const circleId = nextLocalId('c', entityIds(r1.sketch));
  const circle: SketchCircle = { id: circleId, type: 'circle', center: r1.id, radius };
  return { sketch: { ...r1.sketch, entities: [...r1.sketch.entities, circle] }, circleId, center: r1.id };
}

/** Arc de `start` à `end` (sens trigonométrique) autour de `center`. */
export function addArc(sketch: SketchParams, center: Vec2, start: Vec2, end: Vec2): { sketch: SketchParams; arcId: string; center: string; start: string; end: string } {
  const r1 = addPoint(sketch, center);
  const r2 = addPoint(r1.sketch, start);
  const r3 = addPoint(r2.sketch, end);
  const arcId = nextLocalId('a', entityIds(r3.sketch));
  const arc: SketchArc = { id: arcId, type: 'arc', center: r1.id, start: r2.id, end: r3.id };
  return { sketch: { ...r3.sketch, entities: [...r3.sketch.entities, arc] }, arcId, center: r1.id, start: r2.id, end: r3.id };
}

/** Ellipse centrée sur `center`, grand axe jusqu'à `majorEnd`, petit rayon `minorRadius`. */
export function addEllipse(sketch: SketchParams, center: Vec2, majorEnd: Vec2, minorRadius: number): { sketch: SketchParams; ellipseId: string; center: string; major: string } {
  const r1 = addPoint(sketch, center);
  const r2 = addPoint(r1.sketch, majorEnd);
  const ellipseId = nextLocalId('e', entityIds(r2.sketch));
  const ellipse: SketchEllipse = { id: ellipseId, type: 'ellipse', center: r1.id, major: r2.id, minorRadius };
  return { sketch: { ...r2.sketch, entities: [...r2.sketch.entities, ellipse] }, ellipseId, center: r1.id, major: r2.id };
}

/** Spline passant par des points existants (identifiants) ou nouveaux (positions). */
export function addSpline(sketch: SketchParams, through: (string | Vec2)[], closed: boolean): { sketch: SketchParams; splineId: string; points: string[] } {
  let sk = sketch;
  const ids = through.map((t) => {
    if (typeof t === 'string') return t;
    const r = addPoint(sk, t);
    sk = r.sketch;
    return r.id;
  });
  const splineId = nextLocalId('s', entityIds(sk));
  const spline: SketchSpline = { id: splineId, type: 'spline', points: ids, closed };
  return { sketch: { ...sk, entities: [...sk.entities, spline] }, splineId, points: ids };
}

/** Géométrie d'une ellipse de l'esquisse. */
export function ellipseOf(sketch: SketchParams, e: SketchEllipse): EllipseGeometry | undefined {
  const c = pointPosition(sketch, e.center);
  const m = pointPosition(sketch, e.major);
  return c && m ? ellipseGeometry(c, m, e.minorRadius) : undefined;
}

/** Morceaux de Bézier d'une spline de l'esquisse. */
export function splineOf(sketch: SketchParams, e: SketchSpline): Bezier[] {
  const pts = e.points.map((id) => pointPosition(sketch, id));
  if (pts.some((p) => !p)) return [];
  return splineBeziers(pts as Vec2[], e.closed);
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type NewConstraint = DistributiveOmit<SketchConstraint, 'id'>;

export function addConstraint(sketch: SketchParams, constraint: NewConstraint): { sketch: SketchParams; id: string } {
  const id = nextLocalId('k', constraintIds(sketch));
  const full = { ...constraint, id } as SketchConstraint;
  return { sketch: { ...sketch, constraints: [...sketch.constraints, full] }, id };
}

export function updateConstraint(sketch: SketchParams, id: string, patch: Partial<SketchConstraint>): SketchParams {
  return {
    ...sketch,
    constraints: sketch.constraints.map((c) => (c.id === id ? ({ ...c, ...patch, id: c.id, type: c.type } as SketchConstraint) : c)),
  };
}

/**
 * Rectangle aligné sur les axes : 4 segments, 4 coïncidences, 2 horizontales, 2 verticales.
 * Ordre des segments : bas, droite, haut, gauche (dans le sens trigonométrique si c1 est en bas à gauche).
 */
export function addRectangle(
  sketch: SketchParams,
  c1: Vec2,
  c2: Vec2,
): { sketch: SketchParams; lines: [string, string, string, string]; corners: [string, string, string, string] } {
  const p0 = { x: c1.x, y: c1.y };
  const p1 = { x: c2.x, y: c1.y };
  const p2 = { x: c2.x, y: c2.y };
  const p3 = { x: c1.x, y: c2.y };
  let s = sketch;
  const bottom = addLine(s, p0, p1);
  s = bottom.sketch;
  const right = addLine(s, p1, p2);
  s = right.sketch;
  const top = addLine(s, p2, p3);
  s = top.sketch;
  const left = addLine(s, p3, p0);
  s = left.sketch;
  s = addConstraint(s, { type: 'coincident', a: bottom.b, b: right.a }).sketch;
  s = addConstraint(s, { type: 'coincident', a: right.b, b: top.a }).sketch;
  s = addConstraint(s, { type: 'coincident', a: top.b, b: left.a }).sketch;
  s = addConstraint(s, { type: 'coincident', a: left.b, b: bottom.a }).sketch;
  s = addConstraint(s, { type: 'horizontal', line: bottom.lineId }).sketch;
  s = addConstraint(s, { type: 'horizontal', line: top.lineId }).sketch;
  s = addConstraint(s, { type: 'vertical', line: right.lineId }).sketch;
  s = addConstraint(s, { type: 'vertical', line: left.lineId }).sketch;
  return {
    sketch: s,
    lines: [bottom.lineId, right.lineId, top.lineId, left.lineId],
    corners: [bottom.a, right.a, top.a, left.a],
  };
}

/** Entités référencées par une contrainte. */
export { constraintReferences };

/** Points « possédés » par une courbe (supprimés avec elle). */
export function ownedPoints(entity: SketchEntity): string[] {
  if (entity.type === 'line') return [entity.a, entity.b];
  if (entity.type === 'circle') return [entity.center];
  if (entity.type === 'arc') return [entity.center, entity.start, entity.end];
  if (entity.type === 'ellipse') return [entity.center, entity.major];
  if (entity.type === 'spline') return [...entity.points];
  return [];
}

/**
 * Supprime des éléments et tout ce qui en dépend : une courbe emporte ses points, un point
 * emporte les courbes qui l'utilisent, et les contraintes orphelines sont retirées.
 */
export function removeEntities(sketch: SketchParams, ids: Iterable<string>): SketchParams {
  const removed = new Set(ids);
  removed.delete(ORIGIN_POINT_ID);
  let changed = true;
  while (changed) {
    changed = false;
    for (const e of sketch.entities) {
      if (removed.has(e.id)) {
        for (const p of ownedPoints(e)) {
          if (!removed.has(p)) {
            removed.add(p);
            changed = true;
          }
        }
      } else if (ownedPoints(e).some((p) => removed.has(p))) {
        removed.add(e.id);
        changed = true;
      }
    }
  }
  const entities = sketch.entities.filter((e) => !removed.has(e.id));
  const constraints = sketch.constraints.filter((c) => constraintReferences(c).every((r) => !removed.has(r)));
  return { ...sketch, entities, constraints };
}

export function removeConstraints(sketch: SketchParams, ids: Iterable<string>): SketchParams {
  const removed = new Set(ids);
  return { ...sketch, constraints: sketch.constraints.filter((c) => !removed.has(c.id)) };
}

/** Points seuls (posés avec l'outil Point) : aucune courbe ne les utilise. L'origine n'en fait pas partie. */
export function standalonePoints(sketch: SketchParams): SketchPoint[] {
  const owned = new Set(curves(sketch).flatMap((c) => ownedPoints(c)));
  return sketch.entities.filter((e): e is SketchPoint => e.type === 'point' && !owned.has(e.id));
}

/** Courbe qui possède un point (segment dont c'est une extrémité, cercle dont c'est le centre). */
export function ownerOfPoint(sketch: SketchParams, pointId: string): SketchCurve | undefined {
  return curves(sketch).find((c) => ownedPoints(c).includes(pointId));
}

/** Groupes de points reliés par des coïncidences (union-find). L'origine est incluse. */
export function coincidenceGroups(sketch: SketchParams): Map<string, string> {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!;
    let c = x;
    while (parent.has(c) && parent.get(c) !== r) {
      const n = parent.get(c)!;
      parent.set(c, r);
      c = n;
    }
    return r;
  };
  parent.set(ORIGIN_POINT_ID, ORIGIN_POINT_ID);
  for (const e of sketch.entities) if (e.type === 'point') parent.set(e.id, e.id);
  for (const c of sketch.constraints) {
    if (c.type !== 'coincident') continue;
    const ra = find(c.a);
    const rb = find(c.b);
    if (ra !== rb) {
      // L'origine reste toujours représentante de son groupe.
      if (rb === ORIGIN_POINT_ID) parent.set(ra, rb);
      else parent.set(rb, ra);
    }
  }
  const out = new Map<string, string>();
  for (const id of parent.keys()) out.set(id, find(id));
  return out;
}

export function arePointsCoincident(sketch: SketchParams, a: string, b: string): boolean {
  if (a === b) return true;
  const groups = coincidenceGroups(sketch);
  return groups.get(a) !== undefined && groups.get(a) === groups.get(b);
}

/** Déplace des points (sans résolution) ; utilisé avant un appel au solveur. */
export function movePoints(sketch: SketchParams, moves: Map<string, Vec2>): SketchParams {
  return {
    ...sketch,
    entities: sketch.entities.map((e) => {
      if (e.type !== 'point') return e;
      const m = moves.get(e.id);
      return m ? { ...e, x: m.x, y: m.y } : e;
    }),
  };
}

export function setCircleRadius(sketch: SketchParams, circleId: string, radius: number): SketchParams {
  return {
    ...sketch,
    entities: sketch.entities.map((e) => (e.id === circleId && e.type === 'circle' ? { ...e, radius } : e)),
  };
}

/** Nombre de courbes (segments, cercles) : sert aux messages et aux tests. */
export function countCurves(sketch: SketchParams): { lines: number; circles: number; arcs: number } {
  let lines = 0;
  let circles = 0;
  let arcs = 0;
  for (const e of sketch.entities) {
    if (e.type === 'line') lines++;
    else if (e.type === 'circle') circles++;
    else if (e.type === 'arc') arcs++;
  }
  return { lines, circles, arcs };
}
