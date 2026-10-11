import type { LoftFeature } from '../../domain/model';
import { issue, okStatus } from '../../domain/status';
import type { KernelShape } from '../../geometry/kernel';
import type { Frame3D } from '../../math/frame';
import type { ProfileLoop } from '../../sketch/profiles';
import type { FeatureEvaluator } from '../evaluation';
import { resolveProfile } from '../sketch/evaluate';
import { loftDefinition } from './definition';

export const evaluateLoft: FeatureEvaluator<LoftFeature> = (feature, ctx) => {
  const paramIssues = loftDefinition.validate(feature);
  if (paramIssues.length > 0) return { status: issue(feature.id, 'error', 'INVALID_PARAMETER', { message: paramIssues[0]!.message }) };
  const p = feature.params;
  if (p.operation === 'cut' && !ctx.shape) return { status: issue(feature.id, 'error', 'POCKET_WITHOUT_SOLID') };
  const sections: { frame: Frame3D; loop: ProfileLoop }[] = [];
  for (const sketchId of p.sketchIds) {
    const resolved = resolveProfile(feature.id, sketchId, ctx);
    if ('status' in resolved) return resolved;
    if (resolved.regions.length !== 1 || resolved.regions[0]!.holes.length > 0) return { status: issue(feature.id, 'error', 'LOFT_PROFILE', { relatedFeatureId: sketchId }) };
    sections.push({ frame: resolved.frame, loop: resolved.regions[0]!.outer });
  }
  const tool = ctx.kernel.makeLoft({ featureId: feature.id, sections, ruled: p.ruled });
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
  if (!analysis.valid || analysis.solidCount === 0) {
    if (shape !== tool) ctx.kernel.dispose(shape);
    return { status: issue(feature.id, 'error', 'INVALID_SOLID'), tool };
  }
  return { status: okStatus(feature.id), shape, analysis, tool, toolMode: p.operation === 'cut' ? 'cut' : 'add' };
};
