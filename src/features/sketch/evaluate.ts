import type { Id, SketchEntity, SketchFeature, SketchParams } from '../../domain/model';
import { issue, okStatus, type FeatureIssueCode, type FeatureStatus } from '../../domain/status';
import { canonicalFrame, originPlaneFrame, worldToFrame, type Frame3D } from '../../math/frame';
import { distance2, dot3, type Vec2 } from '../../math/vec';
import { extractProfiles, type ProfileRegion } from '../../sketch/profiles';
import { solveSketch } from '../../sketch/solver';
import type { EvaluationContext, FeatureEvaluator, FeatureOutcome } from '../evaluation';

/** Repère d'une esquisse : plan d'origine, ou face plane retrouvée par sa référence sémantique. */
export function resolveSketchFrame(feature: SketchFeature, ctx: EvaluationContext): { frame: Frame3D } | { code: FeatureIssueCode } {
  const support = feature.params.support;
  if (support.kind === 'plane') return { frame: originPlaneFrame(support.plane, support.offset) };
  if (!ctx.shape) return { code: 'SUPPORT_LOST' };
  const found = ctx.kernel.findFacePlane(ctx.shape, support.ref);
  switch (found.status) {
    case 'found':
      return { frame: canonicalFrame(found.origin, found.normal) };
    case 'lost':
      return { code: 'SUPPORT_LOST' };
    case 'not-planar':
      return { code: 'SUPPORT_NOT_PLANAR' };
    case 'ambiguous':
      return { code: 'SUPPORT_AMBIGUOUS' };
  }
}

/**
 * Reprojette les arêtes reprises de la pièce (état de la pièce juste avant l'esquisse) sur le
 * plan de l'esquisse. Une arête introuvable garde sa dernière position et est signalée.
 */
export function updateReferences(params: SketchParams, frame: Frame3D, ctx: EvaluationContext): { params: SketchParams; lost: string[] } {
  const refs = params.entities.filter((e) => (e.type === 'line' || e.type === 'circle') && e.reference);
  if (refs.length === 0) return { params, lost: [] };
  const moves = new Map<string, Vec2>();
  const radii = new Map<string, number>();
  const lost: string[] = [];
  const pointAt = (id: string): Vec2 | undefined => {
    const p = params.entities.find((e) => e.id === id);
    return p?.type === 'point' ? p : undefined;
  };
  for (const e of refs) {
    if ((e.type !== 'line' && e.type !== 'circle') || !e.reference) continue;
    const curves = ctx.shape ? ctx.kernel.edgeCurves(ctx.shape, e.reference.edge) : [];
    if (e.type === 'line') {
      const a = pointAt(e.a);
      const b = pointAt(e.b);
      let best: { a: Vec2; b: Vec2; d: number } | null = null;
      for (const c of curves) {
        if (c.kind !== 'line') continue;
        const s = worldToFrame(frame, c.start);
        const t = worldToFrame(frame, c.end);
        // Même sens que la position enregistrée (les cotes gardent leurs extrémités).
        const direct = a && b ? distance2(a, s) + distance2(b, t) : 0;
        const swapped = a && b ? distance2(a, t) + distance2(b, s) : Infinity;
        const cand = direct <= swapped ? { a: s, b: t, d: direct } : { a: t, b: s, d: swapped };
        if (!best || cand.d < best.d) best = cand;
      }
      if (!best || distance2(best.a, best.b) < 1e-9) lost.push(e.id);
      else {
        moves.set(e.a, best.a);
        moves.set(e.b, best.b);
      }
    } else {
      const center = pointAt(e.center);
      let best: { c: Vec2; r: number; d: number } | null = null;
      for (const c of curves) {
        if (c.kind !== 'circle' || Math.abs(Math.abs(dot3(c.axis, frame.normal)) - 1) > 1e-6) continue;
        const p = worldToFrame(frame, c.center);
        const d = center ? distance2(center, p) + Math.abs(c.radius - e.radius) : 0;
        if (!best || d < best.d) best = { c: p, r: c.radius, d };
      }
      if (!best) lost.push(e.id);
      else {
        moves.set(e.center, best.c);
        radii.set(e.id, best.r);
      }
    }
  }
  const entities = params.entities.map((e): SketchEntity => {
    if (e.type === 'point') {
      const m = moves.get(e.id);
      return m ? { ...e, x: m.x, y: m.y } : e;
    }
    if (e.type === 'circle') {
      const r = radii.get(e.id);
      return r !== undefined ? { ...e, radius: r } : e;
    }
    return e;
  });
  return { params: { ...params, entities }, lost };
}

export const evaluateSketch: FeatureEvaluator<SketchFeature> = (feature, ctx) => {
  const resolved = resolveSketchFrame(feature, ctx);
  const refs = 'frame' in resolved ? updateReferences(feature.params, resolved.frame, ctx) : { params: feature.params, lost: [] };
  const solve = solveSketch(refs.params);
  const profile = extractProfiles(solve.sketch);
  let status: FeatureStatus = okStatus(feature.id);
  if ('code' in resolved) status = issue(feature.id, 'error', resolved.code);
  else if (!solve.converged) {
    status = issue(feature.id, 'error', 'SKETCH_CONFLICT', { detail: `Contraintes non satisfaites : ${solve.unsatisfied.join(', ')}` });
  } else if (refs.lost.length > 0) {
    status = issue(feature.id, 'warning', 'REFERENCE_LOST');
  } else if (solve.invalidConstraints.length > 0) {
    status = issue(feature.id, 'warning', 'INVALID_PARAMETER', {
      message: 'Certaines contraintes visent des éléments supprimés ; elles sont ignorées.',
    });
  }
  return {
    status,
    sketch: {
      featureId: feature.id,
      frame: 'frame' in resolved ? resolved.frame : null,
      solved: solve.sketch,
      converged: solve.converged,
      dof: solve.dof,
      freeEntities: Array.from(solve.freeEntities),
      unsatisfied: solve.unsatisfied,
      profile,
    },
  };
};

/**
 * Profil fermé de l'esquisse utilisée par une opération volumique, ou le statut d'erreur
 * de l'opération (esquisse absente, en erreur, contour ouvert…).
 */
export function resolveProfile(
  featureId: Id,
  sketchId: Id,
  ctx: EvaluationContext,
): { regions: ProfileRegion[]; frame: Frame3D } | FeatureOutcome {
  const entry = ctx.sketches.get(sketchId);
  if (!entry) return { status: issue(featureId, 'error', 'SKETCH_MISSING') };
  if (entry.status.state === 'error' || entry.status.state === 'blocked' || !entry.evaluation.frame) {
    return { status: issue(featureId, 'blocked', 'SKETCH_FAILED', { blockedBy: entry.status.blockedBy ?? sketchId, relatedFeatureId: sketchId }) };
  }
  const profile = entry.evaluation.profile;
  if (!profile.ok) {
    return {
      status: issue(featureId, 'error', profile.code, { highlightPoints: profile.points, relatedFeatureId: sketchId }),
    };
  }
  return { regions: profile.regions, frame: entry.evaluation.frame };
}
