import { beforeAll, describe, expect, it } from 'vitest';
import { addFeature, findPart, makeExtrudeFeature, makeSketchFeature, updateFeature } from '../../src/domain/document';
import { ORIGIN_POINT_ID, type SketchFeature, type SketchParams } from '../../src/domain/model';
import { RecomputeEngine } from '../../src/features/engine';
import type { GeometryKernel } from '../../src/geometry/kernel';
import { projectableCurves } from '../../src/app/projection';
import { addCircle, addConstraint, addLine, pointPosition } from '../../src/sketch/model';
import { solveSketch } from '../../src/sketch/solver';
import { getKernel } from '../helpers/kernel';
import { buildPlateDocument } from '../helpers/plate';

let kernel: GeometryKernel;
beforeAll(async () => {
  kernel = await getKernel();
});

const MESH = { linearDeflection: 0.05, angularDeflection: 0.3 };

describe('géométrie reprise de la pièce dans une esquisse', () => {
  it('le bord du trou projeté sert de centre à un bossage, qui suit le trou quand il bouge', () => {
    const { doc: base, ids } = buildPlateDocument();
    const engine = new RecomputeEngine(kernel, { get: () => undefined });
    const [plate] = engine.evaluateDocument(base);
    const mesh = engine.meshOf(plate!, MESH)!;
    const part = findPart(base, ids.partId)!;
    const sk = makeSketchFeature(base, part, { kind: 'face', ref: { featureId: ids.extrude, role: 'end' } });
    const frame = plate!.sketches.find((s) => s.featureId === ids.sketch2)!.frame!;

    // Arêtes proposées sur le dessus : le contour (4 segments) et le bord du trou (cercle Ø 6).
    const curves = projectableCurves(mesh, frame, part, sk.id);
    expect(curves.filter((c) => c.kind === 'line')).toHaveLength(4);
    const hole = curves.find((c) => c.kind === 'circle');
    expect(hole).toMatchObject({ kind: 'circle', center: { x: 15, y: 15 }, radius: 3 });
    expect(hole!.ref.faces.map((f) => f.featureId).sort()).toEqual([ids.extrude, ids.pocket].sort());

    // Esquisse : le cercle repris + un disque Ø 10 concentrique, extrudé de 2 mm.
    const ref = addCircle(sk.params, { x: 15, y: 15 }, 3);
    let params: SketchParams = {
      ...ref.sketch,
      entities: ref.sketch.entities.map((e) => (e.id === ref.circleId ? { ...e, reference: { edge: hole!.ref } } : e)),
    };
    const boss = addCircle(params, { x: 16, y: 14 }, 4);
    params = addConstraint(boss.sketch, { type: 'coincident', a: ref.center, b: boss.center }).sketch;
    params = addConstraint(params, { type: 'diameter', circle: boss.circleId, value: 10 }).sketch;
    // Un segment de construction relie l'origine au centre (repère, sans effet sur le volume).
    const helper = addLine(params, { x: 0, y: 0 }, { x: 15, y: 15 });
    params = { ...helper.sketch, entities: helper.sketch.entities.map((e) => (e.id === helper.lineId ? { ...e, construction: true } : e)) };
    params = addConstraint(params, { type: 'coincident', a: ORIGIN_POINT_ID, b: helper.a }).sketch;
    params = addConstraint(params, { type: 'coincident', a: ref.center, b: helper.b }).sketch;
    params = solveSketch(params).sketch;
    let doc = addFeature(base, ids.partId, { ...sk, params });
    const ex = makeExtrudeFeature(doc, findPart(doc, ids.partId)!, sk.id, 2);
    doc = addFeature(doc, ids.partId, ex);

    const [withBoss] = engine.evaluateDocument(doc);
    expect(withBoss!.statuses.map((s) => s.state)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok', 'ok']);
    const evaluated = withBoss!.sketches.find((s) => s.featureId === sk.id)!;
    expect(evaluated.dof).toBe(0);
    // Le bossage (disque plein Ø 10 × 2 mm) bouche le haut du trou.
    expect(withBoss!.analysis!.volume).toBeCloseTo(9000 - Math.PI * 9 * 5 + Math.PI * 25 * 2, 3);

    // Le trou passe de x = 15 à x = 40 : le cercle repris et le bossage suivent.
    const moved = updateFeature<SketchFeature>(doc, ids.sketch2, (f) => ({
      ...f,
      params: solveSketch({ ...f.params, constraints: f.params.constraints.map((c) => (c.type === 'distanceX' ? { ...c, value: 40 } : c)) }).sketch,
    }));
    const [after] = engine.evaluateDocument(moved);
    expect(after!.statuses.every((s) => s.state === 'ok')).toBe(true);
    const solved = after!.sketches.find((s) => s.featureId === sk.id)!.solved;
    expect(pointPosition(solved, boss.center)).toEqual({ x: 40, y: 15 });
    expect(after!.analysis!.bbox!.max.z).toBeCloseTo(7, 6);
    expect(after!.analysis!.volume).toBeCloseTo(9000 - Math.PI * 9 * 5 + Math.PI * 25 * 2, 3);
  });

  it('signale une arête reprise disparue sans casser l’esquisse', () => {
    const { doc: base, ids } = buildPlateDocument();
    const engine = new RecomputeEngine(kernel, { get: () => undefined });
    const part = findPart(base, ids.partId)!;
    const sk = makeSketchFeature(base, part, { kind: 'plane', plane: 'XY', offset: 10 });
    const lost = addLine(sk.params, { x: 0, y: 0 }, { x: 10, y: 0 });
    const params: SketchParams = {
      ...lost.sketch,
      entities: lost.sketch.entities.map((e) =>
        e.id === lost.lineId ? { ...e, reference: { edge: { faces: [{ featureId: ids.extrude, role: 'start' }, { featureId: ids.extrude, role: 'end' }] } } } : e,
      ),
    };
    const doc = addFeature(base, ids.partId, { ...sk, params });
    const [res] = engine.evaluateDocument(doc);
    expect(res!.statuses[4]).toMatchObject({ state: 'warning', code: 'REFERENCE_LOST' });
  });
});
