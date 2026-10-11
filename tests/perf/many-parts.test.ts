/**
 * Projet chargé (npm run bench) : 30 pièces percées d'une grille de trous et un assemblage de
 * 30 instances serrées. Résultats : tests/output/many-parts.json et docs/performance.md.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { addFeature, addInstance, addPart, createDocument, findPart, makePatternFeature, makePrimitiveFeature } from '../../src/domain/document';
import type { CadDocument, Id } from '../../src/domain/model';
import { DISPLAY_MESH } from '../../src/domain/tolerances';
import { loadOpenCascade } from '../../src/geometry/occt/loader';
import { OcctKernel } from '../../src/geometry/occt/occt-kernel';
import { documentForWorker } from '../../src/geometry/protocol';
import { GeometryService, meshOptionsFor } from '../../src/workers/geometry-service';

export const PARTS = 30;

/** Bloc 40 × 30 × 10 percé d'une grille de 4 × 3 trous Ø 6 (répétition d'une forme creusée). */
export function blockPart(doc: CadDocument, partId: Id, width = 40): CadDocument {
  const box = makePrimitiveFeature(doc, findPart(doc, partId)!);
  doc = addFeature(doc, partId, { ...box, params: { ...box.params, width, depth: 30, height: 10 } });
  const hole = makePrimitiveFeature(doc, findPart(doc, partId)!, 'cylinder', 'cut');
  doc = addFeature(doc, partId, { ...hole, params: { ...hole.params, position: { x: 5, y: 7, z: 0 }, diameter: 6, height: 10 } });
  const pat = makePatternFeature(doc, findPart(doc, partId)!, hole.id, 'linear');
  return addFeature(doc, partId, { ...pat, params: { ...pat.params, count: 4, spacing: 10, second: { axis: { kind: 'axis', axis: 'Y' }, count: 3, spacing: 8, reversed: false } } });
}

/** 30 pièces et 30 instances en grille 6 × 5, espacées de 36 mm (les blocs de 40 mm se chevauchent). */
export function manyPartsDocument(): CadDocument {
  let doc = createDocument('Projet chargé');
  const ids: Id[] = [doc.parts[0]!.id];
  for (let i = 1; i < PARTS; i++) {
    const r = addPart(doc, `Pièce ${i + 1}`);
    doc = r.doc;
    ids.push(r.partId);
  }
  ids.forEach((id) => (doc = blockPart(doc, id)));
  ids.forEach((id, i) => (doc = addInstance(doc, id, { x: (i % 6) * 36, y: Math.floor(i / 6) * 28, z: 0 }).doc));
  return doc;
}

it('projet de 30 pièces et assemblage de 30 instances', async () => {
  const kernel = new OcctKernel(await loadOpenCascade());
  const service = new GeometryService(kernel);
  const doc = manyPartsDocument();
  const r: Record<string, number> = {};
  const mem0 = kernel.memoryBytes();

  let t = performance.now();
  const first = service.evaluate(documentForWorker(doc));
  r.coldEvaluateWithMeshesMs = +(performance.now() - t).toFixed(0);
  r.parts = first.parts.length;

  // Une seule pièce modifiée : les 29 autres viennent du cache.
  const edited = blockPart({ ...doc, parts: doc.parts.map((p, i) => (i === 0 ? { ...p, features: [] } : p)) }, doc.parts[0]!.id, 44);
  t = performance.now();
  service.evaluate(documentForWorker(edited), first.parts.map((p) => p.meshKey).filter((k): k is string => !!k));
  r.editOnePartMs = +(performance.now() - t).toFixed(0);

  // Toutes les pièces remaillées (export ou plateau d'impression).
  const evs = service.engine.evaluateDocument(edited);
  t = performance.now();
  for (const ev of evs) kernel.mesh(ev.shape!, meshOptionsFor(ev.analysis!.bbox, DISPLAY_MESH));
  r.meshAllPartsMs = +(performance.now() - t).toFixed(0);

  // Collisions de l'assemblage (instances voisines qui se chevauchent).
  const placements = (edited.assembly?.instances ?? []).map((inst) => ({
    instanceId: inst.id,
    partId: inst.partId,
    matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, inst.position.x, inst.position.y, inst.position.z, 1],
  }));
  t = performance.now();
  const col = service.collisions(documentForWorker(edited), placements);
  r.collisionsMs = +(performance.now() - t).toFixed(0);
  r.collisionPairs = col.collisions.length;
  // Une seule instance déplacée : seules ses paires sont recalculées.
  const moved = placements.map((p, i) => (i === 7 ? { ...p, matrix: p.matrix.map((v, k) => (k === 12 ? v + 2 : v)) } : p));
  t = performance.now();
  service.collisions(documentForWorker(edited), moved);
  r.collisionsAfterMovingOneMs = +(performance.now() - t).toFixed(0);

  r.wasmMiB = +(kernel.memoryBytes() / 2 ** 20).toFixed(0);
  r.wasmGrowthMiB = +((kernel.memoryBytes() - mem0) / 2 ** 20).toFixed(0);
  mkdirSync('tests/output', { recursive: true });
  writeFileSync('tests/output/many-parts.json', JSON.stringify(r, null, 2));
  console.log(JSON.stringify(r, null, 2));
  expect(r.parts).toBe(PARTS);
  // Garde-fous larges (voir docs/performance.md) : une pièce modifiée ou une instance déplacée ne
  // relance pas tout le projet.
  expect(r.editOnePartMs).toBeLessThan(500);
  expect(r.collisionsAfterMovingOneMs).toBeLessThan(1000);
  expect(r.wasmGrowthMiB).toBeLessThan(64);
}, 900_000);
