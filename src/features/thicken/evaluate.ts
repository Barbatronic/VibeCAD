import type { ThickenFeature } from '../../domain/model';
import { issue, okStatus } from '../../domain/status';
import type { FeatureEvaluator } from '../evaluation';
import { thickenDefinition } from './definition';

export const evaluateThicken: FeatureEvaluator<ThickenFeature> = (feature, ctx) => {
  const paramIssues = thickenDefinition.validate(feature);
  if (paramIssues.length > 0) return { status: issue(feature.id, 'error', 'INVALID_PARAMETER', { message: paramIssues[0]!.message }) };
  if (!ctx.shape || !ctx.shapeAnalysis) return { status: issue(feature.id, 'error', 'INVALID_PARAMETER', { message: 'Il faut d’abord un volume.' }) };
  const r = ctx.kernel.thicken(ctx.shape, { featureId: feature.id, distance: feature.params.distance, corners: feature.params.corners });
  if (r.status === 'failed') return { status: issue(feature.id, 'error', 'THICKEN_FAILED', { detail: r.detail }) };
  const analysis = ctx.kernel.analyze(r.shape);
  // Amincie, la pièce doit perdre du volume ; grossie, en gagner (sinon le moteur a échoué).
  const grew = analysis.volume > ctx.shapeAnalysis.volume;
  if (!analysis.valid || analysis.solidCount === 0 || analysis.volume <= 0 || grew !== feature.params.distance > 0) {
    ctx.kernel.dispose(r.shape);
    return { status: issue(feature.id, 'error', 'THICKEN_FAILED') };
  }
  return { status: okStatus(feature.id), shape: r.shape, analysis };
};
