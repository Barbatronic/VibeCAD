import type { ExtentDirection, ExtrudeFeature } from '../../domain/model';
import { issue, okStatus, type FeatureStatus } from '../../domain/status';
import { TOLERANCES } from '../../domain/tolerances';
import type { KernelShape } from '../../geometry/kernel';
import type { Frame3D } from '../../math/frame';
import { dot3, scale3, sub3 } from '../../math/vec';
import type { ProfileRegion } from '../../sketch/profiles';
import type { EvaluationContext, FeatureEvaluator } from '../evaluation';
import { halfSpace } from '../half-space';
import { resolveProfile } from '../sketch/evaluate';
import { extrudeDefinition } from './definition';

/** Intervalle le long de la normale de l'esquisse pour une extrusion de longueur `d`. */
export function extrudeRange(direction: ExtentDirection, d: number, d2 = 0): [number, number] {
  if (direction === 'reversed') return [-d, 0];
  if (direction === 'twoSides') return [-d2, d];
  if (direction === 'symmetric') return [-d / 2, d / 2];
  return [0, d];
}

/**
 * Extrusion jusqu'au plan d'une face : le profil est extrudé assez loin vers la face, puis coupé
 * par le demi-espace situé au-delà de son plan. La face d'arrivée (rôle `end`) vient de ce
 * demi-espace, au nom de l'extrusion, comme pour une extrusion d'une longueur.
 */
function extrudeUpTo(feature: ExtrudeFeature, resolved: { regions: ProfileRegion[]; frame: Frame3D }, ctx: EvaluationContext): { tool: KernelShape } | { status: FeatureStatus } {
  const ref = feature.params.upTo!;
  const found = ctx.shape ? ctx.kernel.findFacePlane(ctx.shape, ref) : ({ status: 'lost' } as const);
  if (found.status !== 'found') return { status: issue(feature.id, 'error', 'EXTRUDE_FACE_LOST', { relatedFeatureId: ref.featureId }) };
  const { frame } = resolved;
  // Distance, le long de la normale de l'esquisse, entre son origine et le plan de la face.
  const cos = dot3(frame.normal, found.normal);
  if (Math.abs(cos) < 1e-6) return { status: issue(feature.id, 'error', 'EXTRUDE_FACE_PARALLEL', { relatedFeatureId: ref.featureId }) };
  const t = dot3(sub3(found.origin, frame.origin), found.normal) / cos;
  if (Math.abs(t) < TOLERANCES.minLength) return { status: issue(feature.id, 'error', 'EXTRUDE_FACE_MISSED', { relatedFeatureId: ref.featureId }) };
  const sign = Math.sign(t);
  const bbox = ctx.shapeAnalysis?.bbox;
  const diag = bbox ? Math.hypot(bbox.max.x - bbox.min.x, bbox.max.y - bbox.min.y, bbox.max.z - bbox.min.z) : 0;
  // Assez loin pour dépasser le plan partout sous le profil, même s'il est incliné.
  const far = Math.abs(t) + 10 * (diag + 10);
  const prism = ctx.kernel.makePrism({ featureId: feature.id, regions: resolved.regions, frame, from: sign > 0 ? 0 : -far, to: sign > 0 ? far : 0 });
  // Normale du plan tournée vers l'esquisse ; le demi-espace retiré est de l'autre côté (au-delà
  // de la face), et sa face posée sur le plan a le rôle `end`.
  const towardSketch = cos * sign > 0 ? scale3(found.normal, -1) : found.normal;
  const beyond = halfSpace(ctx.kernel, feature.id, found.origin, towardSketch, 4 * far, 'opposite');
  let tool: KernelShape;
  try {
    tool = ctx.kernel.cut(prism, beyond);
  } finally {
    ctx.kernel.dispose(prism);
    ctx.kernel.dispose(beyond);
  }
  if (ctx.kernel.analyze(tool).solidCount === 0) {
    ctx.kernel.dispose(tool);
    return { status: issue(feature.id, 'error', 'EXTRUDE_FACE_MISSED', { relatedFeatureId: ref.featureId }) };
  }
  return { tool };
}

export const evaluateExtrude: FeatureEvaluator<ExtrudeFeature> = (feature, ctx) => {
  const paramIssues = extrudeDefinition.validate(feature);
  if (paramIssues.length > 0) return { status: issue(feature.id, 'error', 'INVALID_PARAMETER', { message: paramIssues[0]!.message }) };
  const resolved = resolveProfile(feature.id, feature.params.sketchId, ctx);
  if ('status' in resolved) return resolved;
  let tool: KernelShape;
  if (feature.params.upTo) {
    const up = extrudeUpTo(feature, resolved, ctx);
    if ('status' in up) return up;
    tool = up.tool;
  } else {
    const [from, to] = extrudeRange(feature.params.direction, feature.params.distance, feature.params.distance2 ?? 0);
    tool = ctx.kernel.makePrism({ featureId: feature.id, regions: resolved.regions, frame: resolved.frame, from, to });
  }
  let shape: KernelShape = tool;
  if (ctx.shape) {
    try {
      shape = ctx.kernel.fuse(ctx.shape, tool);
    } catch (err) {
      ctx.kernel.dispose(tool);
      throw err;
    }
  }
  const analysis = ctx.kernel.analyze(shape);
  if (!analysis.valid || analysis.solidCount === 0) {
    if (shape !== tool) ctx.kernel.dispose(shape);
    return { status: issue(feature.id, 'error', 'INVALID_SOLID'), tool };
  }
  const status =
    ctx.shapeAnalysis && analysis.solidCount > ctx.shapeAnalysis.solidCount
      ? issue(feature.id, 'warning', 'DISJOINT_SOLID')
      : okStatus(feature.id);
  return { status, shape, analysis, tool, toolMode: 'add' };
};
