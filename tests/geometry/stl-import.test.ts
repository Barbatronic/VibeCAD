import Ajv2020 from 'ajv/dist/2020';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { addFeature, addPart, addResource, createDocument, findPart, makeImportedSolidFeature, makePocketFeature, makeSketchFeature, newResourceId } from '../../src/domain/document';
import type { CadDocument } from '../../src/domain/model';
import { RecomputeEngine } from '../../src/features/engine';
import type { GeometryKernel } from '../../src/geometry/kernel';
import { parseNativeFile, serializeDocument } from '../../src/io/native-format';
import { createResourceProvider, createStepResource } from '../../src/io/resources';
import { meshesToBinaryStl, stlTriangleCount } from '../../src/io/stl';
import { getKernel } from '../helpers/kernel';
import { holeSketch } from '../helpers/plate';

let kernel: GeometryKernel;
beforeAll(async () => {
  kernel = await getKernel();
});

/** STL binaire d'une boîte 40 × 20 × 10 (12 triangles), exporté par VibeCAD. */
function boxStl(): Uint8Array {
  const box = kernel.makePrimitive({ featureId: 'b', shape: 'box', position: { x: 0, y: 0, z: 0 }, width: 40, depth: 20, height: 10, diameter: 1, thickness: 1 });
  try {
    return meshesToBinaryStl([kernel.mesh(box, { linearDeflection: 0.1, angularDeflection: 0.3 })]);
  } finally {
    kernel.dispose(box);
  }
}

/** Même boîte en STL texte. */
function asciiFrom(binary: Uint8Array): Uint8Array {
  const view = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
  const n = view.getUint32(80, true);
  let text = 'solid boite\n';
  for (let t = 0; t < n; t++) {
    const o = 84 + t * 50;
    const f = (k: number) => view.getFloat32(o + k * 4, true);
    text += `facet normal ${f(0)} ${f(1)} ${f(2)}\n outer loop\n`;
    for (let v = 0; v < 3; v++) text += `  vertex ${f(3 + v * 3)} ${f(4 + v * 3)} ${f(5 + v * 3)}\n`;
    text += ' endloop\nendfacet\n';
  }
  return new TextEncoder().encode(`${text}endsolid boite\n`);
}

async function withStl(bytes: Uint8Array, name: string): Promise<{ doc: CadDocument; partId: string }> {
  let doc = createDocument('Import STL');
  const added = addPart(doc, 'Boîte importée');
  doc = added.doc;
  const resource = await createStepResource(newResourceId(doc), name, bytes, undefined, 'stl');
  doc = addResource(doc, resource);
  doc = addFeature(doc, added.partId, makeImportedSolidFeature(doc, findPart(doc, added.partId)!, resource.id, 0, 'Boîte (STL)'));
  return { doc, partId: added.partId };
}

describe('import STL', () => {
  it('compte les triangles d’un STL binaire ou texte', () => {
    const bin = boxStl();
    expect(stlTriangleCount(bin)).toBe(12);
    expect(stlTriangleCount(asciiFrom(bin))).toBe(12);
  });

  it('boîte STL binaire : solide valide, six faces planes reconstituées, perçable', async () => {
    let { doc, partId } = await withStl(boxStl(), 'boite.stl');
    const engine = new RecomputeEngine(kernel, createResourceProvider(doc.resources));
    const res = engine.evaluateDocument(doc).find((p) => p.partId === partId)!;
    expect(res.statuses[0]!.state).toBe('ok');
    expect(res.analysis!.valid).toBe(true);
    expect(res.analysis!.volume).toBeCloseTo(8000, 3);
    const mesh = engine.meshOf(res, { linearDeflection: 0.05, angularDeflection: 0.3 })!;
    expect(mesh.faces.length).toBe(6);
    // Perçage sur la face du dessus, désignée comme une face de solide importé.
    const top = mesh.faces.find((f) => f.surface === 'plane' && f.plane!.normal.z > 0.99)!;
    const sk = makeSketchFeature(doc, findPart(doc, partId)!, { kind: 'face', ref: top.tags.find((t) => t.role === 'imported')! });
    doc = addFeature(doc, partId, { ...sk, params: holeSketch(sk.params, 20, 10, 3) });
    doc = addFeature(doc, partId, makePocketFeature(doc, findPart(doc, partId)!, sk.id, { kind: 'throughAll' }));
    const drilled = engine.evaluateDocument(doc).find((p) => p.partId === partId)!;
    expect(drilled.statuses.map((s) => s.state)).toEqual(['ok', 'ok', 'ok']);
    expect(drilled.analysis!.volume).toBeCloseTo(8000 - Math.PI * 1.5 * 1.5 * 10, 3);
  });

  it('boîte STL texte : même résultat ; le fichier voyage dans le projet (format et schéma)', async () => {
    const { doc, partId } = await withStl(asciiFrom(boxStl()), 'boite-texte.stl');
    const text = serializeDocument(doc, '2026-10-11T12:00:00.000Z');
    const parsed = parseNativeFile(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(Object.values(parsed.doc.resources)[0]!.kind).toBe('stl');
    const res = new RecomputeEngine(kernel, createResourceProvider(parsed.doc.resources)).evaluateDocument(parsed.doc).find((p) => p.partId === partId)!;
    expect(res.analysis!.volume).toBeCloseTo(8000, 3);
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(JSON.parse(readFileSync('docs/vibecad.schema.json', 'utf8')));
    validate(JSON.parse(text));
    expect(validate.errors ?? []).toEqual([]);
  });

  it('maillage ouvert (une face manquante) : erreur expliquée', async () => {
    const bin = boxStl();
    // On retire les deux derniers triangles : la boîte a un trou.
    const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
    const holed = bin.slice(0, 84 + 10 * 50);
    new DataView(holed.buffer).setUint32(80, 10, true);
    expect(view.getUint32(80, true)).toBe(12);
    const { doc, partId } = await withStl(holed, 'troue.stl');
    const res = new RecomputeEngine(kernel, createResourceProvider(doc.resources)).evaluateDocument(doc).find((p) => p.partId === partId)!;
    expect(res.statuses[0]!.state).toBe('error');
  });

  it('boule STL de 4 000 triangles : lecture et maillage en quelques secondes (pas de temps quadratique)', () => {
    const ball = kernel.makePrimitive({ featureId: 'b', shape: 'sphere', position: { x: 0, y: 0, z: 0 }, width: 1, depth: 1, height: 1, diameter: 40, thickness: 1 });
    const stl = meshesToBinaryStl([kernel.mesh(ball, { linearDeflection: 0.05, angularDeflection: 0.15 })]);
    kernel.dispose(ball);
    expect(stlTriangleCount(stl)).toBeGreaterThan(3000);
    const t0 = performance.now();
    const read = kernel.readStl(stl);
    const mesh = kernel.mesh(read.solids[0]!, { linearDeflection: 0.1, angularDeflection: 0.3 });
    const elapsed = performance.now() - t0;
    expect(mesh.faces.length).toBeGreaterThan(3000);
    // Avant correction, le maillage seul prenait une quinzaine de secondes (recherche d'arêtes quadratique).
    expect(elapsed).toBeLessThan(8000);
    read.solids.forEach((x) => kernel.dispose(x));
  }, 60_000);
});
