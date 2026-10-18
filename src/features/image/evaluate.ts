import type { ImageFeature } from '../../domain/model';
import { issue, okStatus } from '../../domain/status';
import type { FeatureEvaluator } from '../evaluation';
import { resolveSupportFrame } from '../sketch/evaluate';

/** Image de référence : seul le repère de son support est calculé (l'image est affichée par l'interface). */
export const evaluateImage: FeatureEvaluator<ImageFeature> = (feature, ctx) => {
  const r = resolveSupportFrame(feature.params.support, ctx);
  if ('code' in r) return { status: issue(feature.id, 'error', r.code) };
  return { status: okStatus(feature.id), imageFrame: r.frame };
};
