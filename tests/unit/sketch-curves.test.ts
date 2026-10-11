import { describe, expect, it } from 'vitest';
import type { SketchEllipse, SketchSpline } from '../../src/domain/model';
import { originPlaneFrame } from '../../src/math/frame';
import { bezierPoint, sampleBeziers, polylineArea, splineBeziers } from '../../src/sketch/curves';
import { addConstraint, addEllipse, addLine, addSpline, emptySketch, ellipseOf } from '../../src/sketch/model';
import { extractProfiles, profileArea } from '../../src/sketch/profiles';
import { confirmInput, createSession, finishSpline, pointerDown, pointerMove, setInputValue, setPixelSize, setTool, type SketchSession } from '../../src/sketch/session';
import { solveSketch } from '../../src/sketch/solver';

const XY = { kind: 'plane', plane: 'XY', offset: 0 } as const;

function session(): SketchSession {
  return setPixelSize(createSession({ featureId: 'sk-1', partId: 'pt-1', isNew: true, frame: originPlaneFrame('XY'), sketch: emptySketch(XY) }), 0.1);
}
const click = (s: SketchSession, x: number, y: number) => pointerDown(pointerMove(s, { x, y }, { alt: true }), { x, y }, { alt: true });

describe('esquisse : ellipses et splines', () => {
  it('une spline passe par ses points, ouverte ou fermée', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 8 }, { x: 20, y: 0 }];
    const open = splineBeziers(pts, false);
    expect(open.length).toBe(2);
    expect(bezierPoint(open[0]!, 0)).toEqual(pts[0]);
    expect(bezierPoint(open[1]!, 0)).toEqual(pts[1]);
    expect(bezierPoint(open[1]!, 1)).toEqual(pts[2]);
    expect(splineBeziers(pts, true).length).toBe(3);
  });

  it('contours : ellipse (aire π a b), spline fermée, spline ouverte refermée par un segment', () => {
    const e = addEllipse(emptySketch(XY), { x: 0, y: 0 }, { x: 10, y: 0 }, 4);
    expect(profileArea(extractProfiles(e.sketch))).toBeCloseTo(Math.PI * 40, 9);

    const closed = addSpline(emptySketch(XY), [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 0, y: 10 }], true);
    const result = extractProfiles(closed.sketch);
    expect(result.ok).toBe(true);
    // Aire exacte (quadrature) proche de celle d'une polyligne très fine de la même courbe.
    const fine = sampleBeziers(splineBeziers([{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 0, y: 10 }], true), 400);
    fine.pop();
    expect(profileArea(result)).toBeCloseTo(Math.abs(polylineArea(fine)), 2);

    const arch = addSpline(emptySketch(XY), [{ x: 0, y: 0 }, { x: 10, y: 8 }, { x: 20, y: 0 }], false);
    const base = addLine(arch.sketch, { x: 20, y: 0 }, { x: 0, y: 0 });
    const r = extractProfiles(base.sketch);
    expect(r.ok).toBe(true);
    expect(profileArea(r)).toBeCloseTo(280 / 3, 6);
  });

  it('solveur : la cote du petit axe règle la largeur de l’ellipse', () => {
    const e = addEllipse(emptySketch(XY), { x: 0, y: 0 }, { x: 10, y: 0 }, 4);
    const k = addConstraint(e.sketch, { type: 'diameter', circle: e.ellipseId, value: 12 });
    const res = solveSketch(k.sketch);
    expect(res.converged).toBe(true);
    const ell = res.sketch.entities.find((x) => x.id === e.ellipseId) as SketchEllipse;
    expect(ell.minorRadius).toBeCloseTo(6, 9);
    expect(ellipseOf(res.sketch, ell)!.a).toBeCloseTo(10, 9);
  });

  it('outil Ellipse : centre, grand axe, largeur à la souris ; ou axes tapés', () => {
    let s = setTool(session(), 'ellipse');
    s = click(s, 0, 0);
    s = click(s, 15, 0);
    s = click(s, 3, 5);
    const ell = s.sketch.entities.find((x) => x.type === 'ellipse') as SketchEllipse;
    expect(ell.minorRadius).toBeCloseTo(5, 6);

    let t = setTool(session(), 'ellipse');
    t = click(t, 0, 0);
    t = pointerMove(t, { x: 10, y: 0 }, { alt: true });
    t = confirmInput(setInputValue(setInputValue(t, 0, '30'), 1, '10'));
    const typed = t.sketch.entities.find((x) => x.type === 'ellipse') as SketchEllipse;
    expect(typed.minorRadius).toBeCloseTo(5, 9);
    expect(ellipseOf(t.sketch, typed)!.a).toBeCloseTo(15, 9);
    expect(t.dof).toBeLessThan(s.dof);
  });

  it('outil Spline : points cliqués, fermée en cliquant le premier point, ouverte avec Entrée', () => {
    let s = setTool(session(), 'spline');
    for (const [x, y] of [[0, 0], [20, 0], [20, 10]] as const) s = click(s, x, y);
    s = click(s, 0, 0);
    const closed = s.sketch.entities.find((x) => x.type === 'spline') as SketchSpline;
    expect(closed.closed).toBe(true);
    expect(closed.points.length).toBe(3);
    expect(extractProfiles(s.sketch).ok).toBe(true);

    let o = setTool(session(), 'spline');
    for (const [x, y] of [[0, 0], [10, 5], [20, 0]] as const) o = click(o, x, y);
    o = finishSpline(o);
    const open = o.sketch.entities.find((x) => x.type === 'spline') as SketchSpline;
    expect(open.closed).toBe(false);
    expect(open.points.length).toBe(3);
  });
});
