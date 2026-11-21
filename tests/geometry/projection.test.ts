import { beforeAll, describe, expect, it } from 'vitest';
import { addFeature, findPart, makeExtrudeFeature, makeFilletFeature, makePlaneFeature, makeSketchFeature, updateFeature } from '../../src/domain/document';
import { ORIGIN_POINT_ID, type SketchFeature, type SketchParams } from '../../src/domain/model';
import { RecomputeEngine } from '../../src/features/engine';
import type { GeometryKernel, MeshData } from '../../src/geometry/kernel';
import { documentForWorker } from '../../src/geometry/protocol';
import { GeometryService } from '../../src/workers/geometry-service';
import { projectableCurves, projectableGeometry } from '../../src/app/projection';
import { addArc, addCircle, addConstraint, addEllipse, addLine, addSpline, pointPosition } from '../../src/sketch/model';
import { featureDependencies } from '../../src/features/registry';
import { solveSketch } from '../../src/sketch/solver';
import { getKernel } from '../helpers/kernel';
import { buildPlateDocument, cornerEdge, setDimension, topFrontEdge } from '../helpers/plate';

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

  it('arêtes reprises de la pièce telle qu’elle est avant l’esquisse : un congé ajouté après ne les retire pas', () => {
    const { doc: base, ids } = buildPlateDocument();
    // Congé de 3 mm sur l'arête avant du dessus, après l'esquisse du trou (posée sur le dessus).
    const doc = addFeature(base, ids.partId, makeFilletFeature(base, findPart(base, ids.partId)!, [topFrontEdge(base, ids.sketch1, ids.extrude)], 3));
    const svc = new GeometryService(kernel);
    const final = svc.evaluate(documentForWorker(doc));
    const frame = final.parts[0]!.sketches.find((s) => s.featureId === ids.sketch2)!.frame!;
    const part = findPart(doc, ids.partId)!;
    const lines = (mesh: MeshData | null | undefined) => projectableCurves(mesh, frame, part, ids.sketch2).filter((c) => c.kind === 'line');
    // L'arête avant du dessus : entre le dessus (« end ») et la face avant de l'extrusion.
    const topFront = (mesh: MeshData | null | undefined) => lines(mesh).filter((c) => c.ref.faces.some((f) => f.role === 'end') && c.ref.faces.some((f) => f.role === 'side' && Math.abs(c.kind === 'line' ? c.a.y + c.b.y : 1) < 1e-6));
    // Pièce finie : elle a disparu dans le congé (seule l'arête du dessous se projette au même endroit).
    expect(topFront(final.parts[0]!.mesh)).toHaveLength(0);
    // Pièce juste avant l'esquisse : les quatre arêtes du dessus, entières ; le bord du trou n'y est pas encore.
    const before = svc.meshBefore(documentForWorker(doc), ids.partId, ids.sketch2);
    expect(topFront(before.mesh)).toHaveLength(1);
    expect(lines(before.mesh).filter((c) => c.ref.faces.some((f) => f.role === 'end'))).toHaveLength(4);
    expect(projectableCurves(before.mesh, frame, part, ids.sketch2).some((c) => c.kind === 'circle')).toBe(false);
    // Première étape, ou aucune étape avant : rien.
    expect(svc.meshBefore(documentForWorker(doc), ids.partId, ids.sketch1).mesh).toBeNull();
  });

  it('arc de la pièce (coin arrondi) : proposé comme un arc, repris, il suit le rayon du congé', () => {
    const { doc: base, ids } = buildPlateDocument();
    // Congé vertical de 5 mm sur le coin (60, 30) : le dessus a un quart de cercle dans l'angle.
    const fillet = makeFilletFeature(base, findPart(base, ids.partId)!, [cornerEdge(base, ids.sketch1, ids.extrude)], 5);
    let doc = addFeature(base, ids.partId, fillet);
    const sk = makeSketchFeature(doc, findPart(doc, ids.partId)!, { kind: 'face', ref: { featureId: ids.extrude, role: 'end' } });
    doc = addFeature(doc, ids.partId, sk);
    const engine = new RecomputeEngine(kernel, { get: () => undefined });
    const [res] = engine.evaluateDocument(doc);
    const frame = res!.sketches.find((s) => s.featureId === sk.id)!.frame!;
    const curves = projectableCurves(engine.meshOf(res!, MESH)!, frame, findPart(doc, ids.partId)!, sk.id);
    const arcs = curves.filter((c) => c.kind === 'arc');
    expect(arcs).toHaveLength(1);
    const arc = arcs[0]!;
    if (arc.kind !== 'arc') throw new Error('arc attendu');
    expect(arc.radius).toBeCloseTo(5, 6);
    expect(arc.center.x).toBeCloseTo(55, 4);
    expect(arc.center.y).toBeCloseTo(25, 4);
    // Le cercle du trou reste un cercle complet.
    expect(curves.filter((c) => c.kind === 'circle')).toHaveLength(1);
    // Quart de cercle parcouru dans le sens trigonométrique : de (60, 25) à (55, 30).
    expect(arc.start.x).toBeCloseTo(60, 3);
    expect(arc.start.y).toBeCloseTo(25, 3);
    expect(arc.end.x).toBeCloseTo(55, 3);
    expect(arc.end.y).toBeCloseTo(30, 3);
    // Arc repris dans l'esquisse, puis congé porté à 8 mm : l'arc suit.
    const r = addArc(sk.params, arc.center, arc.start, arc.end);
    const params = { ...r.sketch, entities: r.sketch.entities.map((e) => (e.id === r.arcId && e.type === 'arc' ? { ...e, reference: { edge: arc.ref } } : e)) };
    let d2 = updateFeature<SketchFeature>(doc, sk.id, (f) => ({ ...f, params }));
    d2 = updateFeature(d2, fillet.id, (f) => (f.type === 'fillet' ? { ...f, params: { ...f.params, radius: 8 } } : f));
    const [res2] = new RecomputeEngine(kernel, { get: () => undefined }).evaluateDocument(d2);
    expect(res2!.statuses.find((s) => s.featureId === sk.id)?.state).toBe('ok');
    const solved = res2!.sketches.find((s) => s.featureId === sk.id)!.solved;
    const at = (id: string) => pointPosition(solved, id)!;
    expect(at(r.center).x).toBeCloseTo(52, 3);
    expect(at(r.center).y).toBeCloseTo(22, 3);
    expect(at(r.start).x).toBeCloseTo(60, 3);
    expect(at(r.start).y).toBeCloseTo(22, 3);
    expect(at(r.end).x).toBeCloseTo(52, 3);
    expect(at(r.end).y).toBeCloseTo(30, 3);
    // L'esquisse dépend bien du congé (l'arête reprise est bordée par sa face).
    expect(featureDependencies(findPart(d2, ids.partId)!.features.find((f) => f.id === sk.id)!)).toContain(fillet.id);
  });

  it('plan incliné de 30° : le trou devient une ellipse, le coin arrondi une spline, la face donne tout son contour', () => {
    const { doc: base, ids } = buildPlateDocument();
    const fillet = makeFilletFeature(base, findPart(base, ids.partId)!, [cornerEdge(base, ids.sketch1, ids.extrude)], 5);
    let doc = addFeature(base, ids.partId, fillet);
    const plane = makePlaneFeature(doc, findPart(doc, ids.partId)!);
    doc = addFeature(doc, ids.partId, { ...plane, params: { base: { kind: 'plane', plane: 'XY' }, offset: 20, angle: 30, hinge: { kind: 'axis', axis: 'X' } } });
    const sk = makeSketchFeature(doc, findPart(doc, ids.partId)!, { kind: 'datum', featureId: plane.id });
    doc = addFeature(doc, ids.partId, sk);
    const engine = new RecomputeEngine(kernel, { get: () => undefined });
    const [res] = engine.evaluateDocument(doc);
    const frame = res!.sketches.find((s) => s.featureId === sk.id)!.frame!;
    const part = findPart(doc, ids.partId)!;
    const g = projectableGeometry(engine.meshOf(res!, MESH)!, frame, part, sk.id);
    // Le trou Ø 6 (axe Z) vu sur un plan incliné de 30° : ellipse de grand rayon 3, petit rayon 3 × cos 30°.
    // Bords haut et bas du trou : deux ellipses (décalées par l'inclinaison), de mêmes rayons.
    const ellipses = g.curves.filter((c) => c.kind === 'ellipse');
    expect(ellipses).toHaveLength(2);
    const top0 = g.faces.find((f) => f.curves.some((i) => g.curves[i]!.kind === 'ellipse') && f.curves.some((i) => g.curves[i]!.kind === 'spline'))!;
    const el = g.curves[top0.curves.find((i) => g.curves[i]!.kind === 'ellipse')!]!;
    if (el.kind !== 'ellipse') throw new Error('ellipse attendue');
    expect(Math.hypot(el.major.x - el.center.x, el.major.y - el.center.y)).toBeCloseTo(3, 4);
    expect(el.minorRadius).toBeCloseTo(3 * Math.cos(Math.PI / 6), 4);
    // Le quart de cercle du coin, vu de biais : une spline ouverte.
    const splines = g.curves.filter((c) => c.kind === 'spline');
    expect(splines.length).toBeGreaterThanOrEqual(1);
    expect(splines.every((c) => c.kind === 'spline' && !c.closed && c.points.length === 16)).toBe(true);
    // La face du dessus (la plus proche du plan) : tout son contour, et sans le trou pour le contour extérieur.
    const top = g.faces.find((f) => f.curves.some((i) => g.curves[i]!.kind === 'ellipse') && f.curves.some((i) => g.curves[i]!.kind === 'spline'))!;
    expect(top).toBeTruthy();
    expect(top.curves.length).toBe(top.outer.length + 1);
    expect(top.outer.some((i) => g.curves[i]!.kind === 'ellipse')).toBe(false);
    expect(top.skipped).toBe(0);

    // Ellipse et spline reprises, puis trou Ø 8 et congé de 8 mm : elles suivent.
    const sp = splines[0]!;
    if (sp.kind !== 'spline') throw new Error('spline attendue');
    const e1 = addEllipse(sk.params, el.center, el.major, el.minorRadius);
    const s1 = addSpline(e1.sketch, sp.points, false);
    const params = {
      ...s1.sketch,
      entities: s1.sketch.entities.map((e) => (e.id === e1.ellipseId && e.type === 'ellipse' ? { ...e, reference: { edge: el.ref } } : e.id === s1.splineId && e.type === 'spline' ? { ...e, reference: { edge: sp.ref } } : e)),
    };
    let d2 = updateFeature<SketchFeature>(doc, sk.id, (f) => ({ ...f, params }));
    d2 = setDimension(d2, ids.sketch2, (findPart(d2, ids.partId)!.features.find((f) => f.id === ids.sketch2) as SketchFeature).params.constraints.find((c) => c.type === 'diameter')!.id, 8);
    d2 = updateFeature(d2, fillet.id, (f) => (f.type === 'fillet' ? { ...f, params: { ...f.params, radius: 8 } } : f));
    const [res2] = new RecomputeEngine(kernel, { get: () => undefined }).evaluateDocument(d2);
    expect(res2!.statuses.find((s) => s.featureId === sk.id)?.state).toBe('ok');
    const solved = res2!.sketches.find((s) => s.featureId === sk.id)!.solved;
    const ell = solved.entities.find((e) => e.id === e1.ellipseId);
    expect(ell?.type === 'ellipse' && ell.minorRadius).toBeCloseTo(4 * Math.cos(Math.PI / 6), 4);
    const major = pointPosition(solved, (ell as { major: string }).major)!;
    const center = pointPosition(solved, (ell as { center: string }).center)!;
    expect(Math.hypot(major.x - center.x, major.y - center.y)).toBeCloseTo(4, 4);
    // La spline a suivi le congé plus grand : ses extrémités se sont écartées du coin.
    const spl = solved.entities.find((e) => e.id === s1.splineId);
    if (spl?.type !== 'spline') throw new Error('spline attendue');
    const ends = [pointPosition(solved, spl.points[0]!)!, pointPosition(solved, spl.points[spl.points.length - 1]!)!];
    const before = [sp.points[0]!, sp.points[sp.points.length - 1]!];
    expect(Math.hypot(ends[0]!.x - ends[1]!.x, ends[0]!.y - ends[1]!.y)).toBeGreaterThan(Math.hypot(before[0]!.x - before[1]!.x, before[0]!.y - before[1]!.y) + 1);
  });
});
