import type { ExtentDirection, ExtrudeFeature } from '../../domain/model';
import { issue, okStatus } from '../../domain/status';
import type { KernelShape } from '../../geometry/kernel';
import type { FeatureEvaluator } from '../evaluation';
import { resolveProfile } from '../sketch/evaluate';
import { extrudeDefinition } from './definition';

/** Intervalle le long de la normale de l'esquisse pour une extrusion de longueur `d`. */
export function extrudeRange(direction: ExtentDirection, d: number): [number, number] {
  if (direction === 'reversed') return [-d, 0];
  if (direction === 'symmetric') return [-d / 2, d / 2];
  return [0, d];
}

export const evaluateExtrude: FeatureEvaluator<ExtrudeFeature> = (feature, ctx) => {
  const paramIssues = extrudeDefinition.validate(feature);
  if (paramIssues.length > 0) return { status: issue(feature.id, 'error', 'INVALID_PARAMETER', { message: paramIssues[0]!.message }) };
  const resolved = resolveProfile(feature.id, feature.params.sketchId, ctx);
  if ('status' in resolved) return resolved;
  const [from, to] = extrudeRange(feature.params.direction, feature.params.distance);
  const tool = ctx.kernel.makePrism({ featureId: feature.id, regions: resolved.regions, frame: resolved.frame, from, to });
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
