import { beforeAll, describe, expect, it } from 'vitest';
import {
  addFeature,
  addPart,
  addResource,
  findPart,
  makeExtrudeFeature,
  makeImportedSolidFeature,
  makePocketFeature,
  makeSketchFeature,
  newResourceId,
} from '../../src/domain/document';
import type { CadDocument } from '../../src/domain/model';
import { RecomputeEngine, type PartEvaluation } from '../../src/features/engine';
import type { GeometryKernel } from '../../src/geometry/kernel';
import { parseNativeFile, serializeDocument } from '../../src/io/native-format';
import { createResourceProvider, createStepResource, stepProductNames } from '../../src/io/resources';
import { meshesToBinaryStl, readBinaryStl } from '../../src/io/stl';
import { getKernel } from '../helpers/kernel';
import { buildPlateDocument, holeSketch, rectangleSketch } from '../helpers/plate';

let kernel: GeometryKernel;
beforeAll(async () => {
  kernel = await getKernel();
});

const PLATE = 9000 - Math.PI * 9 * 5;

function exportParts(doc: CadDocument, results: PartEvaluation[], partIds: string[]): string {
  return kernel.exportStep(
    partIds.map((id) => {
      const part = findPart(doc, id)!;
      return { name: part.name, color: part.color, shape: results.find((r) => r.partId === id)!.shape! };
    }),
  );
}

/** Ajoute une seconde pièce : une cale 20 × 20 × 10 placée à x = 100. */
function withSecondPart(doc: CadDocument): { doc: CadDocument; partId: string } {
  const added = addPart(doc, 'Cale');
  let next = added.doc;
  let part = findPart(next, added.partId)!;
  const sk = makeSketchFeature(next, part, { kind: 'plane', plane: 'XY', offset: 0 });
  const rect = rectangleSketch(sk.params, 20, 20);
  // Décale le rectangle : on remplace la coïncidence avec l'origine par des cotes de position.
  const constraints = rect.sketch.constraints.map((c) =>
    c.type === 'coincident' && c.a === 'origin' ? { id: c.id, type: 'distanceX' as const, a: 'origin', b: c.b, value: 100 } : c,
  );
  const params = { ...rect.sketch, constraints: [...constraints, { id: 'k99', type: 'distanceY' as const, a: 'origin', b: 'p1', value: 0 }] };
  next = addFeature(next, added.partId, { ...sk, params });
  part = findPart(next, added.partId)!;
  next = addFeature(next, added.partId, makeExtrudeFeature(next, part, sk.id, 10));
  return { doc: next, partId: added.partId };
}

