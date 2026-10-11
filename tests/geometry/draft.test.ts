import Ajv2020 from 'ajv/dist/2020';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { addFeature, createDocument, findPart, makeDraftFeature, makePrimitiveFeature } from '../../src/domain/document';
import type { CadDocument, DraftParams, FaceRef, Id, PrimitiveShape } from '../../src/domain/model';
import { RecomputeEngine } from '../../src/features/engine';
import type { GeometryKernel } from '../../src/geometry/kernel';
import { parseNativeFile, serializeDocument } from '../../src/io/native-format';
import { getKernel } from '../helpers/kernel';

let kernel: GeometryKernel;
beforeAll(async () => {
  kernel = await getKernel();
});

const TAN5 = Math.tan((5 * Math.PI) / 180);
/** Tronc de pyramide à base carrée de 20 mm, haut de 20 mm, côté du dessus `top`. */
const frustum = (top: number) => (20 / 3) * (400 + top * top + 20 * top);

/** Boîte 20 × 20 × 20 (ou cylindre Ø 20 × 20) posée sur le plan XY. */
function shapeDoc(shape: PrimitiveShape = 'box'): { doc: CadDocument; partId: Id; prId: Id } {
  let doc = createDocument('Dépouille');
  const partId = doc.parts[0]!.id;
  const pr = makePrimitiveFeature(doc, findPart(doc, partId)!, shape);
  doc = addFeature(doc, partId, pr);
  return { doc, partId, prId: pr.id };
}

const sides = (prId: Id): FaceRef[] => ['x-', 'x+', 'y-', 'y+'].map((e) => ({ featureId: prId, role: 'side', entityId: e }));

function withDraft(doc: CadDocument, partId: Id, params: Partial<DraftParams>): CadDocument {
  const base = makeDraftFeature(doc, findPart(doc, partId)!);
  return addFeature(doc, partId, { ...base, params: { ...base.params, ...params } });
}

function evaluate(doc: CadDocument) {
  const [res] = new RecomputeEngine(kernel, { get: () => undefined }).evaluateDocument(doc);
  return res!;
}

describe('dépouille', () => {
  it('quatre côtés d’une boîte à 5° depuis le plan XY : tronc de pyramide, faces toujours désignables', () => {
    const { doc, partId, prId } = shapeDoc();
    const res = evaluate(withDraft(doc, partId, { faces: sides(prId) }));
    expect(res.statuses.at(-1)!.state).toBe('ok');
    expect(res.analysis!.valid).toBe(true);
    expect(res.analysis!.volume).toBeCloseTo(frustum(20 - 40 * TAN5), 3);
    const right = kernel.findFacePlane(res.shape!, { featureId: prId, role: 'side', entityId: 'x+' });
    expect(right.status).toBe('found');
    if (right.status === 'found') expect(right.normal.z).toBeCloseTo(Math.sin((5 * Math.PI) / 180), 6);
  });

  it('inversée : la pièce s’élargit vers le haut', () => {
    const { doc, partId, prId } = shapeDoc();
    const res = evaluate(withDraft(doc, partId, { faces: sides(prId), reversed: true }));
    expect(res.statuses.at(-1)!.state).toBe('ok');
    expect(res.analysis!.volume).toBeCloseTo(frustum(20 + 40 * TAN5), 3);
  });

  it('plan neutre sur le dessus : la pièce rétrécit vers le bas', () => {
    const { doc, partId, prId } = shapeDoc();
    const res = evaluate(withDraft(doc, partId, { faces: sides(prId), neutral: { kind: 'face', ref: { featureId: prId, role: 'end' } } }));
    expect(res.statuses.at(-1)!.state).toBe('ok');
    expect(res.analysis!.volume).toBeCloseTo(frustum(20 - 40 * TAN5), 3);
    expect(res.analysis!.bbox!.max.x).toBeCloseTo(20, 6);
  });

  it('paroi d’un cylindre : tronc de cône', () => {
    const { doc, partId, prId } = shapeDoc('cylinder');
    const res = evaluate(withDraft(doc, partId, { faces: [{ featureId: prId, role: 'side', entityId: 'wall' }] }));
    expect(res.statuses.at(-1)!.state).toBe('ok');
    const r2 = 10 - 20 * TAN5;
    expect(res.analysis!.volume).toBeCloseTo(((Math.PI * 20) / 3) * (100 + 10 * r2 + r2 * r2), 2);
  });

  it('aucune face, face disparue, face parallèle au plan neutre : statuts expliqués', () => {
    const { doc, partId, prId } = shapeDoc();
    const none = evaluate(withDraft(doc, partId, {}));
    expect(none.statuses.at(-1)).toMatchObject({ state: 'warning', code: 'DRAFT_NO_FACE' });
    expect(none.analysis!.volume).toBeCloseTo(8000, 6);
    const lost = evaluate(withDraft(doc, partId, { faces: [{ featureId: prId, role: 'side', entityId: 'absent' }] }));
    expect(lost.statuses.at(-1)).toMatchObject({ state: 'error', code: 'DRAFT_FACE_LOST' });
    const flat = evaluate(withDraft(doc, partId, { faces: [{ featureId: prId, role: 'end' }] }));
    expect(flat.statuses.at(-1)).toMatchObject({ state: 'error', code: 'DRAFT_FAILED' });
    const tooMuch = evaluate(withDraft(doc, partId, { faces: sides(prId), angle: 60 }));
    expect(tooMuch.statuses.at(-1)).toMatchObject({ state: 'error', code: 'INVALID_PARAMETER' });
  });

  it('aller-retour du format natif et schéma JSON', () => {
    const { doc, partId, prId } = shapeDoc();
    const d2 = withDraft(doc, partId, { faces: sides(prId), angle: 3, neutral: { kind: 'face', ref: { featureId: prId, role: 'start' } }, reversed: true });
    const text = serializeDocument(d2, '2026-10-11T12:00:00.000Z');
    const parsed = parseNativeFile(text);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.doc).toEqual(d2);
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(JSON.parse(readFileSync('docs/vibecad.schema.json', 'utf8')));
    validate(JSON.parse(text));
    expect(validate.errors ?? []).toEqual([]);
  });
});
