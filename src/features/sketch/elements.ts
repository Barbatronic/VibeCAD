/**
 * Éléments d'une esquisse placés dans l'espace (plans et axes de construction qui s'appuient sur
 * une esquisse) : un point, un segment, un cercle ou un arc (centre, axe perpendiculaire à
 * l'esquisse, rayon). Ils suivent l'esquisse quand elle change.
 */
import type { Id } from '../../domain/model';
import { frameToWorld, type Frame3D } from '../../math/frame';
import type { Vec3 } from '../../math/vec';
import { pointPosition } from '../../sketch/model';
import type { EvaluationContext } from '../evaluation';

/** Élément d'une esquisse désigné par son identifiant. */
export interface SketchElementRef {
  sketchId: Id;
  entityId: string;
}

export type PlacedSketchElement =
  | { kind: 'point'; point: Vec3; frame: Frame3D }
  | { kind: 'line'; start: Vec3; end: Vec3; frame: Frame3D }
  | { kind: 'circle'; center: Vec3; axis: Vec3; radius: number; frame: Frame3D };

/** L'élément désigné, dans l'espace ; null si l'esquisse ou l'élément n'existe plus. */
export function placeSketchElement(ref: SketchElementRef, ctx: Pick<EvaluationContext, 'sketches'>): PlacedSketchElement | null {
  const ev = ctx.sketches.get(ref.sketchId)?.evaluation;
  const frame = ev?.frame;
  if (!ev || !frame) return null;
  const sk = ev.solved;
  const at = (id: string) => {
    const p = pointPosition(sk, id);
    return p ? frameToWorld(frame, p) : null;
  };
  const e = sk.entities.find((x) => x.id === ref.entityId);
  if (!e) return null;
  if (e.type === 'point') {
    const point = at(e.id);
    return point ? { kind: 'point', point, frame } : null;
  }
  if (e.type === 'line') {
    const [start, end] = [at(e.a), at(e.b)];
    return start && end ? { kind: 'line', start, end, frame } : null;
  }
  if (e.type === 'circle' || e.type === 'arc') {
    const center = at(e.center);
    if (!center) return null;
    let radius = 0;
    if (e.type === 'circle') radius = e.radius;
    else {
      const s = pointPosition(sk, e.start);
      const c = pointPosition(sk, e.center);
      radius = s && c ? Math.hypot(s.x - c.x, s.y - c.y) : 0;
    }
    return { kind: 'circle', center, axis: frame.normal, radius, frame };
  }
  return null;
}
