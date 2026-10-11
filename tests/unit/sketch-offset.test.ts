import { describe, expect, it } from 'vitest';
import type { SketchLine, SketchParams } from '../../src/domain/model';
import { addArc, addCircle, addLine, addRectangle, emptySketch, linePoints } from '../../src/sketch/model';
import { addOffsetLoop, loopOfCurve, signedDistanceToLoop } from '../../src/sketch/offset';
import { extractProfiles, profileArea } from '../../src/sketch/profiles';
import { solveSketch } from '../../src/sketch/solver';
import { originPlaneFrame } from '../../src/math/frame';
import { confirmInput, createSession, pointerDown, pointerMove, sessionPreview, setInputValue, setTool } from '../../src/sketch/session';

const XY = { kind: 'plane', plane: 'XY', offset: 0 } as const;

function offset(sketch: SketchParams, curveId: string, d: number): SketchParams {
  const found = loopOfCurve(sketch, curveId);
  if ('error' in found) throw new Error(found.error);
  const out = addOffsetLoop(sketch, found.loop, d, false);
  if ('error' in out) throw new Error(out.error);
  const r = solveSketch(out.sketch);
  expect(r.converged).toBe(true);
  return r.sketch;
}

const area = (s: SketchParams) => {
  const p = extractProfiles(s);
  expect(p.ok).toBe(true);
  return profileArea(p);
};

function rectangle() {
  const r = addRectangle(emptySketch(XY), { x: 0, y: 0 }, { x: 40, y: 20 });
  const first = r.sketch.entities.find((e) => e.type === 'line')!.id;
  return { sketch: r.sketch, first };
}

describe('esquisse : décalage de contour', () => {
  it('rectangle vers l’extérieur : cadre de 2 mm, segments parallèles cotés, rien ne bouge au calcul', () => {
    const { sketch, first } = rectangle();
    const s = offset(sketch, first, 2);
    // Cadre : 44 × 24 − 40 × 20.
    expect(area(s)).toBeCloseTo(44 * 24 - 800, 6);
    const xs = s.entities.filter((e): e is SketchLine => e.type === 'line').flatMap((l) => linePoints(s, l)!.map((p) => p.x));
    expect(Math.min(...xs)).toBeCloseTo(-2, 9);
    expect(Math.max(...xs)).toBeCloseTo(42, 9);
    expect(s.constraints.filter((c) => c.type === 'parallel').length).toBe(4);
    expect(s.constraints.filter((c) => c.type === 'pointLineDistance').every((c) => c.type === 'pointLineDistance' && c.value === 2)).toBe(true);
  });

  it('rectangle vers l’intérieur, puis distance trop grande refusée', () => {
    const { sketch, first } = rectangle();
    expect(area(offset(sketch, first, -3))).toBeCloseTo(800 - 34 * 14, 6);
    const found = loopOfCurve(sketch, first);
    if ('error' in found) throw new Error(found.error);
    expect(addOffsetLoop(sketch, found.loop, -11, false)).toMatchObject({ error: expect.stringMatching(/trop grande/) });
  });

  it('demi-disque (segment + arc) vers l’extérieur : l’arc garde son centre, le coin est recalculé', () => {
    const line = addLine(emptySketch(XY), { x: 0, y: 10 }, { x: 0, y: -10 });
    const arc = addArc(line.sketch, { x: 0, y: 0 }, { x: 0, y: -10 }, { x: 0, y: 10 });
    const s = offset(arc.sketch, line.lineId, 1);
    const r = 11;
    const outer = (Math.PI * r * r) / 2 + Math.sqrt(r * r - 1) + r * r * Math.asin(1 / r);
    expect(area(s)).toBeCloseTo(outer - 50 * Math.PI, 6);
    const arcs = s.entities.filter((e) => e.type === 'arc');
    expect(arcs.length).toBe(2);
    expect(arcs[1]!.type === 'arc' && arcs[1]!.center).toBe(arcs[0]!.type === 'arc' && arcs[0]!.center);
  });

  it('cercle vers l’intérieur : cercle concentrique coté', () => {
    const c = addCircle(emptySketch(XY), { x: 5, y: 5 }, 10);
    const s = offset(c.sketch, c.circleId, -4);
    expect(area(s)).toBeCloseTo(Math.PI * (100 - 36), 6);
    expect(s.constraints.some((k) => k.type === 'diameter' && k.value === 12)).toBe(true);
  });

  it('distance signée du curseur : positive dehors, négative dedans', () => {
    const { sketch, first } = rectangle();
    const found = loopOfCurve(sketch, first);
    if ('error' in found) throw new Error(found.error);
    expect(signedDistanceToLoop(found.loop, { x: 20, y: 25 })).toBeCloseTo(5, 9);
    expect(signedDistanceToLoop(found.loop, { x: 20, y: 17 })).toBeCloseTo(-3, 9);
  });

  it('trait isolé : pas de contour fermé', () => {
    const l = addLine(emptySketch(XY), { x: 0, y: 0 }, { x: 10, y: 0 });
    expect(loopOfCurve(l.sketch, l.lineId)).toMatchObject({ error: expect.any(String) });
  });

  it('dans la session : clic sur un trait, aperçu qui suit la souris, clic ou distance tapée', () => {
    const { sketch } = rectangle();
    let s = createSession({ featureId: 'sk-1', partId: 'pt-1', isNew: true, frame: originPlaneFrame('XY'), sketch: solveSketch(sketch).sketch });
    s = setTool(s, 'offset');
    s = pointerDown(s, { x: 20, y: 0 });
    expect(s.picks.length).toBe(1);
    s = pointerMove(s, { x: 20, y: -4 });
    expect(sessionPreview(s).lines.length).toBe(4);
    expect(sessionPreview(s).labels[0]!.text).toMatch(/extérieur 4/);
    const clicked = pointerDown(s, { x: 20, y: -4 });
    expect(area(clicked.sketch)).toBeCloseTo(48 * 28 - 800, 6);
    // Souris à l'intérieur, distance tapée : 3 mm vers l'intérieur.
    let typed = pointerMove(s, { x: 20, y: 1 });
    typed = confirmInput(setInputValue(typed, 0, '3'));
    expect(area(typed.sketch)).toBeCloseTo(800 - 34 * 14, 6);
    expect(typed.picks.length).toBe(0);
  });
});
