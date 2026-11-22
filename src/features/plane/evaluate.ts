import type { DatumPoint, EdgeRef, Id, PlaneFeature } from '../../domain/model';
import { issue, okStatus } from '../../domain/status';
import { canonicalFrame, offsetFrame, type Frame3D } from '../../math/frame';
import { add3, cross3, dot3, normalize3, scale3, sub3, type Vec3 } from '../../math/vec';
import type { EvaluationContext, FeatureEvaluator } from '../evaluation';
import { resolvePatternAxis } from '../pattern/evaluate';
import { planeDefinition } from './definition';
import { planeDependency, resolvePlaneRef } from './resolve';

/** Rotation d'un vecteur autour de la direction unitaire `k` (formule de Rodrigues). */
function rotateVector(v: Vec3, k: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return add3(add3(scale3(v, c), scale3(cross3(k, v), s)), scale3(k, dot3(k, v) * (1 - c)));
}

/** Repère tourné de `angle` radians autour de la droite (point, direction unitaire). */
export function rotateFrame(frame: Frame3D, point: Vec3, dir: Vec3, angle: number): Frame3D {
  return {
    origin: add3(point, rotateVector(sub3(frame.origin, point), dir, angle)),
    xAxis: rotateVector(frame.xAxis, dir, angle),
    yAxis: rotateVector(frame.yAxis, dir, angle),
    normal: rotateVector(frame.normal, dir, angle),
  };
}

type Lost = { lost: Id | null };
type Solved = { frame: Frame3D } | Lost | { invalid: string };

/** Point désigné : l'origine, ou un bout, le milieu ou le centre d'une arête de la pièce. */
export function resolveDatumPoint(pt: DatumPoint, ctx: Pick<EvaluationContext, 'kernel' | 'shape'>): Vec3 | null {
  if (pt.kind === 'origin') return { x: 0, y: 0, z: 0 };
  if (!ctx.shape) return null;
  const c = ctx.kernel.edgeCurves(ctx.shape, pt.edge)[0];
  if (!c) return null;
  if (c.kind === 'line') return pt.at === 'start' ? c.start : pt.at === 'end' ? c.end : scale3(add3(c.start, c.end), 0.5);
  if (c.kind === 'circle') {
    if (pt.at === 'center') return c.center;
    if (pt.at === 'mid') return c.mid ?? c.center;
    return (pt.at === 'start' ? c.start : c.end) ?? c.center;
  }
  const s = c.samples ?? [];
  if (s.length === 0) return c.mid ?? null;
  return pt.at === 'start' ? s[0]! : pt.at === 'end' ? s[s.length - 1]! : (c.mid ?? s[Math.floor(s.length / 2)]!);
}

/** Repère d'origine `origin`, de normale `normal`, d'axe X le long de `x` (projeté dans le plan). */
function frameFrom(origin: Vec3, normal: Vec3, x?: Vec3): Frame3D {
  const n = normalize3(normal);
  if (!x) return canonicalFrame(origin, n);
  const xp = sub3(x, scale3(n, dot3(x, n)));
  if (Math.hypot(xp.x, xp.y, xp.z) < 1e-9) return canonicalFrame(origin, n);
  const xAxis = normalize3(xp);
  return { origin, xAxis, yAxis: normalize3(cross3(n, xAxis)), normal: n };
}

const len = (v: Vec3) => Math.hypot(v.x, v.y, v.z);
const edgeFeature = (e: EdgeRef | undefined) => e?.faces[0].featureId ?? null;

