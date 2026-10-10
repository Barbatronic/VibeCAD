import { beforeAll, describe, expect, it } from 'vitest';
import { addFeature, createDocument, findPart, makeExtrudeFeature, makePocketFeature, makeSketchFeature } from '../../src/domain/document';
import type { CadDocument, PlaneName, SketchSupport } from '../../src/domain/model';
import { RecomputeEngine } from '../../src/features/engine';
import type { GeometryKernel } from '../../src/geometry/kernel';
import { getKernel } from '../helpers/kernel';
import { holeSketch, rectangleSketch } from '../helpers/plate';

let kernel: GeometryKernel;
beforeAll(async () => {
  kernel = await getKernel();
});

function blockOn(support: SketchSupport, w: number, h: number, depth: number, direction: 'default' | 'reversed' | 'symmetric' = 'default') {
  let doc: CadDocument = createDocument();
  const partId = doc.parts[0]!.id;
  const sk = makeSketchFeature(doc, findPart(doc, partId)!, support);
  doc = addFeature(doc, partId, { ...sk, params: rectangleSketch(sk.params, w, h).sketch });
  const ex = makeExtrudeFeature(doc, findPart(doc, partId)!, sk.id, depth, direction);
  doc = addFeature(doc, partId, ex);
  return { doc, partId, sketchId: sk.id, extrudeId: ex.id };
}

const plane = (p: PlaneName): SketchSupport => ({ kind: 'plane', plane: p, offset: 0 });

describe('plans d’esquisse et sens des extrusions', () => {
  it.each([
    ['XY', { min: [0, 0, 0], max: [20, 10, 5] }],
    ['XZ', { min: [0, -5, 0], max: [20, 0, 10] }],
    ['YZ', { min: [0, 0, 0], max: [5, 20, 10] }],
  ] as const)('rectangle 20 × 10 extrudé de 5 sur %s', (p, expected) => {
    const { doc } = blockOn(plane(p), 20, 10, 5);
    const [res] = new RecomputeEngine(kernel, { get: () => undefined }).evaluateDocument(doc);
    expect(res!.statuses.every((s) => s.state === 'ok')).toBe(true);
    const b = res!.analysis!.bbox!;
    expect(res!.analysis!.volume).toBeCloseTo(1000, 6);
    expect([b.min.x, b.min.y, b.min.z].map((v) => +v.toFixed(6))).toEqual(expected.min);
    expect([b.max.x, b.max.y, b.max.z].map((v) => +v.toFixed(6))).toEqual(expected.max);
  });

  it('extrusion inversée et symétrique', () => {
    const rev = blockOn(plane('XY'), 20, 10, 6, 'reversed');
    const sym = blockOn(plane('XY'), 20, 10, 6, 'symmetric');
    const engine = new RecomputeEngine(kernel, { get: () => undefined });
    const [r] = engine.evaluateDocument(rev.doc);
    const [s] = engine.evaluateDocument(sym.doc);
    expect(r!.analysis!.bbox!.min.z).toBeCloseTo(-6, 6);
    expect(r!.analysis!.bbox!.max.z).toBeCloseTo(0, 6);
    expect(s!.analysis!.bbox!.min.z).toBeCloseTo(-3, 6);
    expect(s!.analysis!.bbox!.max.z).toBeCloseTo(3, 6);
  });

  it('esquisse sur une face latérale : repère vu de face et perçage traversant', () => {
    // Bloc 40 × 20 × 10 ; la face avant (y = 0) est engendrée par le premier segment du rectangle.
    let { doc, partId, sketchId, extrudeId } = blockOn(plane('XY'), 40, 20, 10);
    const sketch = doc.parts[0]!.features.find((f) => f.id === sketchId)!;
    if (sketch.type !== 'sketch') throw new Error('esquisse');
    const bottomLine = sketch.params.entities.find((e) => e.type === 'line')!.id;
    const sk2 = makeSketchFeature(doc, findPart(doc, partId)!, { kind: 'face', ref: { featureId: extrudeId, role: 'side', entityId: bottomLine } });
    doc = addFeature(doc, partId, { ...sk2, params: holeSketch(sk2.params, 20, 5, 4) });
    doc = addFeature(doc, partId, makePocketFeature(doc, findPart(doc, partId)!, sk2.id, { kind: 'throughAll' }));
    const engine = new RecomputeEngine(kernel, { get: () => undefined });
    const [res] = engine.evaluateDocument(doc);
    expect(res!.statuses.map((s) => s.state)).toEqual(['ok', 'ok', 'ok', 'ok']);
    const frame = res!.sketches.find((s) => s.featureId === sk2.id)!.frame!;
    // Face avant : normale −Y, axe u = X, axe v = Z (comme le plan XZ).
    expect(frame.normal).toEqual({ x: 0, y: -1, z: 0 });
    expect(frame.xAxis).toEqual({ x: 1, y: 0, z: 0 });
    expect(frame.yAxis).toEqual({ x: 0, y: 0, z: 1 });
    expect(res!.analysis!.volume).toBeCloseTo(40 * 20 * 10 - Math.PI * 4 * 20, 4);
    const mesh = engine.meshOf(res!, { linearDeflection: 0.05, angularDeflection: 0.3 })!;
    const hole = mesh.faces.find((f) => f.surface === 'cylinder')!.cylinder!;
    expect(Math.abs(hole.axis.y)).toBeCloseTo(1, 9);
    expect(hole.origin.x).toBeCloseTo(20, 9);
    expect(hole.origin.z).toBeCloseTo(5, 9);
  });
});
