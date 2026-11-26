import Ajv2020 from 'ajv/dist/2020';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { addFeature, createDocument, findPart, makeExtrudeFeature, makePocketFeature, makePrimitiveFeature, makeSketchFeature } from '../../src/domain/document';
import type { CadDocument, ExtrudeParams, Id, PocketParams } from '../../src/domain/model';
import { RecomputeEngine } from '../../src/features/engine';
import { extrudeDefinition } from '../../src/features/extrude/definition';
import { pocketDefinition } from '../../src/features/pocket/definition';
import type { GeometryKernel } from '../../src/geometry/kernel';
import { parseNativeFile, serializeDocument } from '../../src/io/native-format';
import { addCircle } from '../../src/sketch/model';
import { solveSketch } from '../../src/sketch/solver';
import { getKernel } from '../helpers/kernel';

let kernel: GeometryKernel;
beforeAll(async () => {
  kernel = await getKernel();
});

/** Cercle r = 5 sur le plan XY (z = 0), extrudé avec les paramètres donnés. */
function circleExtrude(params: Partial<ExtrudeParams>, doc = createDocument('Décalage')): { doc: CadDocument; id: Id } {
  const partId = doc.parts[0]!.id;
  const sk = makeSketchFeature(doc, findPart(doc, partId)!, { kind: 'plane', plane: 'XY', offset: 0 });
  let d = addFeature(doc, partId, { ...sk, params: solveSketch(addCircle(sk.params, { x: 10, y: 10 }, 5).sketch).sketch });
  const ex = makeExtrudeFeature(d, findPart(d, partId)!, sk.id, 10);
  d = addFeature(d, partId, { ...ex, params: { ...ex.params, ...params } });
  return { doc: d, id: ex.id };
}

function evaluate(doc: CadDocument) {
  const [res] = new RecomputeEngine(kernel, { get: () => undefined }).evaluateDocument(doc);
  return res!;
}

describe('extrusion avec décalage du départ', () => {
  it('décalage positif, négatif, symétrique : le cylindre est déplacé le long de la normale', () => {
    for (const [params, zMin, zMax] of [
      [{ offset: 3 }, 3, 13],
      [{ offset: -4 }, -4, 6],
      [{ offset: 2, direction: 'reversed' }, -8, 2],
      [{ offset: 5, direction: 'symmetric' }, 0, 10],
    ] as const) {
      const res = evaluate(circleExtrude(params).doc);
      expect(res.statuses.at(-1)!.state).toBe('ok');
      expect(res.analysis!.volume).toBeCloseTo(Math.PI * 25 * 10, 3);
      expect(res.analysis!.bbox!.min.z).toBeCloseTo(zMin, 6);
      expect(res.analysis!.bbox!.max.z).toBeCloseTo(zMax, 6);
    }
  });

  it('jusqu’à une face : départ décalé, arrivée sur la face', () => {
    let doc = createDocument('Jusqu’à une face');
    const partId = doc.parts[0]!.id;
    const pr = makePrimitiveFeature(doc, findPart(doc, partId)!);
    // Dalle 40 × 40 × 2 posée à z = 20.
    doc = addFeature(doc, partId, { ...pr, params: { ...pr.params, position: { x: -10, y: -10, z: 20 }, width: 40, depth: 40, height: 2 } });
    const s = circleExtrude({ offset: 5, upTo: { featureId: pr.id, role: 'start' } }, doc);
    const res = evaluate(s.doc);
    expect(res.statuses.at(-1)!.state).toBe('ok');
    expect(kernel.analyze(res.tools.get(s.id)!).volume).toBeCloseTo(Math.PI * 25 * 15, 3);
    expect(res.analysis!.bbox!.min.z).toBeCloseTo(5, 6);
  });

  it('validation, résumé, aller-retour du format natif et schéma JSON', () => {
    const s = circleExtrude({ offset: -2.5 });
    const f = findPart(s.doc, s.doc.parts[0]!.id)!.features.find((x) => x.id === s.id)!;
    if (f.type !== 'extrude') throw new Error('extrusion attendue');
    expect(extrudeDefinition.summary(f)).toContain('décalage');
    expect(extrudeDefinition.validate({ ...f, params: { ...f.params, offset: Number.NaN } })[0]?.field).toBe('offset');
    const text = serializeDocument(s.doc, '2026-11-26T12:00:00.000Z');
    const parsed = parseNativeFile(text);
    expect(parsed.ok ? [] : parsed).toEqual([]);
    if (parsed.ok) expect(parsed.doc).toEqual(s.doc);
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(JSON.parse(readFileSync('docs/vibecad.schema.json', 'utf8')));
    validate(JSON.parse(text));
    expect(validate.errors ?? []).toEqual([]);
  });
});

