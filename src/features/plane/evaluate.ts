import type { PlaneFeature } from '../../domain/model';
import { issue, okStatus } from '../../domain/status';
import { offsetFrame, type Frame3D } from '../../math/frame';
import { add3, cross3, dot3, scale3, sub3, type Vec3 } from '../../math/vec';
import type { FeatureEvaluator } from '../evaluation';
import { resolvePatternAxis } from '../pattern/evaluate';
import { planeDefinition } from './definition';
import { resolvePlaneRef } from './resolve';

/** Rotation d'un vecteur autour de la direction unitaire `k` (formule de Rodrigues). */
function rotateVector(v: Vec3, k: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return add3(add3(scale3(v, c), scale3(cross3(k, v), s)), scale3(k, dot3(k, v) * (1 - c)));
}

/** Repère tourné de `angle` radians autour de la droite (point, direction unitaire). */
export function rotateFrame(frame: Frame3D, point: Vec3, dir: Vec3, angle: number): Frame3D {
  return {
    origin: add3(point, rotateVector(sub3(frame.origin, point), dir, angle)),
    xAxis: rotateVector(frame.xAxis, dir, angle),
    yAxis: rotateVector(frame.yAxis, dir, angle),
    normal: rotateVector(frame.normal, dir, angle),
  };
}

export const evaluatePlane: FeatureEvaluator<PlaneFeature> = (feature, ctx) => {
  const paramIssues = planeDefinition.validate(feature);
  if (paramIssues.length > 0) return { status: issue(feature.id, 'error', 'INVALID_PARAMETER', { message: paramIssues[0]!.message }) };
  const p = feature.params;
  const base = resolvePlaneRef(p.base, ctx);
  if (!base.ok) return { status: issue(feature.id, 'error', 'PLANE_BASE_LOST', { relatedFeatureId: base.relatedFeatureId }) };
  let frame = offsetFrame(base.frame, p.offset);
  if (p.angle !== 0) {
    const line = resolvePatternAxis(ctx.kernel, ctx.shape, p.hinge, ctx.axes);
    if ('error' in line) return { status: issue(feature.id, 'error', 'PLANE_HINGE_LOST', p.hinge.kind === 'edge' ? { relatedFeatureId: p.hinge.edge.faces[0].featureId } : p.hinge.kind === 'datum' ? { relatedFeatureId: p.hinge.featureId } : {}) };
    frame = rotateFrame(frame, line.point, line.dir, (p.angle * Math.PI) / 180);
  }
  return { status: okStatus(feature.id), datum: frame };
};
