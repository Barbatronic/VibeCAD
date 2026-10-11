import Ajv2020 from 'ajv/dist/2020';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { addFeature, createDocument, findPart, makeExtrudeFeature, makePocketFeature, makePrimitiveFeature, makeSketchFeature } from '../../src/domain/document';
import type { CadDocument, Id, PocketExtent } from '../../src/domain/model';
import { RecomputeEngine } from '../../src/features/engine';
import type { GeometryKernel } from '../../src/geometry/kernel';
import { parseNativeFile, serializeDocument } from '../../src/io/native-format';
import { addCircle, addRectangle } from '../../src/sketch/model';
import { solveSketch } from '../../src/sketch/solver';
import { getKernel } from '../helpers/kernel';

let kernel: GeometryKernel;
beforeAll(async () => {
  kernel = await getKernel();
});

const evaluate = (doc: CadDocument) => new RecomputeEngine(kernel, { get: () => undefined }).evaluateDocument(doc)[0]!;

/** Boîte 20 × 20 × 20 et cercle Ø 6 esquissé à mi-hauteur (z = 10), poche « deux côtés ». */
function pocketDoc(extent: PocketExtent, extent2: PocketExtent): CadDocument {
  let doc = createDocument('Poche deux côtés');
  const partId = doc.parts[0]!.id;
  doc = addFeature(doc, partId, makePrimitiveFeature(doc, findPart(doc, partId)!));
  const sk = makeSketchFeature(doc, findPart(doc, partId)!, { kind: 'plane', plane: 'XY', offset: 10 });
  doc = addFeature(doc, partId, { ...sk, params: solveSketch(addCircle(sk.params, { x: 10, y: 10 }, 3).sketch).sketch });
  const po = makePocketFeature(doc, findPart(doc, partId)!, sk.id, extent, 'twoSides');
  return addFeature(doc, partId, { ...po, params: { ...po.params, extent2 } });
}

describe('extrusion et poche « deux côtés »', () => {
  it('extrusion de 4 mm côté normale et 2 mm de l’autre côté', () => {
    let doc = createDocument('Extrusion deux côtés');
    const partId: Id = doc.parts[0]!.id;
    const sk = makeSketchFeature(doc, findPart(doc, partId)!, { kind: 'plane', plane: 'XY', offset: 0 });
    doc = addFeature(doc, partId, { ...sk, params: solveSketch(addRectangle(sk.params, { x: 0, y: 0 }, { x: 10, y: 10 }).sketch).sketch });
    const ex = makeExtrudeFeature(doc, findPart(doc, partId)!, sk.id, 4, 'twoSides');
    doc = addFeature(doc, partId, { ...ex, params: { ...ex.params, distance2: 2 } });
    const res = evaluate(doc);
    expect(res.statuses.at(-1)!.state).toBe('ok');
    expect(res.analysis!.volume).toBeCloseTo(600, 6);
    expect(res.analysis!.bbox!.min.z).toBeCloseTo(-2, 9);
    expect(res.analysis!.bbox!.max.z).toBeCloseTo(4, 9);
    const parsed = parseNativeFile(serializeDocument(doc));
    expect(parsed.ok && parsed.doc).toEqual(doc);
  });

  it('poche de 4 mm dans la matière (vers le bas) et 2 mm de l’autre côté', () => {
    const res = evaluate(pocketDoc({ kind: 'distance', distance: 4 }, { kind: 'distance', distance: 2 }));
    expect(res.statuses.at(-1)!.state).toBe('ok');
    expect(res.analysis!.volume).toBeCloseTo(8000 - Math.PI * 9 * 6, 3);
  });

  it('poche de 4 mm d’un côté, traversante de l’autre', () => {
    const res = evaluate(pocketDoc({ kind: 'distance', distance: 4 }, { kind: 'throughAll' }));
    expect(res.statuses.at(-1)!.state).toBe('ok');
    expect(res.analysis!.volume).toBeCloseTo(8000 - Math.PI * 9 * 14, 3);
  });

  it('aller-retour du format natif et schéma JSON', () => {
    const doc = pocketDoc({ kind: 'throughAll' }, { kind: 'distance', distance: 3 });
    const text = serializeDocument(doc, '2026-10-11T12:00:00.000Z');
    const parsed = parseNativeFile(text);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.doc).toEqual(doc);
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(JSON.parse(readFileSync('docs/vibecad.schema.json', 'utf8')));
    validate(JSON.parse(text));
    expect(validate.errors ?? []).toEqual([]);
  });
});
