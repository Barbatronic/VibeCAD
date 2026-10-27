import { describe, expect, it } from 'vitest';
import { ORIGIN_POINT_ID } from '../../src/domain/model';
import { originPlaneFrame } from '../../src/math/frame';
import { addArc, addConstraint, addLine, arcGeometry, arcPointAt, emptySketch, findArc, pointPosition } from '../../src/sketch/model';
import { extractProfiles } from '../../src/sketch/profiles';
import { solveSketch } from '../../src/sketch/solver';
import {
  confirmEditor,
  confirmInput,
  createSession,
  editDimension,
  pointerDown,
  pointerMove,
  pointerUp,
  setEditorText,
  setInputValue,
  setPixelSize,
  setTool,
  undo,
  type SketchSession,
} from '../../src/sketch/session';
import { measureConstraint } from '../../src/sketch/solver';

function newSession(): SketchSession {
  return setPixelSize(createSession({ featureId: 'sk', partId: 'p', isNew: true, frame: originPlaneFrame('XY'), sketch: emptySketch({ kind: 'plane', plane: 'XY', offset: 0 }) }), 0.1);
}
const move = (s: SketchSession, x: number, y: number) => pointerMove(s, { x, y }, { alt: true });
const click = (s: SketchSession, x: number, y: number) => pointerUp(pointerDown(move(s, x, y), { x, y }, { alt: true }));

describe('outil Arc', () => {
  it('trace un arc dans le sens où tourne la souris (trigonométrique ou horaire)', () => {
    let s = setTool(newSession(), 'arc');
    s = click(s, 0, 0);
    s = click(s, 10, 0);
    for (const a of [20, 45, 70]) s = move(s, 10 * Math.cos((a * Math.PI) / 180), 10 * Math.sin((a * Math.PI) / 180));
    s = click(s, 0, 10);
    const arc = s.sketch.entities.find((e) => e.type === 'arc')!;
    const g = arcGeometry(s.sketch, arc as never)!;
    expect(g.radius).toBeCloseTo(10, 6);
    expect((g.sweep * 180) / Math.PI).toBeCloseTo(90, 4);
    expect(g.start).toEqual({ x: 10, y: 0 });

    // Sens horaire : enregistré dans le sens trigonométrique, départ et arrivée échangés.
    let t = setTool(newSession(), 'arc');
    t = click(t, 0, 0);
    t = click(t, 10, 0);
    for (const a of [-20, -60, -100, -140]) t = move(t, 10 * Math.cos((a * Math.PI) / 180), 10 * Math.sin((a * Math.PI) / 180));
    t = click(t, -10 * Math.cos(Math.PI / 4), -10 * Math.sin(Math.PI / 4));
    const arc2 = t.sketch.entities.find((e) => e.type === 'arc')!;
    const g2 = arcGeometry(t.sketch, arc2 as never)!;
    expect((g2.sweep * 180) / Math.PI).toBeCloseTo(135, 4);
    expect(g2.end.x).toBeCloseTo(10, 6);
  });

  it('rayon et angle tapés au clavier, puis cote de rayon modifiable ; annuler', () => {
    let s = setTool(newSession(), 'arc');
    s = pointerUp(pointerDown(pointerMove(s, { x: 0.05, y: 0.05 }), { x: 0.05, y: 0.05 })); // accroché à l'origine
    s = move(s, 5, 5);
    s = confirmInput(setInputValue(s, 0, '8'));
    expect(s.input?.labels).toEqual(['Angle']);
    s = move(s, 2, 9);
    s = confirmInput(setInputValue(s, 0, '90'));
    const arc = findArc(s.sketch, s.sketch.entities.find((e) => e.type === 'arc')!.id)!;
    expect(pointPosition(s.sketch, arc.center)).toEqual({ x: 0, y: 0 });
    expect(arcGeometry(s.sketch, arc)!.radius).toBeCloseTo(8, 9);
    expect((arcGeometry(s.sketch, arc)!.sweep * 180) / Math.PI).toBeCloseTo(90, 6);
    expect(s.sketch.constraints.some((c) => c.type === 'coincident' && c.a === ORIGIN_POINT_ID)).toBe(true);
    // Cote : un clic sur l'arc propose d'abord le rayon.
    s = setTool(s, 'dimension');
    const mid = { x: 8 * Math.cos(Math.PI / 4), y: 8 * Math.sin(Math.PI / 4) };
    const g0 = arcGeometry(s.sketch, arc)!;
    const p = { x: g0.center.x + 8 * Math.cos(g0.startAngle + g0.sweep / 2), y: g0.center.y + 8 * Math.sin(g0.startAngle + g0.sweep / 2) };
    s = click(s, p.x, p.y);
    expect(s.editor?.candidates.map((c) => c.constraint.type)).toEqual(['radius', 'diameter']);
    s = confirmEditor(setEditorText(s, '12'));
    const radius = s.sketch.constraints.find((c) => c.type === 'radius')!;
    expect(measureConstraint(s.sketch, radius)).toBeCloseTo(12, 9);
    expect(mid.x).toBeGreaterThan(0);
    s = undo(s);
    expect(s.sketch.constraints.some((c) => c.type === 'radius')).toBe(false);
  });
});

