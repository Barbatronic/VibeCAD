import { describe, expect, it } from 'vitest';
import type { SketchParams, SketchSpline } from '../../src/domain/model';
import { addFeature, createDocument, makeSketchFeature } from '../../src/domain/document';
import { parseNativeFile, serializeDocument } from '../../src/io/native-format';
import { originPlaneFrame } from '../../src/math/frame';
import { autoSplineHandle, splineBeziers } from '../../src/sketch/curves';
import { addArc, addConstraint, addLine, addSpline, addSplineHandle, emptySketch, pointPosition, prepareSplineTangent, removeEntities, splineOf } from '../../src/sketch/model';
import { createSession, pointerDown, pointerMove, pointerUp, setPixelSize, setTool, type SketchSession } from '../../src/sketch/session';
import { solveSketch } from '../../src/sketch/solver';

const XY = { kind: 'plane', plane: 'XY', offset: 0 } as const;

const spline = (sk: SketchParams, id: string) => sk.entities.find((e) => e.id === id) as SketchSpline;
/** Direction de départ de la spline en son premier point. */
function startTangent(sk: SketchParams, id: string) {
  const b = splineOf(sk, spline(sk, id))[0]!;
  const d = { x: b[1].x - b[0].x, y: b[1].y - b[0].y };
  const n = Math.hypot(d.x, d.y);
  return { x: d.x / n, y: d.y / n };
}

/** Sinus de l'angle entre le départ de la spline et le segment. */
function misalignment(sk: SketchParams, id: string, lineId: string) {
  const l = sk.entities.find((e) => e.id === lineId)!;
  if (l.type !== 'line') throw new Error('segment attendu');
  const a = pointPosition(sk, l.a)!;
  const b = pointPosition(sk, l.b)!;
  const d = { x: b.x - a.x, y: b.y - a.y };
  const t = startTangent(sk, id);
  return Math.abs(t.x * d.y - t.y * d.x) / Math.hypot(d.x, d.y);
}

/** Segment (0,0)–(10,0) puis spline qui part de son extrémité vers le haut. */
function lineThenSpline() {
  const l = addLine(emptySketch(XY), { x: 0, y: 0 }, { x: 10, y: 0 });
  const sp = addSpline(l.sketch, [l.b, { x: 20, y: 10 }, { x: 30, y: 0 }], false);
  return { sketch: sp.sketch, line: l.lineId, spline: sp.splineId, joint: l.b };
}

