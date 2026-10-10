import type { PrimitiveFeature } from '../../domain/model';
import { issue, okStatus } from '../../domain/status';
import type { KernelShape } from '../../geometry/kernel';
import type { FeatureEvaluator } from '../evaluation';
import { primitiveDefinition } from './definition';

export const evaluatePrimitive: FeatureEvaluator<PrimitiveFeature> = (feature, ctx) => {
  const paramIssues = primitiveDefinition.validate(feature);
  if (paramIssues.length > 0) return { status: issue(feature.id, 'error', 'INVALID_PARAMETER', { message: paramIssues[0]!.message }) };
  const p = feature.params;
  if (p.operation === 'cut' && !ctx.shape) return { status: issue(feature.id, 'error', 'POCKET_WITHOUT_SOLID') };
  const tool = ctx.kernel.makePrimitive({ featureId: feature.id, ...p });
  let shape: KernelShape = tool;
  if (ctx.shape) {
    try {
      shape = p.operation === 'cut' ? ctx.kernel.cut(ctx.shape, tool) : ctx.kernel.fuse(ctx.shape, tool);
    } catch (err) {
      ctx.kernel.dispose(tool);
      throw err;
    }
  }
  const analysis = ctx.kernel.analyze(shape);
  if (!analysis.valid || (p.operation === 'add' && analysis.solidCount === 0)) {
    if (shape !== tool) ctx.kernel.dispose(shape);
    return { status: issue(feature.id, 'error', 'INVALID_SOLID'), tool };
  }
  const before = ctx.shapeAnalysis?.volume ?? 0;
  const tiny = Math.max(1e-9, before * 1e-9);
  if (p.operation === 'cut' && (analysis.solidCount === 0 || analysis.volume <= tiny)) {
    if (shape !== tool) ctx.kernel.dispose(shape);
    return { status: issue(feature.id, 'error', 'POCKET_REMOVES_EVERYTHING'), tool };
  }
  let status = okStatus(feature.id);
  if (p.operation === 'cut' && before - analysis.volume <= tiny) status = issue(feature.id, 'warning', 'POCKET_REMOVES_NOTHING');
  else if (p.operation === 'add' && ctx.shapeAnalysis && analysis.solidCount > ctx.shapeAnalysis.solidCount) status = issue(feature.id, 'warning', 'DISJOINT_SOLID');
  return { status, shape, analysis, tool, toolMode: p.operation === 'cut' ? 'cut' : 'add' };
};