/** Plan obtenu selon la façon de le construire (avant le décalage final). */
function solvePlane(p: PlaneFeature['params'], ctx: Parameters<FeatureEvaluator<PlaneFeature>>[1]): Solved {
  const mode = p.mode ?? 'offset';
  const point = (i: number): Vec3 | Lost => {
    const pt = p.points?.[i];
    if (!pt) return { lost: null };
    return resolveDatumPoint(pt, ctx) ?? { lost: pt.kind === 'edge' ? pt.edge.faces[0].featureId : null };
  };
  const isLost = (x: Vec3 | Lost): x is Lost => 'lost' in x;
  if (mode === 'offset') {
    const base = resolvePlaneRef(p.base, ctx);
    if (!base.ok) return { lost: base.relatedFeatureId };
    const frame = base.frame;
    if (p.angle !== 0) {
      const line = resolvePatternAxis(ctx.kernel, ctx.shape, p.hinge, ctx.axes);
      if ('error' in line) return { lost: p.hinge.kind === 'edge' ? p.hinge.edge.faces[0].featureId : p.hinge.kind === 'datum' ? p.hinge.featureId : null };
      // Le décalage se fait avant l'inclinaison (comportement d'origine).
      return { frame: rotateFrame(offsetFrame(frame, p.offset), line.point, line.dir, (p.angle * Math.PI) / 180) };
    }
    return { frame };
  }
  if (mode === 'midplane' || mode === 'parallelPoint') {
    const a = resolvePlaneRef(p.base, ctx);
    if (!a.ok) return { lost: a.relatedFeatureId };
    if (mode === 'parallelPoint') {
      const q = point(0);
      if (isLost(q)) return q.lost ? q : { invalid: 'Choisissez le point par lequel passe le plan.' };
      return { frame: { ...a.frame, origin: q } };
    }
    if (!p.second) return { invalid: 'Choisissez le second plan ou la seconde face.' };
    const b = resolvePlaneRef(p.second, ctx);
    if (!b.ok) return { lost: b.relatedFeatureId };
    const [n1, o1, o2] = [a.frame.normal, a.frame.origin, b.frame.origin];
    // Normales dans le même sens (deux faces opposées ont des normales contraires).
    const n2 = dot3(n1, b.frame.normal) < 0 ? scale3(b.frame.normal, -1) : b.frame.normal;
    if (len(cross3(n1, n2)) < 1e-6) {
      // Parallèles : à mi-distance.
      const foot = sub3(o1, scale3(n1, dot3(sub3(o1, o2), n1)));
      return { frame: { ...a.frame, origin: scale3(add3(o1, foot), 0.5) } };
    }
    // Sécants : le plan bissecteur, qui contient leur droite d'intersection.
    const d = cross3(n1, n2);
    const [h1, h2] = [dot3(n1, o1), dot3(b.frame.normal, o2)];
    const nb = b.frame.normal;
    const dd = cross3(n1, nb);
    const onBoth = scale3(add3(scale3(cross3(nb, dd), h1), scale3(cross3(dd, n1), h2)), 1 / dot3(dd, dd));
    return { frame: frameFrom(onBoth, add3(n1, n2), d) };
  }
  if (mode === 'threePoints') {
    const [a, b, c] = [point(0), point(1), point(2)];
    for (const q of [a, b, c]) if (isLost(q)) return q.lost ? q : { invalid: 'Choisissez trois points.' };
    const [pa, pb, pc] = [a, b, c] as Vec3[];
    const n = cross3(sub3(pb!, pa!), sub3(pc!, pa!));
    if (len(n) < 1e-9) return { invalid: 'Les trois points sont alignés (ou confondus) : ils ne définissent pas un plan.' };
    return { frame: frameFrom(pa!, n, sub3(pb!, pa!)) };
  }
  if (!p.edge || !ctx.shape) return { invalid: 'Choisissez une arête.' };
  const c = ctx.kernel.edgeCurves(ctx.shape, p.edge)[0];
  if (!c) return { lost: edgeFeature(p.edge) };
  if (mode === 'normalToEdge') {
    const t = Math.min(1, Math.max(0, p.along ?? 0));
    if (c.kind === 'line') {
      const dir = sub3(c.end, c.start);
      return { frame: canonicalFrame(add3(c.start, scale3(dir, t)), dir) };
    }
    const s = c.kind === 'circle' || c.kind === 'other' ? (c.samples ?? []) : [];
    if (s.length < 2) return { invalid: 'Cette arête ne permet pas de placer un plan perpendiculaire.' };
    const k = Math.min(s.length - 2, Math.floor(t * (s.length - 1)));
    const f = t * (s.length - 1) - k;
    const at = add3(s[k]!, scale3(sub3(s[k + 1]!, s[k]!), f));
    return { frame: canonicalFrame(at, sub3(s[k + 1]!, s[k]!)) };
  }
  if (mode === 'tangent') {
    if (c.kind !== 'circle') return { invalid: 'Choisissez le bord rond d’un cylindre ou d’un trou.' };
    // Direction de référence (angle 0) : la plus proche de X dans le plan du cercle, sinon de Y.
    const axis = normalize3(c.axis);
    const ref = Math.abs(axis.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
    const e1 = normalize3(sub3(ref, scale3(axis, dot3(ref, axis))));
    const radial = rotateVector(e1, axis, (p.angle * Math.PI) / 180);
    return { frame: frameFrom(add3(c.center, scale3(radial, c.radius)), radial, axis) };
  }
  // Arête et point : le plan contient l'arête droite et passe par le point.
  if (c.kind !== 'line') return { invalid: 'Choisissez une arête droite.' };
  const q = point(0);
  if (isLost(q)) return q.lost ? q : { invalid: 'Choisissez le point par lequel passe le plan.' };
  const dir = sub3(c.end, c.start);
  const n = cross3(dir, sub3(q, c.start));
  if (len(n) < 1e-9) return { invalid: 'Le point est sur la droite de l’arête : ils ne définissent pas un plan.' };
  return { frame: frameFrom(c.start, n, dir) };
}

export const evaluatePlane: FeatureEvaluator<PlaneFeature> = (feature, ctx) => {
  const paramIssues = planeDefinition.validate(feature);
  if (paramIssues.length > 0) return { status: issue(feature.id, 'error', 'INVALID_PARAMETER', { message: paramIssues[0]!.message }) };
  const p = feature.params;
  const r = solvePlane(p, ctx);
  if ('invalid' in r) return { status: issue(feature.id, 'error', 'INVALID_PARAMETER', { message: r.invalid }) };
  if ('lost' in r) return { status: issue(feature.id, 'error', (p.mode ?? 'offset') === 'offset' && p.angle !== 0 && r.lost !== null && r.lost !== planeDependency(p.base)[0] ? 'PLANE_HINGE_LOST' : 'PLANE_BASE_LOST', r.lost ? { relatedFeatureId: r.lost } : {}) };
  // Plan décalé et incliné : le décalage est déjà fait (avant l'inclinaison) ; sinon, le long de la normale.
  const tilted = (p.mode ?? 'offset') === 'offset' && p.angle !== 0;
  return { status: okStatus(feature.id), datum: tilted ? r.frame : offsetFrame(r.frame, p.offset) };
};