/** Bloc 40 × 40 × 20 (z 0 → 20) et poche circulaire r = 5 esquissée sur son dessus (z = 20). */
function blockPocket(params: Partial<PocketParams>): { doc: CadDocument; id: Id } {
  let doc = createDocument('Poche décalée');
  const partId = doc.parts[0]!.id;
  const pr = makePrimitiveFeature(doc, findPart(doc, partId)!);
  doc = addFeature(doc, partId, { ...pr, params: { ...pr.params, position: { x: -10, y: -10, z: 0 }, width: 40, depth: 40, height: 20 } });
  const sk = makeSketchFeature(doc, findPart(doc, partId)!, { kind: 'plane', plane: 'XY', offset: 20 });
  doc = addFeature(doc, partId, { ...sk, params: solveSketch(addCircle(sk.params, { x: 10, y: 10 }, 5).sketch).sketch });
  const po = makePocketFeature(doc, findPart(doc, partId)!, sk.id, { kind: 'distance', distance: 5 }, 'default');
  doc = addFeature(doc, partId, { ...po, params: { ...po.params, ...params } });
  return { doc, id: po.id };
}

describe('poche avec décalage du départ', () => {
  const block = 40 * 40 * 20;
  const hole = (h: number) => Math.PI * 25 * h;

  it('décalage négatif : cavité interne de 5 mm sous une peau de 3 mm ; traversante décalée', () => {
    const inner = evaluate(blockPocket({ offset: -3 }).doc);
    expect(inner.statuses.at(-1)!.state).toBe('ok');
    expect(inner.analysis!.volume).toBeCloseTo(block - hole(5), 3);
    const through = evaluate(blockPocket({ offset: -8, extent: { kind: 'throughAll' } }).doc);
    expect(through.statuses.at(-1)!.state).toBe('ok');
    // Traversante depuis z = 12 vers le bas : 12 mm de matière retirés.
    expect(through.analysis!.volume).toBeCloseTo(block - hole(12), 3);
  });

  it('décalage au-dessus de la pièce : rien n’est retiré, l’avertissement le signale', () => {
    const res = evaluate(blockPocket({ offset: 10 }).doc);
    expect(res.statuses.at(-1)).toMatchObject({ state: 'warning', code: 'POCKET_REMOVES_NOTHING' });
  });

  it('validation, résumé, aller-retour du format natif et schéma JSON', () => {
    const s = blockPocket({ offset: -3 });
    const f = findPart(s.doc, s.doc.parts[0]!.id)!.features.find((x) => x.id === s.id)!;
    if (f.type !== 'pocket') throw new Error('poche attendue');
    expect(pocketDefinition.summary(f)).toContain('décalage');
    expect(pocketDefinition.validate({ ...f, params: { ...f.params, offset: Number.POSITIVE_INFINITY } })[0]?.field).toBe('offset');
    const text = serializeDocument(s.doc, '2026-11-26T12:00:00.000Z');
    const parsed = parseNativeFile(text);
    expect(parsed.ok ? [] : parsed).toEqual([]);
    if (parsed.ok) expect(parsed.doc).toEqual(s.doc);
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(JSON.parse(readFileSync('docs/vibecad.schema.json', 'utf8')));
    validate(JSON.parse(text));
    expect(validate.errors ?? []).toEqual([]);
  });
});
