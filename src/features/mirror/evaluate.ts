import type { MirrorFeature } from '../../domain/model';
import { issue, okStatus, type FeatureStatus } from '../../domain/status';
import type { KernelShape } from '../../geometry/kernel';
import { originPlaneFrame } from '../../math/frame';
import type { FeatureEvaluator } from '../evaluation';
import { mirrorDefinition } from './definition';

export const evaluateMirror: FeatureEvaluator<MirrorFeature> = (feature, ctx) => {
  const paramIssues = mirrorDefinition.validate(feature);
  if (paramIssues.length > 0) return { status: issue(feature.id, 'error', 'INVALID_PARAMETER', { message: paramIssues[0]!.message }) };
  if (!ctx.shape || !ctx.shapeAnalysis) return { status: issue(feature.id, 'error', 'PATTERN_SOURCE_MISSING') };
  const p = feature.params;
  // Plan de symétrie.
  let origin;
  let normal;
  if (p.plane.kind === 'plane') {
    const frame = originPlaneFrame(p.plane.plane);
    origin = frame.origin;
    normal = frame.normal;
  } else {
    const found = ctx.kernel.findFacePlane(ctx.shape, p.plane.ref);
    if (found.status !== 'found') return { status: issue(feature.id, 'error', 'MIRROR_PLANE_LOST', { relatedFeatureId: p.plane.ref.featureId }) };
    origin = found.origin;
    normal = found.normal;
  }
  // Volume à copier : toute la pièce, ou le corps outil d'une étape.
  let source: { shape: KernelShape; mode: 'add' | 'cut' };
  if (p.source.kind === 'part') source = { shape: ctx.shape, mode: 'add' };
  else {
    const tool = ctx.tools.get(p.source.featureId);
    if (!tool) return { status: issue(feature.id, 'error', 'PATTERN_SOURCE_MISSING', { relatedFeatureId: p.source.featureId }) };
    source = tool;
  }
  const kernel = ctx.kernel;
  const copy = kernel.mirrored(source.shape, origin, normal, p.source.kind === 'part' ? { featureId: feature.id, whole: true } : { featureId: feature.id, index: 1 });
  let shape: KernelShape;
  try {
    shape = source.mode === 'add' ? kernel.fuse(ctx.shape, copy) : kernel.cut(ctx.shape, copy);
  } finally {
    kernel.dispose(copy);
  }
  const analysis = kernel.analyze(shape);
  if (!analysis.valid || analysis.solidCount === 0) {
    kernel.dispose(shape);
    return { status: issue(feature.id, 'error', 'INVALID_SOLID') };
  }
  const before = ctx.shapeAnalysis.volume;
  const tiny = Math.max(1e-9, before * 1e-9);
  let status: FeatureStatus = okStatus(feature.id);
  if (Math.abs(analysis.volume - before) <= tiny) status = issue(feature.id, 'warning', source.mode === 'add' ? 'MIRROR_NOTHING_ADDED' : 'PATTERN_COPIES_OUTSIDE');
  else if (analysis.solidCount > ctx.shapeAnalysis.solidCount) status = issue(feature.id, 'warning', 'DISJOINT_SOLID');
  return { status, shape, analysis };
};
