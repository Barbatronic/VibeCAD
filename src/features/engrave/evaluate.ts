import type { EngraveFeature } from '../../domain/model';
import { issue, okStatus } from '../../domain/status';
import type { GeometryKernel, KernelShape, ShapeAnalysis } from '../../geometry/kernel';
import type { FeatureEvaluator } from '../evaluation';
import { resolveProfile } from '../sketch/evaluate';
import { engraveDefinition } from './definition';

/** Épaisseur du prisme dont la face d'arrivée, posée sur la face, sert à la découper. */
const MARK_LAYER = 0.05;

/**
 * Marquages de surface, appliqués au solide final : chaque face est découpée selon le dessin, sans
 * changer le volume. La zone marquée devient une face à part, à fleur, qui peut prendre une autre
 * couleur en impression 3D. Faits en dernier : les opérations booléennes refusionneraient la zone
 * dans sa face, et ses arêtes gêneraient congés et chanfreins. Un marquage que le noyau ne sait pas
 * faire est ignoré (la pièce reste telle quelle). Rend null si rien n'a été marqué.
 */
export function applyMarks(kernel: GeometryKernel, base: KernelShape, before: ShapeAnalysis, marks: readonly KernelShape[]): { shape: KernelShape; analysis: ShapeAnalysis } | null {
  let current: { shape: KernelShape; analysis: ShapeAnalysis } | null = null;
  for (const mark of marks) {
    let shape: KernelShape;
    try {
      shape = kernel.imprint(current?.shape ?? base, mark);
    } catch {
      continue;
    }
    const analysis = kernel.analyze(shape);
    if (!analysis.valid || analysis.solidCount !== before.solidCount || Math.abs(analysis.volume - before.volume) > Math.max(1e-6, before.volume * 1e-6)) {
      kernel.dispose(shape);
      continue;
    }
    if (current) kernel.dispose(current.shape);
    current = { shape, analysis };
  }
  return current;
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
  // Marquage : la couche est gardée, le moteur l'applique au solide final (voir `applyMarks`).
  if (feature.params.depth <= 0) return { status: okStatus(feature.id), mark: ctx.kernel.makePrism({ featureId: feature.id, regions: resolved.regions, frame: resolved.frame, from: -MARK_LAYER, to: 0, numberEnds: true }) };
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
