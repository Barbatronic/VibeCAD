/**
 * Plan désigné par une étape (support d'esquisse, plan de symétrie, de découpe, plan neutre) :
 * plan d'origine, face plane de la pièce ou plan de construction déjà calculé.
 */
import type { Id, MirrorPlane } from '../../domain/model';
import { canonicalFrame, originPlaneFrame, type Frame3D } from '../../math/frame';
import type { EvaluationContext } from '../evaluation';

export type PlaneLookup = { ok: true; frame: Frame3D } | { ok: false; relatedFeatureId: Id };

export function resolvePlaneRef(plane: MirrorPlane, ctx: Pick<EvaluationContext, 'kernel' | 'shape' | 'datums'>): PlaneLookup {
  if (plane.kind === 'plane') return { ok: true, frame: originPlaneFrame(plane.plane) };
  if (plane.kind === 'datum') {
    const frame = ctx.datums.get(plane.featureId);
    return frame ? { ok: true, frame } : { ok: false, relatedFeatureId: plane.featureId };
  }
  if (!ctx.shape) return { ok: false, relatedFeatureId: plane.ref.featureId };
  const found = ctx.kernel.findFacePlane(ctx.shape, plane.ref);
  return found.status === 'found' ? { ok: true, frame: canonicalFrame(found.origin, found.normal) } : { ok: false, relatedFeatureId: plane.ref.featureId };
}

/** Étape dont dépend ce plan (face ou plan de construction), s'il y en a une. */
export function planeDependency(plane: MirrorPlane): Id[] {
  return plane.kind === 'face' ? [plane.ref.featureId] : plane.kind === 'datum' ? [plane.featureId] : [];
}
