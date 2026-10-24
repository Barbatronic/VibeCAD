/**
 * Projet de démonstration pour les captures : un support de moteur pas-à-pas NEMA 17.
 * - Platine : aluminium 100 × 70 × 8 aux coins arrondis, quatre trous M5 de fixation, motif NEMA 17 (4 trous Ø 3,4
 *   à 31 mm d'entraxe) et alésage Ø 22,5 pour le centreur du moteur ;
 * - Moteur : NEMA 17 (42,3 × 42,3 × 40, arêtes chanfreinées), centreur Ø 22 × 2, arbre Ø 5 × 24, taraudages M3 ;
 * - Poulie : GT2 20 dents, alésage Ø 5 (générateur d'engrenages) ;
 * - Visserie : 4 vis CHC M3 × 10 et leurs rondelles (moteur), 4 vis CHC M5 × 16, rondelles et
 *   écrous (fixation de la platine) ;
 * - Capot : tôle d'acrylique 3 mm pliée en U (deux bords pliés de 30 mm), trois fentes
 *   d'aération découpées après les plis (reportées sur le développé). Pièce du projet, non
 *   insérée dans l'assemblage (tôlerie et découpe laser).
 * Tous les perçages suivent Z : l'arête d'un trou est la paroi de la poche (cercle) et la face
 * traversée.
 */
import {
  addFeature,
  addInstance,
  createDocument,
  findPart,
  makeChamferFeature,
  makeExtrudeFeature,
  makeFilletFeature,
  makeFlangeFeature,
  makeGearFeature,
  makePocketFeature,
  makePrimitiveFeature,
  makeSheetFeature,
  makeSketchFeature,
  renamePart,
  setPartColor,
  setPartMaterial,
  addPart,
} from '../../src/domain/document';
import type { AssemblyFastener, CadDocument, EdgeRef, Id, SketchParams } from '../../src/domain/model';
import { addCircle, addRectangle } from '../../src/sketch/model';

/** Les quatre arêtes verticales d'un rectangle extrudé (entre deux côtés voisins). */
function corners(extrudeId: Id, lines: string[]): EdgeRef[] {
  return lines.map((l, i) => ({
    faces: [
      { featureId: extrudeId, role: 'side', entityId: l },
      { featureId: extrudeId, role: 'side', entityId: lines[(i + 1) % lines.length]! },
    ],
  }));
}

/** Cercles d'une esquisse ; renvoie l'esquisse et les identifiants des cercles. */
function circles(base: SketchParams, list: { x: number; y: number; r: number }[]): { sketch: SketchParams; ids: string[] } {
  let sketch = base;
  const ids: string[] = [];
  for (const c of list) {
    const r = addCircle(sketch, { x: c.x, y: c.y }, c.r);
    sketch = r.sketch;
    ids.push(r.circleId);
  }
  return { sketch, ids };
}

