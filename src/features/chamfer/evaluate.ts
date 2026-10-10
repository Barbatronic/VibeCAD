import type { ChamferFeature } from '../../domain/model';
import { evaluateBlend } from '../blend-common';
import type { FeatureEvaluator } from '../evaluation';

export const evaluateChamfer: FeatureEvaluator<ChamferFeature> = (feature, ctx) => evaluateBlend(feature, ctx);
