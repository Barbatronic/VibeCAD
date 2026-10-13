import { beforeAll, describe, expect, it } from 'vitest';
import { addFeature, findPart, makeAxisFeature, makeExtrudeFeature, makeMirrorFeature, makePatternFeature, makePlaneFeature, makeSketchFeature, makeSplitFeature } from '../../src/domain/document';
import type { AxisFeature, CadDocument, PlaneFeature, SketchFeature } from '../../src/domain/model';
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

describe('axes de construction', () => {
  /** Plaque percée (trou Ø 6 en 15 ; 15) et un axe de construction. */
  function withAxis(params: Partial<AxisFeature['params']>) {
    const { doc, ids } = buildPlateDocument();
    const axis = makeAxisFeature(doc, findPart(doc, ids.partId)!);
    return { doc: addFeature(doc, ids.partId, { ...axis, params: { ...axis.params, ...params } }), ids, axisId: axis.id };
  }

  it('répétition en cercle autour d’un axe vertical passant par (30 ; 15) : le trou est refait en (45 ; 15)', () => {
    const { doc, ids, axisId } = withAxis({ kind: 'line', position: { x: 30, y: 15, z: 0 }, direction: 'Z' });
    const pattern = makePatternFeature(doc, findPart(doc, ids.partId)!, ids.pocket, 'circular');
    const part = evaluate(addFeature(doc, ids.partId, { ...pattern, params: { ...pattern.params, count: 2, axis: { kind: 'datum', featureId: axisId } } }));
    expect(part.failedFeatureId).toBeNull();
    expect(part.axes[0]).toMatchObject({ featureId: axisId, point: { x: 30, y: 15, z: 0 } });
    expect(part.analysis!.volume).toBeCloseTo(60 * 30 * 5 - 2 * Math.PI * 9 * 5, 3);
  });

  it('axe repris du bord du trou : il passe par son centre, à la verticale', () => {
    const { doc, ids } = buildPlateDocument();
    const circle = (doc.parts[0]!.features.find((f) => f.id === ids.sketch2) as SketchFeature).params.entities.find((e) => e.type === 'circle')!;
    const axis = makeAxisFeature(doc, findPart(doc, ids.partId)!);
    const edge = { faces: [{ featureId: ids.extrude, role: 'end' as const }, { featureId: ids.pocket, role: 'side' as const, entityId: circle.id }] as [never, never] };
    const part = evaluate(addFeature(doc, ids.partId, { ...axis, params: { ...axis.params, kind: 'edge', edge } }));
    expect(part.failedFeatureId).toBeNull();
    const a = part.axes[0]!;
    expect([round(a.point.x), round(a.point.y)]).toEqual([15, 15]);
    expect(Math.abs(round(a.dir.z))).toBe(1);
  });

  it('un plan incliné autour d’un axe de construction', () => {
    const { doc, ids, axisId } = withAxis({ kind: 'line', position: { x: 0, y: 0, z: 10 }, direction: 'X' });
    const plane = makePlaneFeature(doc, findPart(doc, ids.partId)!);
    const part = evaluate(addFeature(doc, ids.partId, { ...plane, params: { base: { kind: 'plane', plane: 'XY' }, offset: 10, angle: 90, hinge: { kind: 'datum', featureId: axisId } } }));
    expect(part.failedFeatureId).toBeNull();
    const f = part.datums[0]!.frame;
    expect(Math.abs(round(f.normal.y))).toBe(1);
    // Le plan XY décalé à z = 10 contient l'axe : il tourne sur lui-même et passe toujours par z = 10.
    expect(round(f.origin.z)).toBe(10);
  });
});
