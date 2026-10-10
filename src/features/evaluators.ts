/** Registre des évaluateurs géométriques (exécutés dans le worker de calcul ou dans les tests). */
import type { Feature, FeatureType } from '../domain/model';
import type { FeatureEvaluator } from './evaluation';
import { evaluateMirror } from './mirror/evaluate';
import { evaluateChamfer } from './chamfer/evaluate';
import { evaluateExtrude } from './extrude/evaluate';
import { evaluateFillet } from './fillet/evaluate';
import { evaluateImportedSolid } from './imported/evaluate';
import { evaluatePocket } from './pocket/evaluate';
import { evaluateRevolve } from './revolve/evaluate';
import { evaluatePattern } from './pattern/evaluate';
import { evaluateSketch } from './sketch/evaluate';

type Evaluators = { [T in FeatureType]: FeatureEvaluator<Extract<Feature, { type: T }>> };

export const FEATURE_EVALUATORS: Evaluators = {
  sketch: evaluateSketch,
  extrude: evaluateExtrude,
  pocket: evaluatePocket,
  revolve: evaluateRevolve,
  pattern: evaluatePattern,
  mirror: evaluateMirror,
  fillet: evaluateFillet,
  chamfer: evaluateChamfer,
  'imported-solid': evaluateImportedSolid,
};

export function evaluatorOf<F extends Feature>(feature: F): FeatureEvaluator<F> {
  return FEATURE_EVALUATORS[feature.type] as unknown as FeatureEvaluator<F>;
}
