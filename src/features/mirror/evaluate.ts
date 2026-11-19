import type { MirrorFeature } from '../../domain/model';
import { issue, okStatus, type FeatureStatus } from '../../domain/status';
import type { KernelShape } from '../../geometry/kernel';
import { resolvePlaneRef } from '../plane/resolve';
import type { FeatureEvaluator } from '../evaluation';
import { mirrorDefinition } from './definition';
import { mirrorSources } from '../../domain/document';

export const evaluateMirror: FeatureEvaluator<MirrorFeature> = (feature, ctx) => {
  const paramIssues = mirrorDefinition.validate(feature);
  if (paramIssues.length > 0) return { status: issue(feature.id, 'error', 'INVALID_PARAMETER', { message: paramIssues[0]!.message }) };
  if (!ctx.shape || !ctx.shapeAnalysis) return { status: issue(feature.id, 'error', 'PATTERN_SOURCE_MISSING') };
  const p = feature.params;
  // Plan de symétrie.
  const found = resolvePlaneRef(p.plane, ctx);
  if (!found.ok) return { status: issue(feature.id, 'error', 'MIRROR_PLANE_LOST', { relatedFeatureId: found.relatedFeatureId }) };
  const { origin, normal } = found.frame;
  // Volumes à copier : toute la pièce, ou les corps outils des étapes choisies (dans l'ordre de l'historique).
  const sources: { shape: KernelShape; mode: 'add' | 'cut' }[] = [];
  if (p.source.kind === 'part') sources.push({ shape: ctx.shape, mode: 'add' });
  else {
    for (const id of mirrorSources(p)) {
      const tool = ctx.tools.get(id);
      if (!tool) return { status: issue(feature.id, 'error', 'PATTERN_SOURCE_MISSING', { relatedFeatureId: id }) };
      sources.push(tool);
    }
  }
  const kernel = ctx.kernel;
  // Chaque reflet est ajouté ou retiré à son tour ; une étape suivante voit les reflets des précédentes.
  let shape: KernelShape = ctx.shape;
  try {
    sources.forEach((source, n) => {
      const copy = kernel.mirrored(source.shape, origin, normal, p.source.kind === 'part' ? { featureId: feature.id, whole: true } : { featureId: feature.id, index: n + 1 });
      let next: KernelShape;
      try {
        next = source.mode === 'add' ? kernel.fuse(shape, copy) : kernel.cut(shape, copy);
      } finally {
        kernel.dispose(copy);
      }
      if (shape !== ctx.shape) kernel.dispose(shape);
      shape = next;
    });
  } catch (err) {
    if (shape !== ctx.shape) kernel.dispose(shape);
    throw err;
  }
  const analysis = kernel.analyze(shape);
  if (!analysis.valid || analysis.solidCount === 0) {
    kernel.dispose(shape);
    return { status: issue(feature.id, 'error', 'INVALID_SOLID') };
  }
  const before = ctx.shapeAnalysis.volume;
  const tiny = Math.max(1e-9, before * 1e-9);
  let status: FeatureStatus = okStatus(feature.id);
  if (Math.abs(analysis.volume - before) <= tiny) status = issue(feature.id, 'warning', sources.every((x) => x.mode === 'add') ? 'MIRROR_NOTHING_ADDED' : 'PATTERN_COPIES_OUTSIDE');
  else if (analysis.solidCount > ctx.shapeAnalysis.solidCount) status = issue(feature.id, 'warning', 'DISJOINT_SOLID');
  return { status, shape, analysis };
};
