import { beforeAll, describe, expect, it } from 'vitest';
import { addFeature, findPart, makeChamferFeature, makeSketchFeature } from '../../src/domain/document';
import type { CadDocument, EngraveFeature } from '../../src/domain/model';
import { faceMaterials } from '../../src/domain/paint';
import { RecomputeEngine } from '../../src/features/engine';
import type { GeometryKernel } from '../../src/geometry/kernel';
import { getKernel } from '../helpers/kernel';
import { buildPlateDocument, holeSketch, topFrontEdge } from '../helpers/plate';

let kernel: GeometryKernel;
beforeAll(async () => {
  kernel = await getKernel();
});

/** Plaque percée, avec un disque Ø 8 marqué sur le dessus (profondeur 0) avant la poche. */
function markedPlate(extra = false, disc: readonly [number, number] = [45, 8]): { doc: CadDocument; engraveId: string; extrudeId: string; sketchId: string } {
  const { doc: plate, ids } = buildPlateDocument();
  const part = findPart(plate, ids.partId)!;
  const sketch = makeSketchFeature(plate, part, { kind: 'face', ref: { featureId: ids.extrude, role: 'end' } });
  const engrave: EngraveFeature = { id: 'engrave-1', type: 'engrave', name: 'Gravure 1', params: { sketchId: sketch.id, depth: 0, mode: 'fill' } };
  // Sketch et gravure insérés avant la poche : la poche est une opération booléenne faite ensuite.
  // Avec `extra`, un second disque Ø 6 : deux zones dans la même gravure.
  const first = holeSketch(sketch.params, disc[0], 15, disc[1]);
  let doc = addFeature(plate, ids.partId, { ...sketch, params: extra ? holeSketch(first, 30, 15, 6) : first });
  doc = addFeature(doc, ids.partId, engrave);
  const features = findPart(doc, ids.partId)!.features;
  const pocket = features.find((f) => f.id === ids.pocket)!;
  const ordered = [...features.filter((f) => f.id !== ids.pocket), pocket];
  doc = { ...doc, parts: doc.parts.map((p) => (p.id === ids.partId ? { ...p, features: ordered } : p)) };
  return { doc, engraveId: engrave.id, extrudeId: ids.extrude, sketchId: ids.sketch1 };
}

const evaluate = (doc: CadDocument) => new RecomputeEngine(kernel, { get: () => undefined }).evaluateDocument(doc)[0]!;

describe('marquage en surface (gravure de profondeur 0)', () => {
  it('ne gêne pas un chanfrein fait ensuite sur une arête du dessus', () => {
    const { doc, engraveId, extrudeId, sketchId } = markedPlate();
    const partId = doc.parts[0]!.id;
    const chamfer = makeChamferFeature(doc, findPart(doc, partId)!, [topFrontEdge(doc, sketchId, extrudeId)], 1);
    const ev = evaluate(addFeature(doc, partId, chamfer));
    expect(ev.failedFeatureId).toBeNull();
    expect(ev.statuses.every((st) => st.state === 'ok')).toBe(true);
    const mesh = kernel.mesh(ev.shape!, { linearDeflection: 0.05, angularDeflection: 0.3 });
    expect(mesh.faces.filter((f) => f.tags.some((t) => t.featureId === engraveId))).toHaveLength(1);
  });

  it('la zone marquée reste une face à part après une opération booléenne', () => {
    const { doc, engraveId, extrudeId } = markedPlate();
    const ev = evaluate(doc);
    expect(ev.failedFeatureId).toBeNull();
    const mesh = kernel.mesh(ev.shape!, { linearDeflection: 0.05, angularDeflection: 0.3 });
    const marked = mesh.faces.filter((f) => f.tags.some((t) => t.featureId === engraveId));
    const top = mesh.faces.filter((f) => f.tags.some((t) => t.featureId === extrudeId && t.role === 'end'));
    // Le disque marqué, et le reste du dessus (percé) : deux faces, une seule marquée.
    expect(marked).toHaveLength(1);
    expect(top).toHaveLength(2);
    // Couleur de la gravure : seulement le disque, même si le dessus est peint.
    const paint = { faces: [{ ref: { featureId: extrudeId, role: 'end' as const }, material: 'rouge' }] };
    const colors = faceMaterials(paint, mesh.faces, [{ featureId: engraveId, material: 'blanc' }]);
    expect(colors.filter((c) => c === 'blanc')).toHaveLength(1);
    expect(colors.filter((c) => c === 'rouge')).toHaveLength(1);
    // Peinte au pinceau (désignée par sa gravure), elle l'emporte sur sa couleur de gravure.
    const brushed = faceMaterials({ faces: [...paint.faces, { ref: { featureId: engraveId, role: 'end' as const, index: 0 }, material: 'noir' }] }, mesh.faces, [{ featureId: engraveId, material: 'blanc' }], new Set([engraveId]));
    expect(brushed.filter((c) => c === 'noir')).toHaveLength(1);
  });

  it('chaque zone d’une gravure se peint à part', () => {
    const { doc, engraveId } = markedPlate(true);
    const ev = evaluate(doc);
    expect(ev.failedFeatureId).toBeNull();
    const mesh = kernel.mesh(ev.shape!, { linearDeflection: 0.05, angularDeflection: 0.3 });
    const zones = mesh.faces.flatMap((f) => f.tags.filter((t) => t.featureId === engraveId));
    // Deux disques, deux zones numérotées.
    expect(zones.map((t) => t.index).sort()).toEqual([0, 1]);
    const paint = { faces: [{ ref: { featureId: engraveId, role: 'end' as const, index: 0 }, material: 'rouge' }, { ref: { featureId: engraveId, role: 'end' as const, index: 1 }, material: 'bleu' }] };
    const colors = faceMaterials(paint, mesh.faces, [], new Set([engraveId]));
    expect(colors.filter((c) => c === 'rouge')).toHaveLength(1);
    expect(colors.filter((c) => c === 'bleu')).toHaveLength(1);
  });

  it('une zone qui déborde sur un trou de la pièce reste désignée par sa gravure', () => {
    // Disque Ø 10 en (18, 15) : il chevauche le trou Ø 6 en (15, 15), la zone est rognée.
    const { doc, engraveId, extrudeId } = markedPlate(false, [18, 10]);
    const ev = evaluate(doc);
    expect(ev.failedFeatureId).toBeNull();
    const mesh = kernel.mesh(ev.shape!, { linearDeflection: 0.05, angularDeflection: 0.3 });
    const top = mesh.faces.filter((f) => f.tags.some((t) => t.featureId === extrudeId && t.role === 'end'));
    expect(top).toHaveLength(2);
    expect(top.filter((f) => f.tags.some((t) => t.featureId === engraveId))).toHaveLength(1);
  });
});
