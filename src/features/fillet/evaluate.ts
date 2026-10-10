import type { FilletFeature } from '../../domain/model';
import { evaluateBlend } from '../blend-common';
import type { FeatureEvaluator } from '../evaluation';

export const evaluateFillet: FeatureEvaluator<FilletFeature> = (feature, ctx) => evaluateBlend(feature, ctx);
