import Ajv2020 from 'ajv/dist/2020';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { addFeature, createDocument, findPart, makeDraftFeature, makeExtrudeFeature, makePrimitiveFeature, makeSketchFeature } from '../../src/domain/document';
import type { CadDocument, FaceRef, Id, PlaneName } from '../../src/domain/model';
import { RecomputeEngine } from '../../src/features/engine';
import type { GeometryKernel } from '../../src/geometry/kernel';
import { parseNativeFile, serializeDocument } from '../../src/io/native-format';
import { addCircle } from '../../src/sketch/model';
import { solveSketch } from '../../src/sketch/solver';
import { getKernel } from '../helpers/kernel';

let kernel: GeometryKernel;
beforeAll(async () => {
  kernel = await getKernel();
});

/** Socle 60 × 30 × 5 et tour 20 × 30 × 20 (x 40 → 60) posés sur le plan XY. */
function base(): { doc: CadDocument; partId: Id; plinth: Id; tower: Id } {
  let doc = createDocument('Jusqu’à une face');
  const partId = doc.parts[0]!.id;
  const p1 = makePrimitiveFeature(doc, findPart(doc, partId)!);
  doc = addFeature(doc, partId, { ...p1, params: { ...p1.params, width: 60, depth: 30, height: 5 } });
  const p2 = makePrimitiveFeature(doc, findPart(doc, partId)!);
  doc = addFeature(doc, partId, { ...p2, params: { ...p2.params, position: { x: 40, y: 0, z: 0 }, width: 20, depth: 30, height: 20 } });
  return { doc, partId, plinth: p1.id, tower: p2.id };
}

/** Cercle sur un plan d'origine décalé, extrudé jusqu'à une face. */
function withCircleUpTo(doc: CadDocument, partId: Id, plane: PlaneName, offset: number, center: { x: number; y: number }, r: number, upTo: FaceRef): { doc: CadDocument; id: Id } {
  const sk = makeSketchFeature(doc, findPart(doc, partId)!, { kind: 'plane', plane, offset });
  let d = addFeature(doc, partId, { ...sk, params: solveSketch(addCircle(sk.params, center, r).sketch).sketch });
  const ex = makeExtrudeFeature(d, findPart(d, partId)!, sk.id, 10);
  d = addFeature(d, partId, { ...ex, params: { ...ex.params, upTo } });
  return { doc: d, id: ex.id };
}

function evaluate(doc: CadDocument) {
  const [res] = new RecomputeEngine(kernel, { get: () => undefined }).evaluateDocument(doc);
  return res!;
}

describe('extrusion jusqu’à une face', () => {
  it('face parallèle : le plot monte du socle jusqu’au haut de la tour', () => {
    const { doc, partId, tower } = base();
    const s = withCircleUpTo(doc, partId, 'XY', 5, { x: 15, y: 15 }, 5, { featureId: tower, role: 'end' });
    const res = evaluate(s.doc);
    expect(res.statuses.at(-1)!.state).toBe('ok');
    expect(res.analysis!.volume).toBeCloseTo(18000 + Math.PI * 25 * 15, 3);
    expect(kernel.analyze(res.tools.get(s.id)!).volume).toBeCloseTo(Math.PI * 25 * 15, 3);
    // La face d'arrivée porte le rôle `end` de l'extrusion, au niveau du haut de la tour.
    const end = kernel.findFacePlane(res.shape!, { featureId: s.id, role: 'end' });
    expect(end).toMatchObject({ status: 'found' });
    if (end.status === 'found') expect(end.origin.z).toBeCloseTo(20, 6);
  });

  it('face inclinée (dépouille), esquisse de l’autre côté : l’extrusion repart dans l’autre sens et s’arrête en biais', () => {
    let doc = createDocument('Biais');
    const partId = doc.parts[0]!.id;
    const pr = makePrimitiveFeature(doc, findPart(doc, partId)!);
    doc = addFeature(doc, partId, pr);
    const dp = makeDraftFeature(doc, findPart(doc, partId)!, [{ featureId: pr.id, role: 'side', entityId: 'x+' }]);
    doc = addFeature(doc, partId, { ...dp, params: { ...dp.params, angle: 10 } });
    // Plan YZ décalé à x = 40 (normale +X) : la face est derrière, du côté −X.
    const s = withCircleUpTo(doc, partId, 'YZ', 40, { x: 10, y: 10 }, 3, { featureId: pr.id, role: 'side', entityId: 'x+' });
    const res = evaluate(s.doc);
    expect(res.statuses.at(-1)!.state).toBe('ok');
    const t10 = Math.tan((10 * Math.PI) / 180);
    // Coupé en biais par le plan x = 20 − z·tan 10° : longueur moyenne au centre du cercle (z = 10).
    expect(kernel.analyze(res.tools.get(s.id)!).volume).toBeCloseTo(Math.PI * 9 * (40 - (20 - 10 * t10)), 2);
    expect(res.analysis!.solidCount).toBe(1);
  });

  it('face parallèle à la direction, face dans le plan de l’esquisse, face disparue : erreurs expliquées', () => {
    const { doc, partId, plinth, tower } = base();
    const side = evaluate(withCircleUpTo(doc, partId, 'XY', 5, { x: 15, y: 15 }, 5, { featureId: tower, role: 'side', entityId: 'x-' }).doc);
    expect(side.statuses.at(-1)).toMatchObject({ state: 'error', code: 'EXTRUDE_FACE_PARALLEL' });
    const flat = evaluate(withCircleUpTo(doc, partId, 'XY', 5, { x: 15, y: 15 }, 5, { featureId: plinth, role: 'end' }).doc);
    expect(flat.statuses.at(-1)).toMatchObject({ state: 'error', code: 'EXTRUDE_FACE_MISSED' });
    const lost = evaluate(withCircleUpTo(doc, partId, 'XY', 5, { x: 15, y: 15 }, 5, { featureId: tower, role: 'side', entityId: 'absent' }).doc);
    expect(lost.statuses.at(-1)).toMatchObject({ state: 'error', code: 'EXTRUDE_FACE_LOST' });
  });

  it('aller-retour du format natif et schéma JSON', () => {
    const { doc, partId, tower } = base();
    const d2 = withCircleUpTo(doc, partId, 'XY', 5, { x: 15, y: 15 }, 5, { featureId: tower, role: 'end' }).doc;
    const text = serializeDocument(d2, '2026-10-11T12:00:00.000Z');
    const parsed = parseNativeFile(text);
    expect(parsed.ok ? [] : parsed).toEqual([]);
    if (parsed.ok) expect(parsed.doc).toEqual(d2);
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(JSON.parse(readFileSync('docs/vibecad.schema.json', 'utf8')));
    validate(JSON.parse(text));
    expect(validate.errors ?? []).toEqual([]);
  });
});
