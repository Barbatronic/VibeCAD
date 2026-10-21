/**
 * Projet de démonstration pour les captures de la documentation : une petite voiture.
 * - Châssis : plaque de contreplaqué 130 × 56 × 5, allégée de deux trous ;
 * - Palier : bloc sous le châssis, percé pour l'essieu (jeu de 0,2 mm) ;
 * - Roue : Ø 40, 8 mm de large, moyeu Ø 5, cinq trous d'allègement (répétition circulaire) ;
 * - Essieu : tige Ø 5, 88 mm ;
 * - Carrosserie : tôle d'acrylique 3 mm pliée en U renversé (deux bords pliés) posée sur le
 *   châssis, deux fenêtres découpées après les plis (reportées sur le développé) ;
 * - Assemblage : châssis, deux paliers, deux essieux, quatre roues, carrosserie, sans collision.
 */
import {
  addFeature,
  addInstance,
  addPart,
  createDocument,
  findPart,
  makeExtrudeFeature,
  makeFlangeFeature,
  makePatternFeature,
  makePocketFeature,
  makePrimitiveFeature,
  makeSheetFeature,
  makeSketchFeature,
  renamePart,
  setPartColor,
} from '../../src/domain/document';
import type { CadDocument, Id } from '../../src/domain/model';
import { addCircle, addRectangle } from '../../src/sketch/model';

export function demoCar(): CadDocument {
  let doc = createDocument('Petite voiture');
  const name = (id: Id, n: string, color: string) => {
    doc = setPartColor(renamePart(doc, id, n), id, color);
  };
  const box = (partId: Id, position: { x: number; y: number; z: number }, width: number, depth: number, height: number, mode?: 'cut') => {
    const f = makePrimitiveFeature(doc, findPart(doc, partId)!, 'box', mode);
    doc = addFeature(doc, partId, { ...f, params: { ...f.params, position, width, depth, height } });
  };

  // Châssis.
  const chassis = doc.parts[0]!.id;
  name(chassis, 'Châssis', '#4c6ef5');
  box(chassis, { x: -65, y: -28, z: 0 }, 130, 56, 5);
  for (const x of [-22, 22]) {
    const hole = makePrimitiveFeature(doc, findPart(doc, chassis)!, 'cylinder', 'cut');
    doc = addFeature(doc, chassis, { ...hole, params: { ...hole.params, position: { x, y: 0, z: 0 }, diameter: 16, height: 5 } });
  }

  // Palier : bloc percé (axe Y, esquisse sur le plan XZ) qui tient l'essieu sous le châssis.
  let r = addPart(doc, 'Palier');
  doc = r.doc;
  const bearing = r.partId;
  name(bearing, 'Palier', '#37b24d');
  box(bearing, { x: -6, y: -28, z: -6 }, 12, 56, 10);
  const skP = makeSketchFeature(doc, findPart(doc, bearing)!, { kind: 'plane', plane: 'XZ', offset: 0 });
  doc = addFeature(doc, bearing, { ...skP, params: addCircle(skP.params, { x: 0, y: 0 }, 2.7).sketch });
  doc = addFeature(doc, bearing, makePocketFeature(doc, findPart(doc, bearing)!, skP.id, { kind: 'throughAll' }, 'symmetric'));

  // Roue (son axe est Y : esquisses sur le plan XZ).
  r = addPart(doc, 'Roue');
  doc = r.doc;
  const wheel = r.partId;
  name(wheel, 'Roue', '#f08c00');
  const skW = makeSketchFeature(doc, findPart(doc, wheel)!, { kind: 'plane', plane: 'XZ', offset: 0 });
  const outer = addCircle(skW.params, { x: 0, y: 0 }, 20);
  doc = addFeature(doc, wheel, { ...skW, params: addCircle(outer.sketch, { x: 0, y: 0 }, 2.5).sketch });
  doc = addFeature(doc, wheel, makeExtrudeFeature(doc, findPart(doc, wheel)!, skW.id, 8, 'symmetric'));
  const skH = makeSketchFeature(doc, findPart(doc, wheel)!, { kind: 'plane', plane: 'XZ', offset: 0 });
  doc = addFeature(doc, wheel, { ...skH, params: addCircle(skH.params, { x: 11.5, y: 0 }, 4).sketch });
  const lighten = makePocketFeature(doc, findPart(doc, wheel)!, skH.id, { kind: 'throughAll' }, 'symmetric');
  doc = addFeature(doc, wheel, lighten);
  const pat = makePatternFeature(doc, findPart(doc, wheel)!, lighten.id, 'circular');
  doc = addFeature(doc, wheel, { ...pat, params: { ...pat.params, axis: { kind: 'axis', axis: 'Y' }, count: 5, angle: 360 } });

  // Essieu.
  r = addPart(doc, 'Essieu');
  doc = r.doc;
  const axle = r.partId;
  name(axle, 'Essieu', '#ced4da');
  const skA = makeSketchFeature(doc, findPart(doc, axle)!, { kind: 'plane', plane: 'XZ', offset: 0 });
  doc = addFeature(doc, axle, { ...skA, params: addCircle(skA.params, { x: 0, y: 0 }, 2.5).sketch });
  doc = addFeature(doc, axle, makeExtrudeFeature(doc, findPart(doc, axle)!, skA.id, 88, 'symmetric'));

  // Carrosserie : tôle d'acrylique 3 mm, bords pliés vers le bas, fenêtres découpées après.
  r = addPart(doc, 'Carrosserie');
  doc = r.doc;
  const body = r.partId;
  name(body, 'Carrosserie', '#e03131');
  const skB = makeSketchFeature(doc, findPart(doc, body)!, { kind: 'plane', plane: 'XY', offset: 0 });
  const rect = addRectangle(skB.params, { x: -45, y: -BODY_HALF_WIDTH }, { x: 45, y: BODY_HALF_WIDTH });
  doc = addFeature(doc, body, { ...skB, params: rect.sketch });
  const sheet = makeSheetFeature(doc, findPart(doc, body)!, skB.id, 'acrylic');
  doc = addFeature(doc, body, { ...sheet, params: { ...sheet.params, thickness: 3, radius: 3 } });
  const edge = (line: string) => ({ faces: [{ featureId: sheet.id, role: 'end' as const }, { featureId: sheet.id, role: 'side' as const, entityId: line }] as [any, any] });
  const flange = makeFlangeFeature(doc, findPart(doc, body)!, [edge(rect.lines[0]), edge(rect.lines[2])]);
  doc = addFeature(doc, body, { ...flange, params: { ...flange.params, length: 24, direction: 'down' } });
  box(body, { x: -30, y: -60, z: -20 }, 60, 120, 11, 'cut');

  // Assemblage (pièces posées à leur place) : essieux à z = 20, châssis posé sur les paliers.
  const place = (partId: Id, x: number, y: number, z: number) => {
    doc = addInstance(doc, partId, { x, y, z }).doc;
  };
  place(chassis, 0, 0, 24);
  for (const x of [-40, 40]) place(bearing, x, 0, 20);
  for (const x of [-40, 40]) place(axle, x, 0, 20);
  for (const x of [-40, 40]) for (const y of [-38, 38]) place(wheel, x, y, 20);
  place(body, 0, 0, BODY_Z);
  return doc;
}

/** Demi-largeur de la carrosserie à plat : ses bords pliés (y de 25 à 28) tiennent sur le châssis. */
const BODY_HALF_WIDTH = 22;
/** Hauteur de la carrosserie : bas des bords pliés (27 mm sous le dessus) sur le châssis (z = 29). */
const BODY_Z = 56;
