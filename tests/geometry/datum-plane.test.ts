import { beforeAll, describe, expect, it } from 'vitest';
import { addFeature, findPart, makeExtrudeFeature, makeMirrorFeature, makePlaneFeature, makeSketchFeature, makeSplitFeature } from '../../src/domain/document';
import type { CadDocument, PlaneFeature } from '../../src/domain/model';
import { RecomputeEngine } from '../../src/features/engine';
import type { GeometryKernel } from '../../src/geometry/kernel';
import { getKernel } from '../helpers/kernel';
import { buildPlateDocument, rectangleSketch, topFrontEdge } from '../helpers/plate';

let kernel: GeometryKernel;
beforeAll(async () => {
  kernel = await getKernel();
});

const evaluate = (doc: CadDocument) => new RecomputeEngine(kernel, { get: () => undefined }).evaluateDocument(doc)[0]!;
const round = (v: number) => Math.round(v * 1e6) / 1e6;

/** Plaque 60 × 30 × 5 percée, puis un plan de construction. */
function withPlane(params: Partial<PlaneFeature['params']>) {
  const { doc, ids } = buildPlateDocument();
  const plane = makePlaneFeature(doc, findPart(doc, ids.partId)!);
  const next = addFeature(doc, ids.partId, { ...plane, params: { ...plane.params, ...params } });
  return { doc: next, ids, planeId: plane.id };
}

/** Rectangle 10 × 10 dessiné sur le plan de construction, extrudé de 2 mm. */
function blockOn(doc: CadDocument, partId: string, planeId: string): CadDocument {
  const sk = makeSketchFeature(doc, findPart(doc, partId)!, { kind: 'datum', featureId: planeId });
  let next = addFeature(doc, partId, { ...sk, params: rectangleSketch(sk.params, 10, 10).sketch });
  next = addFeature(next, partId, makeExtrudeFeature(next, findPart(next, partId)!, sk.id, 2));
  return next;
}

describe('plans de construction', () => {
  it('plan XY décalé de 20 mm : une esquisse posée dessus part à z = 20', () => {
    const { doc, ids, planeId } = withPlane({ base: { kind: 'plane', plane: 'XY' }, offset: 20 });
    const part = evaluate(blockOn(doc, ids.partId, planeId));
    expect(part.failedFeatureId).toBeNull();
    expect(part.datums.map((d) => d.featureId)).toEqual([planeId]);
    expect(round(part.analysis!.bbox!.max.z)).toBe(22);
    expect(part.analysis!.solidCount).toBe(2);
  });

  it('face du dessus décalée de 3 mm, puis inclinée de 90° autour de l’arête avant : plan vertical', () => {
    const { doc, ids } = buildPlateDocument();
    const plane = makePlaneFeature(doc, findPart(doc, ids.partId)!);
    const edge = topFrontEdge(doc, ids.sketch1, ids.extrude);
    const next = addFeature(doc, ids.partId, { ...plane, params: { base: { kind: 'face', ref: { featureId: ids.extrude, role: 'end' } }, offset: 0, angle: 90, hinge: { kind: 'edge', edge } } });
    const part = evaluate(next);
    expect(part.failedFeatureId).toBeNull();
    const frame = part.datums[0]!.frame;
    // La normale (0, 0, 1) tourne autour de l'axe X : elle devient horizontale, selon Y.
    expect(Math.abs(round(frame.normal.y))).toBe(1);
    expect(round(frame.normal.z)).toBe(0);
    // Le plan passe par l'arête avant du dessus (y = 0, z = 5).
    expect(round(frame.origin.y)).toBe(0);
  });

  it('symétrie et découpe par un plan de construction (plan YZ décalé à x = 70)', () => {
    const { doc, ids, planeId } = withPlane({ base: { kind: 'plane', plane: 'YZ' }, offset: 70 });
    const mirror = makeMirrorFeature(doc, findPart(doc, ids.partId)!, { kind: 'part' }, { kind: 'datum', featureId: planeId });
    const mirrored = evaluate(addFeature(doc, ids.partId, mirror));
    expect(mirrored.failedFeatureId).toBeNull();
    expect(round(mirrored.analysis!.bbox!.max.x)).toBe(140);

    const { doc: d2, ids: i2, planeId: p2 } = withPlane({ base: { kind: 'plane', plane: 'YZ' }, offset: 0 });
    const split = makeSplitFeature(d2, findPart(d2, i2.partId)!, 20);
    const cut = evaluate(addFeature(d2, i2.partId, { ...split, params: { ...split.params, plane: { kind: 'datum', featureId: p2 } } }));
    expect(cut.failedFeatureId).toBeNull();
    expect(round(cut.analysis!.bbox!.max.x)).toBe(20);
  });

  it('plan supprimé : l’esquisse posée dessus perd son support', () => {
    const { doc, ids, planeId } = withPlane({ offset: 20 });
    const withBlock = blockOn(doc, ids.partId, planeId);
    const broken = { ...withBlock, parts: withBlock.parts.map((p) => ({ ...p, features: p.features.filter((f) => f.id !== planeId) })) };
    const part = evaluate(broken);
    expect(part.statuses.some((s) => s.code === 'SUPPORT_LOST')).toBe(true);
  });
});
