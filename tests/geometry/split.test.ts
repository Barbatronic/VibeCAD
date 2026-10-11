import Ajv2020 from 'ajv/dist/2020';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { addFeature, findPart, makeSplitFeature } from '../../src/domain/document';
import type { CadDocument, Id, SplitParams } from '../../src/domain/model';
import { RecomputeEngine } from '../../src/features/engine';
import type { GeometryKernel } from '../../src/geometry/kernel';
import { parseNativeFile, serializeDocument } from '../../src/io/native-format';
import { getKernel } from '../helpers/kernel';
import { buildPlateDocument } from '../helpers/plate';

let kernel: GeometryKernel;
beforeAll(async () => {
  kernel = await getKernel();
});

/** Plaque 60 × 30 × 5 (x 0 → 60, y 0 → 30, z 0 → 5), percée d'un trou Ø 6. */
const PLATE = 9000 - Math.PI * 9 * 5;

function withSplit(doc: CadDocument, partId: Id, params: Partial<SplitParams>): { doc: CadDocument; id: Id } {
  const base = makeSplitFeature(doc, findPart(doc, partId)!);
  return { doc: addFeature(doc, partId, { ...base, params: { ...base.params, ...params } }), id: base.id };
}

function evaluate(doc: CadDocument) {
  const engine = new RecomputeEngine(kernel, { get: () => undefined });
  const [res] = engine.evaluateDocument(doc);
  return { res: res!, engine };
}

describe('découpe en deux', () => {
  it('plan XY à mi-épaisseur, garder le bas : la face de coupe porte le nom de la découpe', () => {
    const { doc, ids } = buildPlateDocument();
    const s = withSplit(doc, ids.partId, { plane: { kind: 'plane', plane: 'XY' }, offset: 2.5, keep: 'below' });
    const { res, engine } = evaluate(s.doc);
    expect(res.statuses.at(-1)!.state).toBe('ok');
    expect(res.analysis!.solidCount).toBe(1);
    expect(res.analysis!.volume).toBeCloseTo(PLATE / 2, 3);
    expect(res.analysis!.bbox!.max.z).toBeCloseTo(2.5, 6);
    const mesh = engine.meshOf(res, { linearDeflection: 0.05, angularDeflection: 0.3 })!;
    const cut = mesh.faces.filter((f) => f.tags.some((t) => t.featureId === s.id && t.role === 'start'));
    expect(cut.length).toBe(1);
    expect(cut[0]!.plane!.normal.z).toBeCloseTo(1, 6);
    // La face de coupe sert de référence à une étape suivante.
    expect(kernel.findFacePlane(res.shape!, { featureId: s.id, role: 'start' })).toMatchObject({ status: 'found' });
  });

  it('garder le haut', () => {
    const { doc, ids } = buildPlateDocument();
    const { res } = evaluate(withSplit(doc, ids.partId, { plane: { kind: 'plane', plane: 'XY' }, offset: 1, keep: 'above' }).doc);
    expect(res.statuses.at(-1)!.state).toBe('ok');
    expect(res.analysis!.volume).toBeCloseTo((PLATE * 4) / 5, 3);
    expect(res.analysis!.bbox!.min.z).toBeCloseTo(1, 6);
  });

  it('les deux morceaux, plan YZ : deux solides écartés, les faces d’origine gardent leurs étiquettes', () => {
    const { doc, ids } = buildPlateDocument();
    const { res } = evaluate(withSplit(doc, ids.partId, { plane: { kind: 'plane', plane: 'YZ' }, offset: 30, keep: 'both', gap: 10 }).doc);
    expect(res.statuses.at(-1)!.state).toBe('ok');
    expect(res.analysis!.solidCount).toBe(2);
    expect(res.analysis!.volume).toBeCloseTo(PLATE, 3);
    expect(res.analysis!.bbox!.max.x).toBeCloseTo(70, 6);
    // Le dessus de la plaque existe dans les deux morceaux.
    expect(kernel.findFacePlane(res.shape!, { featureId: ids.extrude, role: 'end' })).toMatchObject({ status: 'found', faceCount: 2 });
  });

  it('plan donné par une face, décalé dans la pièce', () => {
    const { doc, ids } = buildPlateDocument();
    const { res } = evaluate(withSplit(doc, ids.partId, { plane: { kind: 'face', ref: { featureId: ids.extrude, role: 'end' } }, offset: -1, keep: 'below' }).doc);
    expect(res.statuses.at(-1)!.state).toBe('ok');
    expect(res.analysis!.volume).toBeCloseTo((PLATE * 4) / 5, 3);
    expect(res.analysis!.bbox!.max.z).toBeCloseTo(4, 6);
  });

  it('plan hors de la pièce : avertissement, ou erreur s’il ne reste rien', () => {
    const { doc, ids } = buildPlateDocument();
    const below = evaluate(withSplit(doc, ids.partId, { plane: { kind: 'plane', plane: 'XY' }, offset: 50, keep: 'below' }).doc).res;
    expect(below.statuses.at(-1)).toMatchObject({ state: 'warning', code: 'SPLIT_OUTSIDE' });
    expect(below.analysis!.volume).toBeCloseTo(PLATE, 3);
    const above = evaluate(withSplit(doc, ids.partId, { plane: { kind: 'plane', plane: 'XY' }, offset: 50, keep: 'above' }).doc).res;
    expect(above.statuses.at(-1)).toMatchObject({ state: 'error', code: 'SPLIT_NOTHING_LEFT' });
    const both = evaluate(withSplit(doc, ids.partId, { plane: { kind: 'plane', plane: 'XY' }, offset: 50, keep: 'both' }).doc).res;
    expect(both.statuses.at(-1)).toMatchObject({ state: 'warning', code: 'SPLIT_OUTSIDE' });
  });

  it('face disparue et écart trop petit : erreurs expliquées', () => {
    const { doc, ids } = buildPlateDocument();
    const lost = evaluate(withSplit(doc, ids.partId, { plane: { kind: 'face', ref: { featureId: ids.extrude, role: 'side', entityId: 'absent' } } }).doc).res;
    expect(lost.statuses.at(-1)).toMatchObject({ state: 'error', code: 'SPLIT_PLANE_LOST' });
    const tight = evaluate(withSplit(doc, ids.partId, { keep: 'both', gap: 0 }).doc).res;
    expect(tight.statuses.at(-1)).toMatchObject({ state: 'error', code: 'INVALID_PARAMETER' });
  });

  it('aller-retour du format natif et schéma JSON', () => {
    const { doc, ids } = buildPlateDocument();
    const d2 = withSplit(doc, ids.partId, { plane: { kind: 'face', ref: { featureId: ids.extrude, role: 'end' } }, offset: -2, keep: 'both', gap: 5 }).doc;
    const text = serializeDocument(d2, '2026-10-11T12:00:00.000Z');
    const parsed = parseNativeFile(text);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.doc).toEqual(d2);
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(JSON.parse(readFileSync('docs/vibecad.schema.json', 'utf8')));
    validate(JSON.parse(text));
    expect(validate.errors ?? []).toEqual([]);
  });
});