describe('échanges STEP', () => {
  it('exporte un vrai solide nommé, en millimètres, et le relit avec le même volume', () => {
    const { doc, ids } = buildPlateDocument();
    const engine = new RecomputeEngine(kernel, { get: () => undefined });
    const results = engine.evaluateDocument(doc);
    const step = exportParts(doc, results, [ids.partId]);
    expect(step).toMatch(/^ISO-10303-21;/);
    expect(step).toMatch(/FILE_SCHEMA\s*\(\s*\(\s*'AUTOMOTIVE_DESIGN/);
    expect(step).toMatch(/SI_UNIT\(\.MILLI\.,\.METRE\.\)/);
    expect(stepProductNames(new TextEncoder().encode(step))).toEqual(['Pièce 1']);
    expect(step).toMatch(/MANIFOLD_SOLID_BREP/);
    const back = kernel.readStep(new TextEncoder().encode(step));
    expect(back.solids).toHaveLength(1);
    const a = kernel.analyze(back.solids[0]!);
    expect(a.valid).toBe(true);
    expect(a.volume).toBeCloseTo(PLATE, 4);
    expect(a.bbox!.max.x).toBeCloseTo(60, 5);
    back.solids.forEach((s) => kernel.dispose(s));
  });

  it('exporte deux pièces nommées séparément ou ensemble', () => {
    const plate = buildPlateDocument();
    const { doc, partId } = withSecondPart(plate.doc);
    const engine = new RecomputeEngine(kernel, { get: () => undefined });
    const results = engine.evaluateDocument(doc);
    expect(results.every((r) => r.failedFeatureId === null)).toBe(true);
    expect(results[1]!.analysis!.volume).toBeCloseTo(4000, 6);
    expect(results[1]!.analysis!.bbox!.min.x).toBeCloseTo(100, 6);
    const both = exportParts(doc, results, [plate.ids.partId, partId]);
    expect(stepProductNames(new TextEncoder().encode(both)).sort()).toEqual(['Cale', 'Pièce 1']);
    const onlyCale = exportParts(doc, results, [partId]);
    expect(stepProductNames(new TextEncoder().encode(onlyCale))).toEqual(['Cale']);
    const back = kernel.readStep(new TextEncoder().encode(both));
    expect(back.solids.map((s) => Math.round(kernel.analyze(s).volume * 1000) / 1000).sort((a, b) => a - b)).toEqual([
      4000,
      Math.round(PLATE * 1000) / 1000,
    ]);
    back.solids.forEach((s) => kernel.dispose(s));
  });

  it('conserve un STEP importé dans le projet après enregistrement et réouverture, sans le fichier source', async () => {
    // 1. Fabrique un fichier STEP « externe ».
    const source = buildPlateDocument();
    const engine0 = new RecomputeEngine(kernel, { get: () => undefined });
    const stepText = exportParts(source.doc, engine0.evaluateDocument(source.doc), [source.ids.partId]);
    const bytes = new TextEncoder().encode(stepText);

    // 2. L'importe dans un nouveau document comme « Solide importé ».
    let doc = buildPlateDocument().doc;
    const added = addPart(doc, 'Plaque importée');
    doc = added.doc;
    const resource = await createStepResource(newResourceId(doc), 'plaque.step', bytes);
    expect(resource.encoding).toBe('utf8');
    doc = addResource(doc, resource);
    const part = findPart(doc, added.partId)!;
    const imported = makeImportedSolidFeature(doc, part, resource.id, 0, 'Plaque (STEP)');
    doc = addFeature(doc, added.partId, imported);

    // 3. Ajoute un perçage sur la face supérieure du solide importé (référence « imported »).
    const engine1 = new RecomputeEngine(kernel, createResourceProvider(doc.resources));
    const [, importedPart] = engine1.evaluateDocument(doc);
    expect(importedPart!.statuses[0]!.state).toBe('ok');
    expect(importedPart!.analysis!.volume).toBeCloseTo(PLATE, 4);
    const mesh = engine1.meshOf(importedPart!, { linearDeflection: 0.05, angularDeflection: 0.3 })!;
    const top = mesh.faces.find((f) => f.surface === 'plane' && f.plane!.normal.z > 0.99)!;
    const topRef = top.tags.find((t) => t.role === 'imported')!;
    let p2 = findPart(doc, added.partId)!;
    const sk = makeSketchFeature(doc, p2, { kind: 'face', ref: topRef });
    doc = addFeature(doc, added.partId, { ...sk, params: holeSketch(sk.params, 45, 15, 4) });
    p2 = findPart(doc, added.partId)!;
    doc = addFeature(doc, added.partId, makePocketFeature(doc, p2, sk.id, { kind: 'throughAll' }));
    const [, drilled] = engine1.evaluateDocument(doc);
    expect(drilled!.statuses.map((s) => s.state)).toEqual(['ok', 'ok', 'ok']);
    expect(drilled!.analysis!.volume).toBeCloseTo(PLATE - Math.PI * 4 * 5, 4);

    // 4. Enregistre puis rouvre : aucune dépendance au fichier d'origine.
    const text = serializeDocument(doc);
    const reopened = parseNativeFile(text);
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(Object.keys(reopened.doc.resources)).toEqual([resource.id]);
    const engine2 = new RecomputeEngine(kernel, createResourceProvider(reopened.doc.resources));
    const [, again] = engine2.evaluateDocument(reopened.doc);
    expect(again!.statuses.every((s) => s.state === 'ok')).toBe(true);
    expect(again!.analysis!.volume).toBeCloseTo(PLATE - Math.PI * 4 * 5, 4);
    engine0.clear();
    engine1.clear();
    engine2.clear();
  });

  it('exporte un STL binaire en millimètres dont le volume correspond au solide', () => {
    const { doc } = buildPlateDocument();
    const engine = new RecomputeEngine(kernel, { get: () => undefined });
    const [part] = engine.evaluateDocument(doc);
    const mesh = engine.meshOf(part!, { linearDeflection: 0.01, angularDeflection: 0.1 })!;
    const stl = meshesToBinaryStl([mesh]);
    const read = readBinaryStl(stl);
    expect(read.triangles).toBe(mesh.indices.length / 3);
    expect(Math.abs(read.volume - PLATE) / PLATE).toBeLessThan(0.002);
    expect(new TextDecoder().decode(stl.subarray(0, 80))).toMatch(/millimetres/);
  });
});
