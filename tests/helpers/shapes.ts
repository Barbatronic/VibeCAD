/** Formes d'esquisse réutilisées par plusieurs tests. */
import type { SketchParams } from '../../src/domain/model';
import { addArc, addConstraint, addLine, emptySketch } from '../../src/sketch/model';
import { solveSketch } from '../../src/sketch/solver';

const XY = { kind: 'plane', plane: 'XY', offset: 0 } as const;

/** Oblong 40 × 20 : deux segments et deux demi-cercles de rayon 10, reliés par coïncidences. */
export function stadium(): { sketch: SketchParams; right: string; left: string } {
  const bottom = addLine(emptySketch(XY), { x: 0, y: 0 }, { x: 40, y: 0 });
  const top = addLine(bottom.sketch, { x: 40, y: 20 }, { x: 0, y: 20 });
  const right = addArc(top.sketch, { x: 40, y: 10 }, { x: 40, y: 0 }, { x: 40, y: 20 });
  const left = addArc(right.sketch, { x: 0, y: 10 }, { x: 0, y: 20 }, { x: 0, y: 0 });
  let s = left.sketch;
  for (const [a, b] of [
    [bottom.b, right.start],
    [right.end, top.a],
    [top.b, left.start],
    [left.end, bottom.a],
  ] as const) {
    s = addConstraint(s, { type: 'coincident', a, b }).sketch;
  }
  s = addConstraint(s, { type: 'tangent', a: bottom.lineId, b: right.arcId }).sketch;
  return { sketch: solveSketch(s).sketch, right: right.arcId, left: left.arcId };
}
