import type { DraftFeature } from '../../domain/model';
import { issue, okStatus } from '../../domain/status';
import { scale3, vec3, type Vec3 } from '../../math/vec';
import type { FeatureEvaluator } from '../evaluation';
import { resolvePlaneRef } from '../plane/resolve';
import { draftDefinition } from './definition';

export const evaluateDraft: FeatureEvaluator<DraftFeature> = (feature, ctx) => {
  const paramIssues = draftDefinition.validate(feature);
  if (paramIssues.length > 0) return { status: issue(feature.id, 'error', 'INVALID_PARAMETER', { message: paramIssues[0]!.message }) };
  if (!ctx.shape || !ctx.shapeAnalysis) return { status: issue(feature.id, 'error', 'INVALID_PARAMETER', { message: 'Il faut d’abord un volume.' }) };
  const p = feature.params;
  // Aucune face encore choisie : la pièce reste telle quelle.
  if (p.faces.length === 0) return { status: issue(feature.id, 'warning', 'DRAFT_NO_FACE') };
  // Plan neutre et sens de démoulage : +X, +Y ou +Z pour un plan d'origine, vers l'intérieur de la
  // pièce pour une face.
  let origin: Vec3;
  let direction: Vec3;
  if (p.neutral.kind === 'plane') {
    origin = vec3(0, 0, 0);
    direction = p.neutral.plane === 'XY' ? vec3(0, 0, 1) : p.neutral.plane === 'XZ' ? vec3(0, 1, 0) : vec3(1, 0, 0);
  } else {
    const found = resolvePlaneRef(p.neutral, ctx);
    if (!found.ok) return { status: issue(feature.id, 'error', 'DRAFT_NEUTRAL_LOST', { relatedFeatureId: found.relatedFeatureId }) };
    origin = found.frame.origin;
    // Face : vers l'intérieur de la pièce ; plan de construction : le long de sa normale.
    direction = p.neutral.kind === 'face' ? scale3(found.frame.normal, -1) : found.frame.normal;
  }
  if (p.reversed) direction = scale3(direction, -1);
  const r = ctx.kernel.draft(ctx.shape, { featureId: feature.id, faces: p.faces, angle: p.angle, origin, direction });
  if (r.status === 'faces-lost') return { status: issue(feature.id, 'error', 'DRAFT_FACE_LOST', { relatedFeatureId: p.faces[r.missing[0]!]!.featureId }) };
  if (r.status === 'failed') return { status: issue(feature.id, 'error', 'DRAFT_FAILED', { detail: r.detail }) };
  const analysis = ctx.kernel.analyze(r.shape);
  if (!analysis.valid || analysis.solidCount === 0) {
    ctx.kernel.dispose(r.shape);
    return { status: issue(feature.id, 'error', 'DRAFT_FAILED') };
  }
  return { status: okStatus(feature.id), shape: r.shape, analysis };
};