describe('outil Rectangle centré', () => {
  it('le centre reste au milieu quand la largeur change (centre accroché à l’origine)', () => {
    let s = setTool(newSession(), 'centerRectangle');
    s = pointerUp(pointerDown(pointerMove(s, { x: 0.05, y: 0.05 }), { x: 0.05, y: 0.05 }));
    expect(s.start?.kind).toBe('origin');
    s = confirmInput(setInputValue(setInputValue(move(s, 20, 10), 0, '40'), 1, '20'));
    const lines = s.sketch.entities.filter((e) => e.type === 'line');
    expect(lines).toHaveLength(6);
    expect(lines.filter((l) => l.type === 'line' && l.construction)).toHaveLength(2);
    const profile = extractProfiles(s.sketch);
    expect(profile.ok && profile.regions[0]!.area).toBeCloseTo(800, 6);
    expect(s.dof).toBe(0);
    // Largeur 40 → 60 : le rectangle reste centré sur l'origine.
    const width = s.sketch.constraints.find((c) => c.type === 'length' && 'value' in c && c.value === 40)!;
    s = confirmEditor(setEditorText(editDimension(s, width.id), '60'));
    const xs = s.sketch.entities.flatMap((e) => (e.type === 'point' ? [e.x] : []));
    expect(Math.min(...xs)).toBeCloseTo(-30, 9);
    expect(Math.max(...xs)).toBeCloseTo(30, 9);
  });

  it('tangence au raccord d’un segment et d’un arc : elle retire bien un degré de liberté', () => {
    const arc = addArc(emptySketch({ kind: 'plane', plane: 'XY', offset: 0 }), { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 });
    const line = addLine(arc.sketch, { x: 10, y: 0 }, { x: 10, y: -20 });
    const joined = addConstraint(line.sketch, { type: 'coincident', a: arc.start, b: line.a }).sketch;
    const free = solveSketch(joined);
    const tangent = solveSketch(addConstraint(joined, { type: 'tangent', a: line.lineId, b: arc.arcId }).sketch);
    expect(tangent.converged).toBe(true);
    expect(tangent.dof).toBe(free.dof - 1);
  });
});

describe('outil Arc 3 points', () => {
  const arcOf = (s: SketchSession) => arcGeometry(s.sketch, s.sketch.entities.find((e) => e.type === 'arc') as never)!;

  it('départ, arrivée, point de passage : demi-cercle au-dessus ou en dessous selon le passage', () => {
    let s = setTool(newSession(), 'arc3');
    s = click(s, -10, 0);
    s = click(s, 10, 0);
    expect(s.input?.labels).toEqual(['Rayon']);
    s = click(s, 0, 10);
    const g = arcOf(s);
    expect(g.center.x).toBeCloseTo(0, 6);
    expect(g.center.y).toBeCloseTo(0, 6);
    expect(g.radius).toBeCloseTo(10, 6);
    expect((g.sweep * 180) / Math.PI).toBeCloseTo(180, 4);
    expect(arcPointAt(g, 0.5).y).toBeCloseTo(10, 6);

    // Passage en dessous : l'arc est enregistré dans le sens trigonométrique, extrémités échangées.
    let t = setTool(newSession(), 'arc3');
    t = click(t, -10, 0);
    t = click(t, 10, 0);
    t = click(t, 6, -8);
    const h = arcOf(t);
    expect(h.radius).toBeCloseTo(10, 6);
    expect(arcPointAt(h, 0.5).y).toBeCloseTo(-10, 6);
    expect(h.start.x).toBeCloseTo(-10, 6);
  });

  it('grand arc quand le passage est au-delà, rayon tapé au clavier, points alignés refusés', () => {
    let s = setTool(newSession(), 'arc3');
    s = click(s, 0, 0);
    s = click(s, 10, 0);
    s = click(s, 5, 0);
    expect(s.message?.kind).toBe('error');
    expect(s.sketch.entities.some((e) => e.type === 'arc')).toBe(false);
    // Passage (5, 10) : cercle de centre (5, 3,75), plus d'un demi-tour.
    s = click(s, 5, 10);
    const g = arcOf(s);
    expect(g.center.y).toBeCloseTo(3.75, 6);
    expect(g.sweep).toBeGreaterThan(Math.PI);

    let t = setTool(newSession(), 'arc3');
    t = click(t, 0, 0);
    t = click(t, 10, 0);
    t = move(t, 5, -3);
    t = confirmInput(setInputValue(t, 0, '4'));
    expect(t.input?.error).toMatch(/moitié/);
    t = confirmInput(setInputValue(t, 0, '8'));
    const h = arcOf(t);
    expect(h.radius).toBeCloseTo(8, 9);
    expect(h.sweep).toBeLessThan(Math.PI);
    expect(arcPointAt(h, 0.5).y).toBeLessThan(0);
    expect(t.sketch.constraints.some((c) => c.type === 'radius' && c.value === 8)).toBe(true);
  });

  it('accroche ses extrémités aux points existants', () => {
    let s = setTool(newSession(), 'line');
    s = click(s, -10, 0);
    s = click(s, 10, 0);
    s = setTool(s, 'arc3');
    s = pointerUp(pointerDown(pointerMove(s, { x: -10, y: 0 }), { x: -10, y: 0 }));
    s = pointerUp(pointerDown(pointerMove(s, { x: 10, y: 0 }), { x: 10, y: 0 }));
    s = click(s, 0, 10);
    expect(s.sketch.constraints.filter((c) => c.type === 'coincident')).toHaveLength(2);
    const profile = extractProfiles(s.sketch);
    expect(profile.ok && profile.regions[0]!.area).toBeCloseTo((Math.PI * 100) / 2, 6);
  });
});
