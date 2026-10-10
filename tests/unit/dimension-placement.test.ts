import { describe, expect, it } from 'vitest';
import { originPlaneFrame } from '../../src/math/frame';
import { parseNativeFile, serializeDocument } from '../../src/io/native-format';
import { addFeature, createDocument, makeSketchFeature } from '../../src/domain/document';
import { addCircle, addConstraint, addRectangle, emptySketch } from '../../src/sketch/model';
import { createSession, moveDimensionLabel, placementFor, setPixelSize, undo } from '../../src/sketch/session';
import { solveSketch } from '../../src/sketch/solver';

const XY = { kind: 'plane', plane: 'XY', offset: 0 } as const;

function sketchWithDims() {
  const r = addRectangle(emptySketch(XY), { x: 0, y: 0 }, { x: 40, y: 20 });
  const w = addConstraint(r.sketch, { type: 'length', line: r.lines[0], value: 40 });
  const c = addCircle(w.sketch, { x: 20, y: 10 }, 4);
  const d = addConstraint(c.sketch, { type: 'diameter', circle: c.circleId, value: 8 });
  const x = addConstraint(d.sketch, { type: 'distanceX', a: r.corners[0], b: c.center, value: 20 });
  return { sketch: solveSketch(x.sketch).sketch, width: w.id, diameter: d.id, dx: x.id };
}

describe('déplacer les cotes', () => {
  it('calcule le placement d’après la position de la souris', () => {
    const { sketch, width, diameter, dx } = sketchWithDims();
    const find = (id: string) => sketch.constraints.find((k) => k.id === id)!;
    // Segment du bas (de (0,0) vers (40,0)) : normale vers +Y ; souris sous le segment → décalage négatif.
    expect(placementFor(sketch, find(width), { x: 20, y: -12 })).toEqual({ offset: -12 });
    expect(placementFor(sketch, find(dx), { x: 10, y: 30 })).toEqual({ offset: 25 });
    expect(placementFor(sketch, find(diameter), { x: 20, y: 24 })).toEqual({ labelAngle: 90, offset: 10 });
  });

  it('glisser une cote ne change ni la géométrie ni la valeur, et s’annule en une fois', () => {
    const { sketch, width } = sketchWithDims();
    let s = setPixelSize(createSession({ featureId: 'sk', partId: 'p', isNew: false, frame: originPlaneFrame('XY'), sketch }), 0.1);
    const before = s.sketch.entities;
    const dof = s.dof;
    s = moveDimensionLabel(s, width, { x: 20, y: -5 }, 'move');
    s = moveDimensionLabel(s, width, { x: 20, y: -9 }, 'move');
    s = moveDimensionLabel(s, width, null, 'end');
    expect(s.sketch.constraints.find((k) => k.id === width)).toMatchObject({ value: 40, offset: -9 });
    expect(s.sketch.entities).toEqual(before);
    expect(s.dof).toBe(dof);
    expect(s.undo).toHaveLength(1);
    s = undo(s);
    expect(s.sketch.constraints.find((k) => k.id === width)).not.toHaveProperty('offset');
  });

  it('le placement est enregistré dans le fichier', () => {
    let doc = createDocument('Cotes');
    const part = doc.parts[0]!;
    const sk = makeSketchFeature(doc, part, XY);
    const { sketch, width, diameter } = sketchWithDims();
    const placed = {
      ...sketch,
      constraints: sketch.constraints.map((k) => (k.id === width ? { ...k, offset: -9 } : k.id === diameter ? { ...k, offset: 6, labelAngle: 135 } : k)),
    };
    doc = addFeature(doc, part.id, { ...sk, params: placed });
    const parsed = parseNativeFile(serializeDocument(doc));
    expect(parsed.ok && parsed.doc).toEqual(doc);
  });
});
