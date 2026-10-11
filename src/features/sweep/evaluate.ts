import type { SweepFeature } from '../../domain/model';
import { issue, okStatus } from '../../domain/status';
import type { KernelShape } from '../../geometry/kernel';
import { extractPath, PATH_MESSAGES } from '../../sketch/path';
import type { FeatureEvaluator } from '../evaluation';
import { resolveProfile } from '../sketch/evaluate';
import { sweepDefinition } from './definition';

export const evaluateSweep: FeatureEvaluator<SweepFeature> = (feature, ctx) => {
  const paramIssues = sweepDefinition.validate(feature);
  if (paramIssues.length > 0) return { status: issue(feature.id, 'error', 'INVALID_PARAMETER', { message: paramIssues[0]!.message }) };
  const p = feature.params;
  if (p.operation === 'cut' && !ctx.shape) return { status: issue(feature.id, 'error', 'POCKET_WITHOUT_SOLID') };
  const profile = resolveProfile(feature.id, p.profileId, ctx);
  if ('status' in profile) return profile;
  if (profile.regions.length !== 1) {
    return { status: issue(feature.id, 'error', 'INVALID_PARAMETER', { message: 'Le profil doit être un seul contour fermé (des trous sont permis).', relatedFeatureId: p.profileId }) };
  }
  const pathSketch = ctx.sketches.get(p.pathId);
  if (!pathSketch) return { status: issue(feature.id, 'error', 'SKETCH_MISSING') };
  if (!pathSketch.evaluation.frame || pathSketch.status.state === 'error' || pathSketch.status.state === 'blocked') {
    return { status: issue(feature.id, 'blocked', 'SKETCH_FAILED', { blockedBy: pathSketch.status.blockedBy ?? p.pathId, relatedFeatureId: p.pathId }) };
  }
  const path = extractPath(pathSketch.evaluation.solved);
  if (!path.ok) return { status: issue(feature.id, 'error', 'INVALID_PARAMETER', { message: PATH_MESSAGES[path.reason], relatedFeatureId: p.pathId }) };
  const tool = ctx.kernel.makeSweep({
    featureId: feature.id,
    profile: { frame: profile.frame, region: profile.regions[0]! },
    path: { frame: pathSketch.evaluation.frame, segments: path.segments },
  });
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
