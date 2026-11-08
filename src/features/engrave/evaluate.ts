import type { EngraveFeature } from '../../domain/model';
import { issue, okStatus } from '../../domain/status';
import type { FeatureEvaluator } from '../evaluation';
import { resolveProfile } from '../sketch/evaluate';
import { engraveDefinition } from './definition';

/** Épaisseur du prisme dont la face d'arrivée, posée sur la face, sert à la découper. */
const MARK_LAYER = 0.05;

/**
 * Marquage de surface : la face est découpée selon le dessin, sans changer le volume. La zone marquée
 * devient une face à part, à fleur, qui peut prendre une autre couleur en impression 3D. Si le noyau
 * n'y arrive pas, la pièce reste telle quelle (le marquage reste dessiné).
 */
function markOnFace(feature: EngraveFeature, resolved: Exclude<ReturnType<typeof resolveProfile>, { status: unknown }>, ctx: Parameters<FeatureEvaluator<EngraveFeature>>[1]) {
  const base = ctx.shape!;
  const layer = ctx.kernel.makePrism({ featureId: feature.id, regions: resolved.regions, frame: resolved.frame, from: -MARK_LAYER, to: 0 });
  let shape;
  try {
    shape = ctx.kernel.imprint(base, layer);
  } catch {
    return { status: okStatus(feature.id) };
  } finally {
    ctx.kernel.dispose(layer);
  }
  const analysis = ctx.kernel.analyze(shape);
  const before = ctx.shapeAnalysis!.volume;
  if (!analysis.valid || analysis.solidCount !== ctx.shapeAnalysis!.solidCount || Math.abs(analysis.volume - before) > Math.max(1e-6, before * 1e-6)) {
    ctx.kernel.dispose(shape);
    return { status: okStatus(feature.id) };
  }
  return { status: okStatus(feature.id), shape, analysis };
}

/**
 * Gravure : un marquage de surface découpe seulement la face (le volume ne change pas) ; avec une
 * profondeur, le dessin est creusé dans la matière, contre la normale de l'esquisse.
 */
export const evaluateEngrave: FeatureEvaluator<EngraveFeature> = (feature, ctx) => {
  const paramIssues = engraveDefinition.validate(feature);
  if (paramIssues.length > 0) return { status: issue(feature.id, 'error', 'INVALID_PARAMETER', { message: paramIssues[0]!.message }) };
  if (!ctx.shape || !ctx.shapeAnalysis) return { status: issue(feature.id, 'error', 'ENGRAVE_WITHOUT_SOLID') };
  const resolved = resolveProfile(feature.id, feature.params.sketchId, ctx);
  if ('status' in resolved) return resolved;
  if (feature.params.depth <= 0) return markOnFace(feature, resolved, ctx);
  const tool = ctx.kernel.makePrism({ featureId: feature.id, regions: resolved.regions, frame: resolved.frame, from: -feature.params.depth, to: 0 });
  let shape;
  try {
    shape = ctx.kernel.cut(ctx.shape, tool);
  } catch (err) {
    ctx.kernel.dispose(tool);
    throw err;
  }
  const analysis = ctx.kernel.analyze(shape);
  if (analysis.solidCount === 0 || !analysis.valid) {
    ctx.kernel.dispose(shape);
    return { status: issue(feature.id, 'error', 'INVALID_SOLID'), tool };
  }
  return { status: okStatus(feature.id), shape, analysis, tool, toolMode: 'cut' };
};
