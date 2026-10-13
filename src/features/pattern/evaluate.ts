import type { PatternAxis, PatternFeature } from '../../domain/model';
import { issue, okStatus, type FeatureStatus } from '../../domain/status';
import type { GeometryKernel, KernelShape } from '../../geometry/kernel';
import { frameFromAxis, frameMatrix4, invertRigid4, multiply4, rotationZ4, translation4, type Mat4 } from '../../math/mat4';
import { normalize3, scale3, sub3, type Vec3 } from '../../math/vec';
import type { FeatureEvaluator } from '../evaluation';
import { patternDefinition } from './definition';

const WORLD: Record<'X' | 'Y' | 'Z', Vec3> = { X: { x: 1, y: 0, z: 0 }, Y: { x: 0, y: 1, z: 0 }, Z: { x: 0, y: 0, z: 1 } };

/** Droite d'une direction de répétition : point de passage et direction unitaire (null : arête inutilisable). */
export type AxisLine = { point: Vec3; dir: Vec3 } | { error: 'EDGE_LOST' | 'PATTERN_AXIS_INVALID' | 'AXIS_LOST' };

/**
 * Direction orientée de façon stable (le sens d'une arête dépend du calcul) : sa plus grande
 * composante est rendue positive, pour que « +X, +Y, +Z » reste le sens par défaut.
 */
function canonical(d: Vec3): Vec3 {
  const n = normalize3(d);
  const big = [n.x, n.y, n.z].reduce((a, b) => (Math.abs(b) > Math.abs(a) + 1e-9 ? b : a));
  return big < 0 ? scale3(n, -1) : n;
}

export function resolvePatternAxis(kernel: GeometryKernel, shape: KernelShape | null, axis: PatternAxis, axes: ReadonlyMap<string, { point: Vec3; dir: Vec3 }> = new Map()): AxisLine {
  if (axis.kind === 'axis') return { point: { x: 0, y: 0, z: 0 }, dir: WORLD[axis.axis] };
  if (axis.kind === 'datum') return axes.get(axis.featureId) ?? { error: 'AXIS_LOST' };
  if (!shape) return { error: 'EDGE_LOST' };
  const curves = kernel.edgeCurves(shape, axis.edge);
  const c = curves[0];
  if (!c) return { error: 'EDGE_LOST' };
  if (c.kind === 'line') {
    const d = sub3(c.end, c.start);
    if (Math.hypot(d.x, d.y, d.z) < 1e-9) return { error: 'PATTERN_AXIS_INVALID' };
    return { point: c.start, dir: canonical(d) };
  }
  if (c.kind === 'circle') return { point: c.center, dir: canonical(c.axis) };
  return { error: 'PATTERN_AXIS_INVALID' };
}

/**
 * Placements des copies (l'original, à l'identité, n'est pas compris), dans l'ordre des numéros
 * de copie : en grille, la copie (i, j) porte le numéro i + j × count.
 */
export function patternMatrices(
  p: Pick<PatternFeature['params'], 'kind' | 'count' | 'spacing' | 'angle' | 'reversed'> & { second?: { count: number; spacing: number; reversed: boolean } },
  first: { point: Vec3; dir: Vec3 },
  second?: { point: Vec3; dir: Vec3 },
): { index: number; matrix: Mat4 }[] {
  const out: { index: number; matrix: Mat4 }[] = [];
  if (p.kind === 'circular') {
    const step = ((p.angle >= 360 ? 360 / p.count : p.angle / (p.count - 1)) * Math.PI) / 180;
    const frame = frameMatrix4(frameFromAxis(first.point, first.dir));
    const back = invertRigid4(frame);
    for (let k = 1; k < p.count; k++) {
      const a = (p.reversed ? -1 : 1) * step * k;
      out.push({ index: k, matrix: multiply4(frame, multiply4(rotationZ4(a), back)) });
    }
    return out;
  }
  const d1 = scale3(first.dir, (p.reversed ? -1 : 1) * p.spacing);
  const n2 = p.second && second ? p.second.count : 1;
  const d2 = p.second && second ? scale3(second.dir, (p.second.reversed ? -1 : 1) * p.second.spacing) : { x: 0, y: 0, z: 0 };
  for (let j = 0; j < n2; j++) {
    for (let i = 0; i < p.count; i++) {
      if (i === 0 && j === 0) continue;
      out.push({ index: i + j * p.count, matrix: translation4({ x: d1.x * i + d2.x * j, y: d1.y * i + d2.y * j, z: d1.z * i + d2.z * j }) });
    }
  }
  return out;
}

export const evaluatePattern: FeatureEvaluator<PatternFeature> = (feature, ctx) => {
  const paramIssues = patternDefinition.validate(feature);
  if (paramIssues.length > 0) return { status: issue(feature.id, 'error', 'INVALID_PARAMETER', { message: paramIssues[0]!.message }) };
  if (!ctx.shape || !ctx.shapeAnalysis) return { status: issue(feature.id, 'error', 'PATTERN_SOURCE_MISSING') };
  const source = ctx.tools.get(feature.params.sourceId);
  if (!source) return { status: issue(feature.id, 'error', 'PATTERN_SOURCE_MISSING', { relatedFeatureId: feature.params.sourceId }) };
  const p = feature.params;
  const first = resolvePatternAxis(ctx.kernel, ctx.shape, p.axis, ctx.axes);
  if ('error' in first) return { status: issue(feature.id, 'error', first.error) };
  let second: { point: Vec3; dir: Vec3 } | undefined;
  if (p.kind === 'linear' && p.second) {
    const s = resolvePatternAxis(ctx.kernel, ctx.shape, p.second.axis, ctx.axes);
    if ('error' in s) return { status: issue(feature.id, 'error', s.error) };
    second = s;
  }
  const placements = patternMatrices(p, first, second);
  const kernel = ctx.kernel;
  // Tous les exemplaires en une seule opération booléenne (une suite d'opérations, chacune contre
  // une pièce de plus en plus chargée, coûtait plusieurs centaines de ms pour une grille).
  const copies = placements.map(({ index, matrix }) => kernel.transformed(source.shape, matrix, { featureId: feature.id, index }));
  // Exemplaire hors de la pièce : sa boîte englobante ne touche pas celle de la pièce.
  const box = ctx.shapeAnalysis.bbox;
  const outside =
    source.mode === 'cut' && box
      ? copies.filter((c) => {
          const b = kernel.analyze(c).bbox;
          return !b || b.max.x < box.min.x || b.min.x > box.max.x || b.max.y < box.min.y || b.min.y > box.max.y || b.max.z < box.min.z || b.min.z > box.max.z;
        }).length
      : 0;
  let shape: KernelShape;
  try {
    shape = source.mode === 'add' ? kernel.fuseMany(ctx.shape, copies) : kernel.cutMany(ctx.shape, copies);
  } finally {
    copies.forEach((c) => kernel.dispose(c));
  }
  const analysis = kernel.analyze(shape);
  if (!analysis.valid || analysis.solidCount === 0) {
    if (shape !== ctx.shape) kernel.dispose(shape);
    return { status: issue(feature.id, 'error', 'INVALID_SOLID') };
  }
  let status: FeatureStatus = okStatus(feature.id);
  if (outside > 0) status = issue(feature.id, 'warning', 'PATTERN_COPIES_OUTSIDE');
  else if (source.mode === 'add' && analysis.solidCount > ctx.shapeAnalysis.solidCount) status = issue(feature.id, 'warning', 'DISJOINT_SOLID');
  return { status, shape, analysis };
};