export function demoMotorMount(): CadDocument {
  let doc = createDocument('Support moteur NEMA 17');
  const style = (id: Id, name: string, color: string, material: string) => {
    doc = setPartMaterial(setPartColor(renamePart(doc, id, name), id, color), id, material);
  };

  // Platine : plaque 100 × 70 × 8 posée sur XY (dessous à z = 0).
  const plate = doc.parts[0]!.id;
  style(plate, 'Platine', '#8fa3b8', 'aluminium');
  const skP = makeSketchFeature(doc, findPart(doc, plate)!, { kind: 'plane', plane: 'XY', offset: 0 });
  const rectP = addRectangle(skP.params, { x: -50, y: -35 }, { x: 50, y: 35 });
  doc = addFeature(doc, plate, { ...skP, params: rectP.sketch });
  const exP = makeExtrudeFeature(doc, findPart(doc, plate)!, skP.id, 8);
  doc = addFeature(doc, plate, exP);
  doc = addFeature(doc, plate, makeFilletFeature(doc, findPart(doc, plate)!, corners(exP.id, rectP.lines), 6));
  const m5 = [{ x: -40, y: -25 }, { x: 40, y: -25 }, { x: 40, y: 25 }, { x: -40, y: 25 }];
  const m3 = [{ x: -15.5, y: -15.5 }, { x: 15.5, y: -15.5 }, { x: 15.5, y: 15.5 }, { x: -15.5, y: 15.5 }];
  const skH = makeSketchFeature(doc, findPart(doc, plate)!, { kind: 'face', ref: { featureId: exP.id, role: 'end' } });
  const holes = circles(skH.params, [...m5.map((p) => ({ ...p, r: 2.75 })), ...m3.map((p) => ({ ...p, r: 1.7 })), { x: 0, y: 0, r: 11.25 }]);
  doc = addFeature(doc, plate, { ...skH, params: holes.sketch });
  const poH = makePocketFeature(doc, findPart(doc, plate)!, skH.id, { kind: 'throughAll' });
  doc = addFeature(doc, plate, poH);
  const holeEdge = (circleId: string, face: 'start' | 'end'): EdgeRef => ({
    faces: [
      { featureId: poH.id, role: 'side', entityId: circleId },
      { featureId: exP.id, role: face },
    ],
  });

  // Moteur NEMA 17 : corps 42,3 × 42,3 × 40, centreur, arbre, taraudages M3 (dessus à z = 40).
  let r = addPart(doc, 'Moteur NEMA 17');
  doc = r.doc;
  const motor = r.partId;
  style(motor, 'Moteur NEMA 17', '#6b7480', 'steel');
  const skM = makeSketchFeature(doc, findPart(doc, motor)!, { kind: 'plane', plane: 'XY', offset: 0 });
  const rectM = addRectangle(skM.params, { x: -21.15, y: -21.15 }, { x: 21.15, y: 21.15 });
  doc = addFeature(doc, motor, { ...skM, params: rectM.sketch });
  const exM = makeExtrudeFeature(doc, findPart(doc, motor)!, skM.id, 40);
  doc = addFeature(doc, motor, exM);
  doc = addFeature(doc, motor, makeChamferFeature(doc, findPart(doc, motor)!, corners(exM.id, rectM.lines), 4));
  const skBoss = makeSketchFeature(doc, findPart(doc, motor)!, { kind: 'face', ref: { featureId: exM.id, role: 'end' } });
  doc = addFeature(doc, motor, { ...skBoss, params: circles(skBoss.params, [{ x: 0, y: 0, r: 11 }]).sketch });
  const exBoss = makeExtrudeFeature(doc, findPart(doc, motor)!, skBoss.id, 2);
  doc = addFeature(doc, motor, exBoss);
  const skShaft = makeSketchFeature(doc, findPart(doc, motor)!, { kind: 'face', ref: { featureId: exBoss.id, role: 'end' } });
  doc = addFeature(doc, motor, { ...skShaft, params: circles(skShaft.params, [{ x: 0, y: 0, r: 2.5 }]).sketch });
  doc = addFeature(doc, motor, makeExtrudeFeature(doc, findPart(doc, motor)!, skShaft.id, 24));
  const skTap = makeSketchFeature(doc, findPart(doc, motor)!, { kind: 'face', ref: { featureId: exM.id, role: 'end' } });
  doc = addFeature(doc, motor, { ...skTap, params: circles(skTap.params, m3.map((p) => ({ ...p, r: 1.25 }))).sketch });
  doc = addFeature(doc, motor, makePocketFeature(doc, findPart(doc, motor)!, skTap.id, { kind: 'distance', distance: 6 }));

  // Poulie GT2 20 dents, alésage 5.
  r = addPart(doc, 'Poulie GT2');
  doc = r.doc;
  const pulley = r.partId;
  style(pulley, 'Poulie GT2', '#d9a441', 'aluminium');
  const gear = makeGearFeature(doc, findPart(doc, pulley)!, 'pulley');
  doc = addFeature(doc, pulley, { ...gear, params: { ...gear.params, teeth: 20, thickness: 7, bore: 5, flanges: true } });

  // Capot de protection : tôle d'acrylique 3 mm, 80 × 56, bords pliés vers le bas, fentes d'aération.
  r = addPart(doc, 'Capot');
  doc = r.doc;
  const cover = r.partId;
  doc = setPartColor(renamePart(doc, cover, 'Capot'), cover, '#5aa9e6');
  const skC = makeSketchFeature(doc, findPart(doc, cover)!, { kind: 'plane', plane: 'XY', offset: 0 });
  const rectC = addRectangle(skC.params, { x: -40, y: -28 }, { x: 40, y: 28 });
  doc = addFeature(doc, cover, { ...skC, params: rectC.sketch });
  const sheet = makeSheetFeature(doc, findPart(doc, cover)!, skC.id, 'acrylic');
  doc = addFeature(doc, cover, { ...sheet, params: { ...sheet.params, thickness: 3, radius: 3 } });
  const sheetEdge = (line: string): EdgeRef => ({ faces: [{ featureId: sheet.id, role: 'end' }, { featureId: sheet.id, role: 'side', entityId: line }] });
  const flange = makeFlangeFeature(doc, findPart(doc, cover)!, [sheetEdge(rectC.lines[0]!), sheetEdge(rectC.lines[2]!)]);
  doc = addFeature(doc, cover, { ...flange, params: { ...flange.params, length: 30, direction: 'down' } });
  for (const y of [-12, 0, 12]) {
    const slot = makePrimitiveFeature(doc, findPart(doc, cover)!, 'box', 'cut');
    doc = addFeature(doc, cover, { ...slot, params: { ...slot.params, position: { x: -25, y: y - 2.5, z: -1 }, width: 50, depth: 5, height: 6 } });
  }

  // Assemblage : platine fixe, moteur dessous (dessus contre la platine), poulie sur l'arbre.
  const place = (partId: Id, z: number) => {
    const res = addInstance(doc, partId, { x: 0, y: 0, z });
    doc = res.doc;
    return res.instanceId;
  };
  const plateInst = place(plate, 0);
  place(motor, -40);
  place(pulley, 14);

  // Visserie : CHC M3 × 10 + rondelle sur les trous du moteur ; CHC M5 × 16 + rondelle dessus,
  // rondelle + écrou dessous, dans les coins.
  const fasteners: AssemblyFastener[] = [];
  let n = 0;
  const add = (f: Omit<AssemblyFastener, 'id'>) => fasteners.push({ ...f, id: `fa-${++n}` });
  holes.ids.slice(4, 8).forEach((c) => {
    add({ kind: 'iso7089', size: 'M3', at: { instanceId: plateInst, edge: holeEdge(c, 'end') } });
    add({ kind: 'iso4762', size: 'M3', length: 10, at: { instanceId: plateInst, edge: holeEdge(c, 'end') } });
  });
  holes.ids.slice(0, 4).forEach((c) => {
    add({ kind: 'iso7089', size: 'M5', at: { instanceId: plateInst, edge: holeEdge(c, 'end') } });
    add({ kind: 'iso4762', size: 'M5', length: 16, at: { instanceId: plateInst, edge: holeEdge(c, 'end') } });
    add({ kind: 'iso7089', size: 'M5', at: { instanceId: plateInst, edge: holeEdge(c, 'start') } });
    add({ kind: 'iso4032', size: 'M5', at: { instanceId: plateInst, edge: holeEdge(c, 'start') } });
  });
  doc = { ...doc, assembly: { ...doc.assembly!, fasteners } };
  return doc;
}
