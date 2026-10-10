import type { ShellFeature } from '../../domain/model';
import { issue, okStatus } from '../../domain/status';
import type { FeatureEvaluator } from '../evaluation';
import { shellDefinition } from './definition';

export const evaluateShell: FeatureEvaluator<ShellFeature> = (feature, ctx) => {
  const paramIssues = shellDefinition.validate(feature);
  if (paramIssues.length > 0) return { status: issue(feature.id, 'error', 'INVALID_PARAMETER', { message: paramIssues[0]!.message }) };
  if (!ctx.shape || !ctx.shapeAnalysis) return { status: issue(feature.id, 'error', 'INVALID_PARAMETER', { message: 'Il faut d’abord un volume à vider.' }) };
  const r = ctx.kernel.shell(ctx.shape, { featureId: feature.id, open: feature.params.open, thickness: feature.params.thickness, outward: feature.params.outward });
  if (r.status === 'faces-lost') return { status: issue(feature.id, 'error', 'SHELL_FACE_LOST') };
  if (r.status === 'failed') return { status: issue(feature.id, 'error', 'SHELL_FAILED', { detail: r.detail }) };
  const analysis = ctx.kernel.analyze(r.shape);
  if (!analysis.valid || analysis.solidCount === 0) {
    ctx.kernel.dispose(r.shape);
    return { status: issue(feature.id, 'error', 'SHELL_FAILED') };
  }
  return { status: okStatus(feature.id), shape: r.shape, analysis };
};
