import Ajv2020 from 'ajv/dist/2020';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { addFeature, createDocument, findPart, makePatternFeature, makePrimitiveFeature, makeSketchFeature } from '../../src/domain/document';
import type { CadDocument, PrimitiveFeature, PrimitiveParams } from '../../src/domain/model';
import { RecomputeEngine } from '../../src/features/engine';
import type { GeometryKernel } from '../../src/geometry/kernel';
import { parseNativeFile, serializeDocument } from '../../src/io/native-format';
import { getKernel } from '../helpers/kernel';

let kernel: GeometryKernel;
beforeAll(async () => {
  kernel = await getKernel();
});

function withPrimitive(doc: CadDocument, params: Partial<PrimitiveParams>): { doc: CadDocument; id: string } {
  const part = doc.parts[0]!;
  const base = makePrimitiveFeature(doc, findPart(doc, part.id)!);
  const f: PrimitiveFeature = { ...base, params: { ...base.params, ...params } };
  return { doc: addFeature(doc, part.id, f), id: f.id };
}

function evaluate(doc: CadDocument) {
  const engine = new RecomputeEngine(kernel, { get: () => undefined });
  const [res] = engine.evaluateDocument(doc);
  return { res: res!, engine };
}

describe('formes toutes faites', () => {
  it('boîte, cylindre, boule et anneau aux volumes exacts, à la bonne place', () => {
    const cases: [Partial<PrimitiveParams>, number][] = [
      [{ shape: 'box', width: 30, depth: 20, height: 10 }, 6000],
      [{ shape: 'cylinder', diameter: 20, height: 15 }, Math.PI * 100 * 15],
      [{ shape: 'sphere', diameter: 20 }, (4 / 3) * Math.PI * 1000],
      [{ shape: 'torus', diameter: 30, thickness: 6 }, 2 * Math.PI * Math.PI * 15 * 9],
    ];
    for (const [params, volume] of cases) {
      const { doc } = withPrimitive(createDocument('Forme'), { ...params, position: { x: 5, y: -5, z: 2 } });
      const { res } = evaluate(doc);
      expect(res.statuses.at(-1)!.state).toBe('ok');
      expect(res.analysis!.valid).toBe(true);
      expect(res.analysis!.volume).toBeCloseTo(volume, 1);
    }
    const { res } = evaluate(withPrimitive(createDocument('Boîte'), { shape: 'box', width: 30, depth: 20, height: 10, position: { x: 5, y: -5, z: 2 } }).doc);
    expect(res.analysis!.bbox).toEqual({ min: { x: 5, y: -5, z: 2 }, max: { x: 35, y: 15, z: 12 } });
  });

  it('creuser une boule dans une boîte, puis répéter le creux', () => {
    let { doc } = withPrimitive(createDocument('Bac'), { shape: 'box', width: 60, depth: 20, height: 10 });
    const hole = withPrimitive(doc, { shape: 'sphere', diameter: 10, position: { x: 10, y: 10, z: 10 }, operation: 'cut' });
    doc = hole.doc;
    const half = ((4 / 3) * Math.PI * 125) / 2;
    expect(evaluate(doc).res.analysis!.volume).toBeCloseTo(12000 - half, 1);
    const base = makePatternFeature(doc, doc.parts[0]!, hole.id);
    doc = addFeature(doc, doc.parts[0]!.id, { ...base, params: { ...base.params, count: 3, spacing: 20 } });
    const { res } = evaluate(doc);
    expect(res.statuses.at(-1)!.state).toBe('ok');
    expect(res.analysis!.volume).toBeCloseTo(12000 - 3 * half, 1);
  });

  it('creuser sans volume : erreur expliquée', () => {
    const { doc } = withPrimitive(createDocument('Vide'), { operation: 'cut' });
    expect(evaluate(doc).res.statuses.at(-1)).toMatchObject({ state: 'error', code: 'POCKET_WITHOUT_SOLID' });
  });

  it('une esquisse peut se poser sur le dessus de la boîte', () => {
    const { doc, id } = withPrimitive(createDocument('Boîte'), { shape: 'box', width: 30, depth: 20, height: 10 });
    const sk = makeSketchFeature(doc, doc.parts[0]!, { kind: 'face', ref: { featureId: id, role: 'end' } });
    const { res } = evaluate(addFeature(doc, doc.parts[0]!.id, sk));
    const frame = res.sketches.find((s) => s.featureId === sk.id)!.frame!;
    expect(frame.origin.z).toBeCloseTo(10, 9);
    expect(frame.normal.z).toBeCloseTo(1, 9);
  });

  it('aller-retour du format natif et schéma JSON', () => {
    const { doc } = withPrimitive(createDocument('Anneau'), { shape: 'torus', diameter: 40, thickness: 8, position: { x: 1, y: 2, z: 3 } });
    const text = serializeDocument(doc, '2026-10-10T12:00:00.000Z');
    const parsed = parseNativeFile(text);
    expect(parsed.ok && parsed.doc).toEqual(doc);
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(JSON.parse(readFileSync('docs/vibecad.schema.json', 'utf8')));
    validate(JSON.parse(text));
    expect(validate.errors ?? []).toEqual([]);
  });

  it('garder (intersection) : une boîte arrondie par une boule, et rien en commun refusé', () => {
    let { doc } = withPrimitive(createDocument('Dé'), { shape: 'box', width: 20, depth: 20, height: 20, position: { x: -10, y: -10, z: -10 } });
    doc = withPrimitive(doc, { shape: 'sphere', diameter: 26, operation: 'common' }).doc;
    const res = evaluate(doc).res;
    expect(res.statuses.at(-1)!.state).toBe('ok');
    expect(res.analysis!.valid).toBe(true);
    // Plus petit que la boîte et que la boule, et toujours limité par la boîte.
    expect(res.analysis!.volume).toBeLessThan(8000);
    expect(res.analysis!.volume).toBeLessThan((4 / 3) * Math.PI * 13 ** 3);
    expect(res.analysis!.bbox!.max.x).toBeCloseTo(10, 6);
    const far = withPrimitive(withPrimitive(createDocument('Loin'), { shape: 'box' }).doc, { shape: 'sphere', position: { x: 100, y: 0, z: 0 }, operation: 'common' }).doc;
    expect(evaluate(far).res.statuses.at(-1)).toMatchObject({ state: 'error', code: 'COMMON_EMPTY' });
  });
});
