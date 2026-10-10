/**
 * Construit par le modèle métier la pièce du critère d'acceptation : plaque 60 × 30 × 5 mm
 * percée d'un trou Ø 6 mm placé par des cotes depuis l'origine.
 */
import {
  addFeature,
  createDocument,
  findPart,
  makeExtrudeFeature,
  makePocketFeature,
  makeSketchFeature,
  updateFeature,
} from '../../src/domain/document';
import { ORIGIN_POINT_ID, type CadDocument, type EdgeRef, type Id, type SketchFeature, type SketchParams } from '../../src/domain/model';
import { addCircle, addConstraint, addRectangle } from '../../src/sketch/model';
import { solveSketch } from '../../src/sketch/solver';

export interface PlateIds {
  partId: Id;
  sketch1: Id;
  extrude: Id;
  sketch2: Id;
  pocket: Id;
  widthConstraint: string;
}

export function rectangleSketch(base: SketchParams, width: number, height: number): { sketch: SketchParams; widthConstraint: string } {
  const r = addRectangle(base, { x: 0, y: 0 }, { x: width * 0.9, y: height * 1.1 });
  let s = addConstraint(r.sketch, { type: 'coincident', a: ORIGIN_POINT_ID, b: r.corners[0] }).sketch;
  const w = addConstraint(s, { type: 'length', line: r.lines[0], value: width });
  s = addConstraint(w.sketch, { type: 'length', line: r.lines[3], value: height }).sketch;
  return { sketch: solveSketch(s).sketch, widthConstraint: w.id };
}

export function holeSketch(base: SketchParams, x: number, y: number, diameter: number): SketchParams {
  const c = addCircle(base, { x: x + 1, y: y - 1 }, diameter / 3);
  let s = addConstraint(c.sketch, { type: 'diameter', circle: c.circleId, value: diameter }).sketch;
  s = addConstraint(s, { type: 'distanceX', a: ORIGIN_POINT_ID, b: c.center, value: x }).sketch;
  s = addConstraint(s, { type: 'distanceY', a: ORIGIN_POINT_ID, b: c.center, value: y }).sketch;
  return solveSketch(s).sketch;
}

export function buildPlateDocument(options: { holeOnFace?: boolean } = {}): { doc: CadDocument; ids: PlateIds } {
  let doc = createDocument('Plaque percée');
  const partId = doc.parts[0]!.id;
  let part = findPart(doc, partId)!;

  const sk1 = makeSketchFeature(doc, part, { kind: 'plane', plane: 'XY', offset: 0 });
  const rect = rectangleSketch(sk1.params, 60, 30);
  doc = addFeature(doc, partId, { ...sk1, params: rect.sketch });
  part = findPart(doc, partId)!;

  const ex = makeExtrudeFeature(doc, part, sk1.id, 5);
  doc = addFeature(doc, partId, ex);
  part = findPart(doc, partId)!;

  const support =
    options.holeOnFace === false
      ? ({ kind: 'plane', plane: 'XY', offset: 0 } as const)
      : ({ kind: 'face', ref: { featureId: ex.id, role: 'end' } } as const);
  const sk2 = makeSketchFeature(doc, part, support);
  doc = addFeature(doc, partId, { ...sk2, params: holeSketch(sk2.params, 15, 15, 6) });
  part = findPart(doc, partId)!;

  const po = makePocketFeature(doc, part, sk2.id, { kind: 'throughAll' }, options.holeOnFace === false ? 'symmetric' : 'default');
  doc = addFeature(doc, partId, po);

  return { doc, ids: { partId, sketch1: sk1.id, extrude: ex.id, sketch2: sk2.id, pocket: po.id, widthConstraint: rect.widthConstraint } };
}

/** Modifie la valeur d'une cote d'esquisse puis résout (comme le ferait l'éditeur). */
export function setDimension(doc: CadDocument, sketchId: Id, constraintId: string, value: number): CadDocument {
  return updateFeature<SketchFeature>(doc, sketchId, (f) => {
    const params = {
      ...f.params,
      constraints: f.params.constraints.map((c) => (c.id === constraintId && 'value' in c ? { ...c, value } : c)),
    };
    return { ...f, params: solveSketch(params).sketch };
  });
}

function rectangleLines(doc: CadDocument, sketchId: Id): string[] {
  const sketch = doc.parts.flatMap((p) => p.features).find((f) => f.id === sketchId) as SketchFeature;
  // addRectangle : bas, droite, haut, gauche.
  return sketch.params.entities.filter((e) => e.type === 'line').map((e) => e.id);
}

/** Arête verticale du coin (largeur, 30) : faces latérales engendrées par les segments droit et haut du rectangle. */
export function cornerEdge(doc: CadDocument, sketchId: Id, extrudeId: Id): EdgeRef {
  const lines = rectangleLines(doc, sketchId);
  return { faces: [{ featureId: extrudeId, role: 'side', entityId: lines[1]! }, { featureId: extrudeId, role: 'side', entityId: lines[2]! }] };
}

/** Arête supérieure avant (y = 0, z = 5), longue de la largeur de la plaque. */
export function topFrontEdge(doc: CadDocument, sketchId: Id, extrudeId: Id): EdgeRef {
  const lines = rectangleLines(doc, sketchId);
  return { faces: [{ featureId: extrudeId, role: 'end' }, { featureId: extrudeId, role: 'side', entityId: lines[0]! }] };
}
