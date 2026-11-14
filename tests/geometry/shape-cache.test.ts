/**
 * Cache des formes : une pièce reprise d'un instantané (forme finale relue avec ses étiquettes de
 * faces, statuts, esquisses) donne le même résultat que son historique rejoué, sert d'appui aux
 * autres pièces, et une étape modifiée fait bien recalculer.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { addFeature, addPart, createDocument, findPart, makeExtrudeFeature, makePrimitiveFeature, makeSketchFeature, updateFeature } from '../../src/domain/document';
import type { CadDocument } from '../../src/domain/model';
import { RecomputeEngine, type PartSnapshot } from '../../src/features/engine';
import type { GeometryKernel } from '../../src/geometry/kernel';
import { parseNativeFile } from '../../src/io/native-format';
import { addRectangle } from '../../src/sketch/model';
import { getKernel } from '../helpers/kernel';

let kernel: GeometryKernel;
beforeAll(async () => {
  kernel = await getKernel();
});

const engine = () => new RecomputeEngine(kernel, { get: () => undefined });

/** Instantanés de toutes les pièces d'un document, comme le worker les enregistre (passés par JSON). */
function snapshotsOf(doc: CadDocument): [string, PartSnapshot][] {
  const e = engine();
  const evs = e.evaluateDocument(doc);
  return doc.parts.flatMap((p, i) => {
    const s = e.snapshotOf(p, evs[i]!);
    return s ? [[s.key, JSON.parse(JSON.stringify(s.snap)) as PartSnapshot] as [string, PartSnapshot]] : [];
  });
}

describe('cache des formes', () => {
  it('roulement de la bibliothèque : repris du cache, même volume, mêmes faces étiquetées, sans rejouer son historique', () => {
    const parsed = parseNativeFile(readFileSync('tests/fixtures/library/bearings/608-2rs.vibecad', 'utf8'));
    if (!parsed.ok) throw new Error('fixture');
    const doc = parsed.doc;
    const reference = engine().evaluateDocument(doc)[0]!;
    const snaps = snapshotsOf(doc);
    expect(snaps).toHaveLength(1);
    const e = engine();
    e.preloadSnapshots(snaps);
    const t0 = performance.now();
    const restored = e.evaluateDocument(doc)[0]!;
    const ms = performance.now() - t0;
    expect(restored.fromCache).toBe(true);
    expect(restored.analysis!.volume).toBeCloseTo(reference.analysis!.volume, 6);
    expect(restored.statuses).toEqual(reference.statuses);
    expect(restored.sketches.map((s) => s.dof)).toEqual(reference.sketches.map((s) => s.dof));
    expect(restored.shapeKey).toBe(reference.shapeKey);
    expect(ms).toBeLessThan(500);
    // Même maillage d'affichage : mêmes faces, mêmes étiquettes.
    const options = { linearDeflection: 0.05, angularDeflection: 0.3 };
    const a = engine();
    const meshA = a.meshOf(a.evaluateDocument(doc)[0]!, options)!;
    const meshB = e.meshOf(restored, options)!;
    expect(meshB.faces.map((f) => f.tags)).toEqual(meshA.faces.map((f) => f.tags));
  });

  it('une autre pièce s’appuie encore sur une face de la pièce reprise', () => {
    let doc = createDocument('Deux pièces');
    const a = doc.parts[0]!.id;
    const box = makePrimitiveFeature(doc, findPart(doc, a)!, 'box');
    doc = addFeature(doc, a, { ...box, params: { ...box.params, width: 40, depth: 30, height: 10 } });
    // Historique assez long pour mériter le cache : des boîtes empilées.
    for (let i = 0; i < 10; i++) {
      const more = makePrimitiveFeature(doc, findPart(doc, a)!, 'box');
      doc = addFeature(doc, a, { ...more, params: { ...more.params, width: 5, depth: 5, height: 2, position: { x: 30, y: 20, z: 10 + i * 2 } } });
    }
    const added = addPart(doc, 'B');
    doc = added.doc;
    const b = added.partId;
    const sk = makeSketchFeature(doc, findPart(doc, b)!, { kind: 'face', ref: { featureId: box.id, role: 'end' }, partId: a });
    doc = addFeature(doc, b, { ...sk, params: addRectangle(sk.params, { x: 5, y: 5 }, { x: 15, y: 15 }).sketch });
    doc = addFeature(doc, b, makeExtrudeFeature(doc, findPart(doc, b)!, sk.id, 5));
    const snaps = snapshotsOf(doc);
    // B dépend de A : seule A va au cache.
    expect(snaps).toHaveLength(1);
    const e = engine();
    e.preloadSnapshots(snaps);
    const [ra, rb] = e.evaluateDocument(doc);
    expect(ra!.fromCache).toBe(true);
    expect(rb!.statuses.map((s) => s.state)).toEqual(['ok', 'ok']);
    expect(rb!.analysis!.bbox!.min.z).toBeCloseTo(10, 6);

    // Une étape de A modifiée : A est recalculée (l'instantané ne correspond plus).
    const changed = updateFeature(doc, box.id, (f) => (f.type === 'primitive' ? { ...f, params: { ...f.params, height: 12 } } : f));
    const [ca, cb] = e.evaluateDocument(changed);
    expect(ca!.fromCache).toBeFalsy();
    expect(cb!.analysis!.bbox!.min.z).toBeCloseTo(12, 6);
  });

  it('instantané illisible : la pièce est simplement recalculée', () => {
    const parsed = parseNativeFile(readFileSync('tests/fixtures/library/bearings/608-2rs.vibecad', 'utf8'));
    if (!parsed.ok) throw new Error('fixture');
    const [[key, snap]] = snapshotsOf(parsed.doc) as [[string, PartSnapshot]];
    const e = engine();
    e.preloadSnapshots([[key, { ...snap, shape: { brep: 'pas une forme', tags: [] } }]]);
    const ev = e.evaluateDocument(parsed.doc)[0]!;
    expect(ev.fromCache).toBeFalsy();
    expect(ev.analysis!.solidCount).toBe(1);
  });
});
