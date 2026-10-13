import type { HoleFeature } from '../../domain/model';
import { issue, okStatus } from '../../domain/status';
import type { KernelShape } from '../../geometry/kernel';
import { frameToWorld, type Frame3D } from '../../math/frame';
import { cross3, scale3, type Vec2 } from '../../math/vec';
import { pointPosition } from '../../sketch/model';
import type { ProfileRegion, ProfileSegment } from '../../sketch/profiles';
import type { FeatureEvaluator } from '../evaluation';
import { throughAllRange } from '../pocket/evaluate';
import { holeDefinition, holeDiameter } from './definition';

/**
 * Demi-profil du trou dans son plan (x : rayon, y : profondeur dans la matière), à faire tourner
 * autour de l'axe x = 0 : corps du trou, plus le lamage ou la fraisure à l'entrée.
 */
export function holeProfile(p: HoleFeature['params'], depth: number): Vec2[] {
  const r = holeDiameter(p) / 2;
  if (p.kind === 'counterbore') {
    const R = p.headDiameter / 2;
    const h = Math.min(p.headDepth, depth);
    return h >= depth ? [{ x: 0, y: 0 }, { x: R, y: 0 }, { x: R, y: depth }, { x: 0, y: depth }] : [{ x: 0, y: 0 }, { x: R, y: 0 }, { x: R, y: h }, { x: r, y: h }, { x: r, y: depth }, { x: 0, y: depth }];
  }
  if (p.kind === 'countersink') {
    const R = p.headDiameter / 2;
    // Cône à 90° : le rayon diminue d'autant que l'on descend.
    const cone = R - r;
    return cone >= depth
      ? [{ x: 0, y: 0 }, { x: R, y: 0 }, { x: R - depth, y: depth }, { x: 0, y: depth }]
      : [{ x: 0, y: 0 }, { x: R, y: 0 }, { x: r, y: cone }, { x: r, y: depth }, { x: 0, y: depth }];
  }
  return [{ x: 0, y: 0 }, { x: r, y: 0 }, { x: r, y: depth }, { x: 0, y: depth }];
}

/** Région fermée du profil ; chaque côté est étiqueté au nom du cercle (`c1:0`, `c1:1`…) pour les références des faces. */
function profileRegion(points: Vec2[], tag: string): ProfileRegion {
  const segments: ProfileSegment[] = points.map((start, i) => ({ kind: 'line', entityId: `${tag}:${i}`, start, end: points[(i + 1) % points.length]! }));
  let area = 0;
  points.forEach((a, i) => {
    const b = points[(i + 1) % points.length]!;
    area += a.x * b.y - b.x * a.y;
  });
  return { outer: { segments, signedArea: area / 2 }, holes: [], area: Math.abs(area / 2) };
}

export const evaluateHole: FeatureEvaluator<HoleFeature> = (feature, ctx) => {
  const paramIssues = holeDefinition.validate(feature);
  if (paramIssues.length > 0) return { status: issue(feature.id, 'error', 'INVALID_PARAMETER', { message: paramIssues[0]!.message }) };
  if (!ctx.shape || !ctx.shapeAnalysis?.bbox) return { status: issue(feature.id, 'error', 'HOLE_WITHOUT_SOLID') };
  const p = feature.params;
  const entry = ctx.sketches.get(p.sketchId);
  if (!entry) return { status: issue(feature.id, 'error', 'SKETCH_MISSING') };
  const frame = entry.evaluation.frame;
  if (entry.status.state === 'error' || entry.status.state === 'blocked' || !frame) {
    return { status: issue(feature.id, 'blocked', 'SKETCH_FAILED', { blockedBy: entry.status.blockedBy ?? p.sketchId, relatedFeatureId: p.sketchId }) };
  }
  const solved = entry.evaluation.solved;
  const centers = solved.entities.flatMap((e) => {
    if (e.type !== 'circle' || e.reference) return [];
    const c = pointPosition(solved, e.center);
    return c ? [{ id: e.id, at: c }] : [];
  });
  if (centers.length === 0) return { status: issue(feature.id, 'error', 'HOLE_NO_CENTER', { relatedFeatureId: p.sketchId }) };
  // Dans la matière : contre la normale de l'esquisse par défaut (comme une poche).
  const sign = p.reversed ? 1 : -1;
  const range = throughAllRange(p.reversed ? 'reversed' : 'default', frame, ctx.shapeAnalysis.bbox);
  const depth = p.through ? Math.abs(p.reversed ? range[1] : range[0]) : p.depth;
  const points = holeProfile(p, depth);
  const kernel = ctx.kernel;
  const tools: KernelShape[] = [];
  try {
    for (const c of centers) {
      // Plan du profil : rayon le long de l'axe X de l'esquisse, profondeur le long de l'axe du trou.
      const yAxis = scale3(frame.normal, sign);
      const local: Frame3D = { origin: frameToWorld(frame, c.at), xAxis: frame.xAxis, yAxis, normal: cross3(frame.xAxis, yAxis) };
      tools.push(kernel.makeRevolution({ featureId: feature.id, regions: [profileRegion(points, c.id)], frame: local, axisOrigin: { x: 0, y: 0 }, axisDirection: { x: 0, y: 1 }, angle: 2 * Math.PI }));
    }
  } catch (err) {
    tools.forEach((t) => kernel.dispose(t));
    throw err;
  }
  let tool: KernelShape;
  try {
    tool = tools.length === 1 ? tools[0]! : kernel.fuseMany(tools[0]!, tools.slice(1));
  } finally {
    if (tools.length > 1) tools.forEach((t) => kernel.dispose(t));
  }
  let shape: KernelShape;
  try {
    shape = kernel.cut(ctx.shape, tool);
  } catch (err) {
    kernel.dispose(tool);
    throw err;
  }
  const analysis = kernel.analyze(shape);
  const before = ctx.shapeAnalysis.volume;
  const tiny = Math.max(1e-9, before * 1e-9);
  if (analysis.solidCount === 0 || analysis.volume <= tiny) {
    kernel.dispose(shape);
    return { status: issue(feature.id, 'error', 'POCKET_REMOVES_EVERYTHING'), tool };
  }
  if (!analysis.valid) {
    kernel.dispose(shape);
    return { status: issue(feature.id, 'error', 'INVALID_SOLID'), tool };
  }
  const status = before - analysis.volume <= tiny ? issue(feature.id, 'warning', 'HOLE_REMOVES_NOTHING') : okStatus(feature.id);
  return { status, shape, analysis, tool, toolMode: 'cut' };
};