describe('splines : poignées de tangence', () => {
  it('une poignée remplace la tangente automatique, sans changer la courbe à sa création', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 8 }, { x: 20, y: 0 }];
    const auto = splineBeziers(pts, false);
    const same = splineBeziers(pts, false, [undefined, autoSplineHandle(pts, false, 1)]);
    expect(same).toEqual(auto);
    const h = { x: 14, y: 8 };
    const bz = splineBeziers(pts, false, [undefined, h]);
    expect(bz[1]![1]).toEqual(h);
    expect(bz[0]![2]).toEqual({ x: 6, y: 8 });

    const { sketch, spline: id, joint } = lineThenSpline();
    const before = splineOf(sketch, spline(sketch, id));
    const r = addSplineHandle(sketch, id, joint)!;
    expect(spline(r.sketch, id).handles).toEqual({ [joint]: r.handleId });
    const after = splineOf(r.sketch, spline(r.sketch, id));
    after.forEach((b, i) => b.forEach((p, k) => {
      expect(p.x).toBeCloseTo(before[i]![k]!.x, 12);
      expect(p.y).toBeCloseTo(before[i]![k]!.y, 12);
    }));
  });

  it('tangence spline–segment au point de raccord', () => {
    const { sketch, line, spline: id } = lineThenSpline();
    expect(Math.abs(startTangent(sketch, id).y)).toBeGreaterThan(0.1);
    const prepared = prepareSplineTangent(sketch, { a: id, b: line });
    const res = solveSketch(addConstraint(prepared, { type: 'tangent', a: id, b: line }).sketch);
    expect(res.converged).toBe(true);
    expect(misalignment(res.sketch, id, line)).toBeLessThan(1e-6);
  });

  it('tangence spline–arc et spline–spline', () => {
    // Arc de centre (0,0), de (10,0) à (0,10) ; la spline part de (0,10).
    const a = addArc(emptySketch(XY), { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 });
    const sp = addSpline(a.sketch, [a.end, { x: -10, y: 20 }, { x: -20, y: 15 }], false);
    let sk = prepareSplineTangent(sp.sketch, { a: a.arcId, b: sp.splineId });
    let res = solveSketch(addConstraint(sk, { type: 'tangent', a: a.arcId, b: sp.splineId }).sketch);
    expect(res.converged).toBe(true);
    const c = pointPosition(res.sketch, a.center)!;
    const p = pointPosition(res.sketch, a.end)!;
    const t = startTangent(res.sketch, sp.splineId);
    expect(Math.abs(t.x * (p.x - c.x) + t.y * (p.y - c.y))).toBeLessThan(1e-6);

    const s1 = addSpline(emptySketch(XY), [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 0 }], false);
    const s2 = addSpline(s1.sketch, [s1.points[2]!, { x: 30, y: 10 }, { x: 40, y: -5 }], false);
    sk = prepareSplineTangent(s2.sketch, { a: s1.splineId, b: s2.splineId });
    expect(Object.keys(spline(sk, s1.splineId).handles!)).toEqual([s1.points[2]]);
    res = solveSketch(addConstraint(sk, { type: 'tangent', a: s1.splineId, b: s2.splineId }).sketch);
    expect(res.converged).toBe(true);
    const last = splineOf(res.sketch, spline(res.sketch, s1.splineId)).at(-1)!;
    const t1 = { x: last[3].x - last[2].x, y: last[3].y - last[2].y };
    const t2 = startTangent(res.sketch, s2.splineId);
    expect(Math.abs(t1.x * t2.y - t1.y * t2.x) / Math.hypot(t1.x, t1.y)).toBeLessThan(1e-6);
  });

  it('supprimer la poignée rend la tangente automatique et retire la tangence', () => {
    const { sketch, line, spline: id } = lineThenSpline();
    const sk = addConstraint(prepareSplineTangent(sketch, { a: id, b: line }), { type: 'tangent', a: id, b: line }).sketch;
    const handle = Object.values(spline(sk, id).handles!)[0]!;
    const after = removeEntities(sk, [handle]);
    expect(spline(after, id)).toBeDefined();
    expect(spline(after, id).handles).toBeUndefined();
    expect(after.constraints.some((c) => c.type === 'tangent')).toBe(false);
    // Supprimer la spline emporte ses poignées.
    expect(removeEntities(sk, [id]).entities.some((e) => e.id === handle)).toBe(false);
  });

  it('format natif : les poignées sont enregistrées et relues', () => {
    let doc = createDocument('Spline');
    const part = doc.parts[0]!;
    const sk = makeSketchFeature(doc, part, XY);
    const { sketch, line, spline: id } = lineThenSpline();
    const params = addConstraint(prepareSplineTangent(sketch, { a: id, b: line }), { type: 'tangent', a: id, b: line }).sketch;
    doc = addFeature(doc, part.id, { ...sk, params });
    const parsed = parseNativeFile(serializeDocument(doc));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.doc).toEqual(doc);
  });

  it('session : outil Tangence sur une spline et un segment, poignée glissée à la souris', () => {
    const { sketch, line, spline: id, joint } = lineThenSpline();
    let s: SketchSession = setPixelSize(createSession({ featureId: 'sk-1', partId: 'pt-1', isNew: false, frame: originPlaneFrame('XY'), sketch }), 0.1);
    const at = (x: number, y: number) => (q: SketchSession) => pointerDown(pointerMove(q, { x, y }), { x, y });
    // Spline et segment non reliés : refus expliqué.
    const lone = addLine(sketch, { x: 0, y: 30 }, { x: 10, y: 30 });
    let u = setPixelSize(createSession({ featureId: 'sk-1', partId: 'pt-1', isNew: false, frame: originPlaneFrame('XY'), sketch: lone.sketch }), 0.1);
    u = setTool(u, 'tangent');
    u = at(5, 30)(u);
    const mid = splineOf(lone.sketch, spline(lone.sketch, id))[0]!;
    const onSpline = { x: (mid[0].x + 3 * mid[1].x + 3 * mid[2].x + mid[3].x) / 8, y: (mid[0].y + 3 * mid[1].y + 3 * mid[2].y + mid[3].y) / 8 };
    u = at(onSpline.x, onSpline.y)(u);
    expect(u.message?.text).toContain('toucher cette courbe');

    s = setTool(s, 'tangent');
    s = at(5, 0)(s);
    s = at(onSpline.x, onSpline.y)(s);
    expect(s.sketch.constraints.at(-1)).toMatchObject({ type: 'tangent', a: line, b: id });
    expect(misalignment(s.sketch, id, line)).toBeLessThan(1e-6);

    // Spline choisie : la poignée proposée au point du milieu se glisse et devient un point.
    s = setTool(s, 'select');
    s = pointerUp(at(onSpline.x, onSpline.y)(s));
    expect(s.selection).toContain(id);
    const middle = spline(s.sketch, id).points[1]!;
    const through = pointPosition(s.sketch, middle)!;
    const pts = spline(s.sketch, id).points.map((p) => pointPosition(s.sketch, p)!);
    const ghost = autoSplineHandle(pts, false, 1);
    s = pointerDown(pointerMove(s, ghost), ghost);
    s = pointerMove(s, { x: through.x + 5, y: through.y + 4 });
    s = pointerUp(s);
    const h = spline(s.sketch, id).handles?.[middle];
    expect(h).toBeDefined();
    expect(pointPosition(s.sketch, h!)).toMatchObject({ x: expect.closeTo(through.x + 5, 6), y: expect.closeTo(through.y + 4, 6) });
    expect(joint).toBe(spline(s.sketch, id).points[0]);
  });
});
