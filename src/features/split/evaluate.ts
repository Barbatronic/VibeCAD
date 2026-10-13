import type { SplitFeature } from '../../domain/model';
import { issue, okStatus } from '../../domain/status';
import type { KernelShape } from '../../geometry/kernel';
import { add3, length3, scale3, vec3, type Vec3 } from '../../math/vec';
import type { FeatureEvaluator } from '../evaluation';
import { halfSpace } from '../half-space';
import { resolvePlaneRef } from '../plane/resolve';
import { SPLIT_AXIS, splitDefinition } from './definition';

/**
 * Découpe : la pièce est coupée par deux demi-espaces (voir `halfSpace`).
 * La face de coupe du morceau du dessous vient de la boîte du dessus (rôle `start`), celle du
 * morceau du dessus de la boîte du dessous (rôle `end`), toutes deux au nom de la découpe.
 */
export const evaluateSplit: FeatureEvaluator<SplitFeature> = (feature, ctx) => {
  const paramIssues = splitDefinition.validate(feature);
  if (paramIssues.length > 0) return { status: issue(feature.id, 'error', 'INVALID_PARAMETER', { message: paramIssues[0]!.message }) };
  if (!ctx.shape || !ctx.shapeAnalysis?.bbox) return { status: issue(feature.id, 'error', 'PATTERN_SOURCE_MISSING') };
  const p = feature.params;
  const kernel = ctx.kernel;
  let origin: Vec3;
  let normal: Vec3;
  if (p.plane.kind === 'plane') {
    const axis = SPLIT_AXIS[p.plane.plane];
    normal = vec3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0);
    origin = scale3(normal, p.offset);
  } else {
    const found = resolvePlaneRef(p.plane, ctx);
    if (!found.ok) return { status: issue(feature.id, 'error', 'SPLIT_PLANE_LOST', { relatedFeatureId: found.relatedFeatureId }) };
    normal = found.frame.normal;
    origin = add3(found.frame.origin, scale3(normal, p.offset));
  }
  // Demi-espaces : boîtes assez grandes pour contenir toute la pièce.
  const { min, max } = ctx.shapeAnalysis.bbox;
  const size = 10 + 2 * (length3(vec3(max.x - min.x, max.y - min.y, max.z - min.z)) + length3(add3(min, scale3(origin, -1))));
  const side = (keepAbove: boolean): KernelShape | null => {
    const box = halfSpace(kernel, feature.id, origin, normal, size, keepAbove ? 'opposite' : 'normal');
    try {
      const piece = kernel.cut(ctx.shape!, box);
      if (kernel.analyze(piece).solidCount > 0) return piece;
      kernel.dispose(piece);
      return null;
    } finally {
      kernel.dispose(box);
    }
  };
  const before = ctx.shapeAnalysis.volume;
  const tiny = Math.max(1e-9, before * 1e-9);
  let shape: KernelShape;
  let outside = false;
  if (p.keep !== 'both') {
    const piece = side(p.keep === 'above');
    if (!piece) return { status: issue(feature.id, 'error', 'SPLIT_NOTHING_LEFT') };
    shape = piece;
    outside = Math.abs(kernel.analyze(piece).volume - before) <= tiny;
  } else {
    const below = side(false);
    const above = side(true);
    if (!below || !above) {
      const only = below ?? above;
      if (!only) return { status: issue(feature.id, 'error', 'SPLIT_NOTHING_LEFT') };
      shape = only;
      outside = true;
    } else {
      // Le morceau du dessus est écarté le long de la normale (étiquettes conservées).
      const d = scale3(normal, p.gap);
      let moved: KernelShape | null = null;
      try {
        moved = kernel.transformed(above, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, d.x, d.y, d.z, 1], { keep: true });
        shape = kernel.fuse(below, moved);
      } finally {
        kernel.dispose(below);
        kernel.dispose(above);
        if (moved) kernel.dispose(moved);
      }
    }
  }
  const analysis = kernel.analyze(shape);
  if (!analysis.valid || analysis.solidCount === 0) {
    kernel.dispose(shape);
    return { status: issue(feature.id, 'error', 'INVALID_SOLID') };
  }
  return { status: outside ? issue(feature.id, 'warning', 'SPLIT_OUTSIDE') : okStatus(feature.id), shape, analysis };
};
