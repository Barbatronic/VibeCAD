import Ajv2020 from 'ajv/dist/2020';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { addFeature, createDocument, findPart, makePrimitiveFeature, makeThickenFeature } from '../../src/domain/document';
import type { CadDocument, Id, ThickenParams } from '../../src/domain/model';
import { RecomputeEngine } from '../../src/features/engine';
import type { GeometryKernel } from '../../src/geometry/kernel';
import { parseNativeFile, serializeDocument } from '../../src/io/native-format';
import { getKernel } from '../helpers/kernel';
import { buildPlateDocument } from '../helpers/plate';

let kernel: GeometryKernel;
beforeAll(async () => {
  kernel = await getKernel();
});

function withThicken(doc: CadDocument, partId: Id, params: Partial<ThickenParams>): CadDocument {
  const base = makeThickenFeature(doc, findPart(doc, partId)!);
  return addFeature(doc, partId, { ...base, params: { ...base.params, ...params } });
}

function evaluate(doc: CadDocument) {
  const [res] = new RecomputeEngine(kernel, { get: () => undefined }).evaluateDocument(doc);
  return res!;
}

/** Plaque 60 × 30 × 5 percée d'un trou Ø 6, décalée de d : boîte et trou suivent. */
const plate = (d: number) => (60 + 2 * d) * (30 + 2 * d) * (5 + 2 * d) - Math.PI * (3 - d) ** 2 * (5 + 2 * d);

describe('épaissir', () => {
  it('amincir la plaque de 0,2 mm : elle maigrit, le trou s’agrandit, les faces restent désignables', () => {
    const { doc, ids } = buildPlateDocument();
    const res = evaluate(withThicken(doc, ids.partId, { distance: -0.2 }));
    expect(res.statuses.at(-1)!.state).toBe('ok');
    expect(res.analysis!.valid).toBe(true);
    expect(res.analysis!.volume).toBeCloseTo(plate(-0.2), 3);
    const top = kernel.findFacePlane(res.shape!, { featureId: ids.extrude, role: 'end' });
    expect(top).toMatchObject({ status: 'found' });
    if (top.status === 'found') expect(top.origin.z).toBeCloseTo(4.8, 6);
  });

  it('grossir de 1 mm à coins vifs : la plaque grandit, le trou rétrécit', () => {
    const { doc, ids } = buildPlateDocument();
    const res = evaluate(withThicken(doc, ids.partId, { distance: 1, corners: 'sharp' }));
    expect(res.statuses.at(-1)!.state).toBe('ok');
    expect(res.analysis!.volume).toBeCloseTo(plate(1), 3);
    expect(res.analysis!.bbox!.min.x).toBeCloseTo(-1, 6);
  });

  it('grossir une boîte de 1 mm à coins arrondis : faces, arêtes en quart de cylindre, coins en huitième de boule', () => {
    let doc = createDocument('Boîte');
    const partId = doc.parts[0]!.id;
    doc = addFeature(doc, partId, makePrimitiveFeature(doc, findPart(doc, partId)!));
    const res = evaluate(withThicken(doc, partId, { distance: 1 }));
    expect(res.statuses.at(-1)!.state).toBe('ok');
    expect(res.analysis!.volume).toBeCloseTo(8000 + 6 * 400 + 12 * 20 * (Math.PI / 4) + (4 / 3) * Math.PI, 3);
  });

  it('amincir plus que la moitié de l’épaisseur : erreur expliquée', () => {
    const { doc, ids } = buildPlateDocument();
    expect(evaluate(withThicken(doc, ids.partId, { distance: -3 })).statuses.at(-1)).toMatchObject({ state: 'error', code: 'THICKEN_FAILED' });
    expect(evaluate(withThicken(doc, ids.partId, { distance: 0 })).statuses.at(-1)).toMatchObject({ state: 'error', code: 'INVALID_PARAMETER' });
  });

  it('aller-retour du format natif et schéma JSON', () => {
    const { doc, ids } = buildPlateDocument();
    const d2 = withThicken(doc, ids.partId, { distance: -0.3, corners: 'sharp' });
    const text = serializeDocument(d2, '2026-10-11T12:00:00.000Z');
    const parsed = parseNativeFile(text);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.doc).toEqual(d2);
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(JSON.parse(readFileSync('docs/vibecad.schema.json', 'utf8')));
    validate(JSON.parse(text));
    expect(validate.errors ?? []).toEqual([]);
  });
});
