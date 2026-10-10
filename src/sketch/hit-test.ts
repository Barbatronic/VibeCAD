/** Détection de l'élément d'esquisse sous le curseur (coordonnées d'esquisse, tolérance en mm). */
import { ORIGIN_POINT_ID, type SketchParams } from '../domain/model';
import { distance2, distanceToSegment2, type Vec2 } from '../math/vec';
import { arcContainsAngle, arcGeometry, pointPosition } from './model';

export type SketchTarget =
  | { kind: 'point'; id: string }
  | { kind: 'line'; id: string }
  | { kind: 'circle'; id: string; onEdge: boolean }
  | { kind: 'arc'; id: string };

export function hitTest(sketch: SketchParams, p: Vec2, tolerance: number, includeOrigin = true): SketchTarget | null {
  // Les points ont la priorité : ils sont petits et difficiles à viser.
  let bestPoint: { id: string; d: number } | null = null;
  if (includeOrigin) {
    const d = distance2(p, { x: 0, y: 0 });
    if (d <= tolerance) bestPoint = { id: ORIGIN_POINT_ID, d };
  }
  for (const e of sketch.entities) {
    if (e.type !== 'point') continue;
    const d = distance2(p, e);
    if (d <= tolerance && (!bestPoint || d < bestPoint.d)) bestPoint = { id: e.id, d };
  }
  if (bestPoint) return { kind: 'point', id: bestPoint.id };

  let best: { target: SketchTarget; d: number } | null = null;
  for (const e of sketch.entities) {
    if (e.type === 'line') {
      const a = pointPosition(sketch, e.a);
      const b = pointPosition(sketch, e.b);
      if (!a || !b) continue;
      const d = distanceToSegment2(p, a, b);
      if (d <= tolerance && (!best || d < best.d)) best = { target: { kind: 'line', id: e.id }, d };
    } else if (e.type === 'circle') {
      const c = pointPosition(sketch, e.center);
      if (!c) continue;
      const d = Math.abs(distance2(p, c) - e.radius);
      if (d <= tolerance && (!best || d < best.d)) best = { target: { kind: 'circle', id: e.id, onEdge: true }, d };
    } else if (e.type === 'arc') {
      const g = arcGeometry(sketch, e);
      if (!g) continue;
      const d = arcContainsAngle(g, p) ? Math.abs(distance2(p, g.center) - g.radius) : Math.min(distance2(p, g.start), distance2(p, g.end));
      if (d <= tolerance && (!best || d < best.d)) best = { target: { kind: 'arc', id: e.id }, d };
    }
  }
  return best?.target ?? null;
}
