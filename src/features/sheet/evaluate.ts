import type { SheetFeature } from '../../domain/model';
import { issue, okStatus } from '../../domain/status';
import { scale3, sub3 } from '../../math/vec';
import type { FeatureEvaluator } from '../evaluation';
import { resolveProfile } from '../sketch/evaluate';
import { sheetDefinition } from './definition';
import { bendWarning } from './limits';

/** Tôle : le contour de l'esquisse, d'une épaisseur ; la pièce garde sa tôle à plat pour les plis. */
export const evaluateSheet: FeatureEvaluator<SheetFeature> = (feature, ctx) => {
  const paramIssues = sheetDefinition.validate(feature);
  if (paramIssues.length > 0) return { status: issue(feature.id, 'error', 'INVALID_PARAMETER', { message: paramIssues[0]!.message }) };
  if (ctx.sheet || ctx.shape) return { status: issue(feature.id, 'error', 'SHEET_ALREADY') };
  const resolved = resolveProfile(feature.id, feature.params.sketchId, ctx);
  if ('status' in resolved) return resolved;
  const { thickness: t, reversed, materialId, radius } = feature.params;
  const shape = ctx.kernel.makePrism({ featureId: feature.id, regions: resolved.regions, frame: resolved.frame, from: reversed ? -t : 0, to: reversed ? 0 : t });
  const analysis = ctx.kernel.analyze(shape);
  // Repère de la tôle : elle occupe 0 → t le long de sa normale.
  const frame = reversed ? { ...resolved.frame, origin: sub3(resolved.frame.origin, scale3(resolved.frame.normal, t)) } : resolved.frame;
  const warning = bendWarning(materialId, t, radius, 90);
  return {
    status: warning ? issue(feature.id, 'warning', 'SHEET_BEND_LIMIT', { message: warning }) : okStatus(feature.id),
    shape,
    analysis,
    tool: shape,
    toolMode: 'add',
    sheet: { baseId: feature.id, frame, thickness: t, materialId, radius, flat: shape, folds: [], later: [] },
  };
};
