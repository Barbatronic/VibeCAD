import { describe, expect, it } from 'vitest';
import { AXIS_X_ID, AXIS_Y_ID, ORIGIN_POINT_ID } from '../../src/domain/model';
import { originPlaneFrame } from '../../src/math/frame';
import { emptySketch, findCircle, pointPosition } from '../../src/sketch/model';
import { extractProfiles } from '../../src/sketch/profiles';
import {
  confirmEditor,
  confirmInput,
  createSession,
  deleteSelection,
  editDimension,
  escape,
  pointerDown,
  pointerMove,
  pointerUp,
  redo,
  setEditorChoice,
  setEditorText,
  setInputValue,
  setPixelSize,
  setTool,
  undo,
  type SketchSession,
} from '../../src/sketch/session';

function newSession(): SketchSession {
  const s = createSession({
    featureId: 'sk-test',
    partId: 'part-test',
    isNew: true,
    frame: originPlaneFrame('XY'),
    sketch: emptySketch({ kind: 'plane', plane: 'XY', offset: 0 }),
  });
  return setPixelSize(s, 0.1);
}

const click = (s: SketchSession, x: number, y: number, opts = {}) => pointerDown(pointerMove(s, { x, y }), { x, y }, opts);

describe('session d’esquisse (parcours de la plaque)', () => {
  it('dessine un rectangle depuis l’origine en tapant 60 et 30', () => {
    let s = newSession();
    expect(s.tool).toBe('rectangle');
    s = click(s, 0.2, -0.3); // accroché à l'origine
    expect(s.start?.kind).toBe('origin');
    s = pointerMove(s, { x: 40, y: 20 });
    s = setInputValue(s, 0, '60');
    s = setInputValue(s, 1, '30');
    s = confirmInput(s);
    expect(s.message?.kind).toBe('success');
    expect(s.dof).toBe(0);
    const xs = s.sketch.entities.flatMap((e) => (e.type === 'point' ? [e.x] : []));
    const ys = s.sketch.entities.flatMap((e) => (e.type === 'point' ? [e.y] : []));
    expect(Math.min(...xs)).toBe(0);
    expect(Math.max(...xs)).toBe(60);
    expect(Math.max(...ys)).toBe(30);
    const profile = extractProfiles(s.sketch);
    expect(profile.ok && profile.regions[0]!.area).toBeCloseTo(1800, 9);
  });

  it('dessine un cercle par son diamètre puis le place par deux cotes depuis l’origine', () => {
    let s = setTool(newSession(), 'circle');
    s = click(s, 14.3, 15.6);
    s = setInputValue(s, 0, '6');
    s = confirmInput(s);
    const circle = s.sketch.entities.find((e) => e.type === 'circle')!;
    expect(circle.type === 'circle' && circle.radius).toBe(3);
    expect(s.dof).toBe(2);
    const centerId = circle.type === 'circle' ? circle.center : '';
    const center = pointPosition(s.sketch, centerId)!;
    // Cote horizontale depuis l'origine
    s = setTool(s, 'dimension');
    s = click(s, center.x, center.y);
    s = click(s, 0, 0);
    expect(s.editor?.candidates.map((c) => c.label)).toEqual(['Verticale', 'Horizontale', 'Alignée']);
    s = setEditorChoice(s, 1);
    s = setEditorText(s, '15');
    s = confirmEditor(s);
    expect(s.editor).toBeNull();
    // Cote verticale
    const c2 = pointPosition(s.sketch, centerId)!;
    s = click(s, c2.x, c2.y);
    s = click(s, 0, 0);
    s = setEditorChoice(s, s.editor!.candidates.findIndex((c) => c.label === 'Verticale'));
    s = setEditorText(s, '15');
    s = confirmEditor(s);
    expect(s.dof).toBe(0);
    expect(pointPosition(s.sketch, centerId)).toEqual({ x: 15, y: 15 });
  });

  it('refuse une cote redondante en gardant la saisie, et accepte une modification', () => {
    let s = newSession();
    s = click(s, 0, 0);
    s = setInputValue(s, 0, '60');
    s = setInputValue(s, 1, '30');
    s = confirmInput(s);
    s = setTool(s, 'dimension');
    // Le haut du rectangle (déjà déterminé par la largeur).
    s = click(s, 30, 30);
    s = setEditorText(s, '60');
    s = confirmEditor(s);
    expect(s.editor?.error).toMatch(/déjà déterminée/);
    expect(s.editor?.text).toBe('60');
    s = setEditorText(s, '50');
    s = confirmEditor(s);
    expect(s.editor?.error).toMatch(/contredit/);
    s = escape(s);
    // Modification de la largeur existante à 80 mm.
    const width = s.sketch.constraints.find((c) => c.type === 'length')!;
    s = editDimension(s, width.id);
    s = setEditorText(s, '80');
    s = confirmEditor(s);
    expect(Math.max(...s.sketch.entities.flatMap((e) => (e.type === 'point' ? [e.x] : [])))).toBe(80);
    expect(pointPosition(s.sketch, s.sketch.constraints.find((c) => c.type === 'coincident' && c.a === ORIGIN_POINT_ID)!.type === 'coincident' ? 'p1' : 'p1')).toEqual({ x: 0, y: 0 });
    // Saisie invalide : message clair, valeur conservée.
    s = editDimension(s, width.id);
    s = setEditorText(s, 'abc');
    s = confirmEditor(s);
    expect(s.editor?.error).toMatch(/nombre/);
    expect(s.editor?.text).toBe('abc');
  });

  it('trace une polyligne fermée avec coïncidences et contraintes déduites', () => {
    let s = setTool(newSession(), 'line');
    s = click(s, 0, 0);
    s = click(s, 20, 0.2); // presque horizontal → horizontal
    s = click(s, 20.1, 10); // presque vertical → vertical
    s = click(s, 0, 0); // ferme sur le premier point (origine)
    expect(s.message?.text).toMatch(/Contour fermé/);
    expect(s.start).toBeNull();
    const types = s.sketch.constraints.map((c) => c.type);
    expect(types.filter((t) => t === 'horizontal')).toHaveLength(1);
    expect(types.filter((t) => t === 'vertical')).toHaveLength(1);
    const profile = extractProfiles(s.sketch);
    expect(profile.ok).toBe(true);
  });

  it('déplace un point libre et annule / rétablit', () => {
    let s = setTool(newSession(), 'circle');
    s = click(s, 10, 10);
    s = click(s, 13, 10);
    s = setTool(s, 'select');
    const circleId = s.sketch.entities.find((e) => e.type === 'circle')!.id;
    s = pointerDown(pointerMove(s, { x: 13, y: 10 }), { x: 13, y: 10 });
    s = pointerMove(s, { x: 15, y: 10 });
    s = pointerUp(s);
    expect(findCircle(s.sketch, circleId)!.radius).toBeCloseTo(5, 6);
    s = undo(s);
    expect(findCircle(s.sketch, circleId)!.radius).toBeCloseTo(3, 6);
    s = redo(s);
    expect(findCircle(s.sketch, circleId)!.radius).toBeCloseTo(5, 6);
  });

  it('supprime la sélection et respecte Échap', () => {
    let s = setTool(newSession(), 'circle');
    s = click(s, 10, 10);
    s = click(s, 12, 10);
    s = setTool(s, 'select');
    s = click(s, 12, 10);
    expect(s.selection).toHaveLength(1);
    s = pointerUp(s);
    s = deleteSelection(s);
    expect(s.sketch.entities).toHaveLength(0);
    s = setTool(s, 'rectangle');
    s = click(s, 1, 1);
    expect(s.start).not.toBeNull();
    s = escape(s);
    expect(s.start).toBeNull();
    expect(s.tool).toBe('rectangle');
    s = escape(s);
    expect(s.tool).toBe('select');
  });
});

describe('accrochage aux axes de l’esquisse', () => {
  const axisLinks = (s: SketchSession, axis: string) => s.sketch.constraints.filter((c) => c.type === 'pointOn' && c.curve === axis);
  const positionOf = (s: SketchSession, id: string) => pointPosition(s.sketch, id)!;
  const drawn = (s: SketchSession, tool: Parameters<typeof setTool>[1], ...clicks: [number, number][]) =>
    clicks.reduce((session, [x, y]) => click(session, x, y), setTool(s, tool));

  it('relie le début d’un segment à l’axe visé, et le point suit l’axe après le dessin', () => {
    let s = drawn(newSession(), 'line', [20.1, 0.2]);
    expect(s.start).toMatchObject({ kind: 'axis', axisId: AXIS_X_ID, label: 'Axe X' });
    expect(s.start!.point.y).toBe(0);
    s = escape(click(s, 35, 18));
    expect(axisLinks(s, AXIS_X_ID)).toHaveLength(1);
    const [link] = axisLinks(s, AXIS_X_ID);
    expect(link?.type === 'pointOn' && positionOf(s, link.point).y).toBeCloseTo(0, 9);
  });

  it('relie un coin de rectangle à chaque axe visé', () => {
    const s = drawn(newSession(), 'rectangle', [20, 0.1], [-0.1, 30]);
    expect(s.message?.kind).toBe('success');
    expect(axisLinks(s, AXIS_X_ID)).toHaveLength(1);
    expect(axisLinks(s, AXIS_Y_ID)).toHaveLength(1);
  });

  it('s’applique au centre d’un cercle, à un point seul et au centre d’un rectangle', () => {
    expect(axisLinks(drawn(newSession(), 'circle', [0.1, 15], [5, 15]), AXIS_Y_ID)).toHaveLength(1);
    expect(axisLinks(drawn(newSession(), 'point', [12, 0.2]), AXIS_X_ID)).toHaveLength(1);
    expect(axisLinks(drawn(newSession(), 'centerRectangle', [12, 0.2], [20, 8]), AXIS_X_ID)).toHaveLength(1);
  });

  it('préfère l’origine, et un point existant, à l’axe', () => {
    expect(drawn(newSession(), 'line', [0.2, 0.2]).start?.kind).toBe('origin');
    const s = drawn(drawn(newSession(), 'point', [12, 0]), 'line', [12.1, 0.1]);
    expect(s.start).toMatchObject({ kind: 'point' });
    expect(s.start?.axisId).toBeUndefined();
  });

  it('crée le lien quand la grille pose le point sur l’axe sans que le curseur y soit', () => {
    const s = setPixelSize(newSession(), 0.4); // grille de 10 mm, tolérance de 4 mm
    expect(s.gridStep).toBe(10);
    expect(drawn(s, 'line', [30, 4.5]).start).toMatchObject({ kind: 'axis', axisId: AXIS_X_ID, point: { x: 30, y: 0 } });
    expect(drawn(s, 'line', [30, 5.5]).start?.axisId).toBeUndefined();
    expect(drawn(s, 'line', [4.5, 4.5]).start?.kind).toBe('origin');
  });

  it('garde un alignement perpendiculaire à l’axe', () => {
    const s = drawn(newSession(), 'line', [10, 20], [10.1, 0.2]);
    expect(s.sketch.constraints.filter((c) => c.type === 'vertical')).toHaveLength(1);
    expect(axisLinks(s, AXIS_X_ID)).toHaveLength(1);
  });

  it('ne double pas le lien d’un segment qui suit l’axe : son alignement le garde dessus', () => {
    const s = drawn(newSession(), 'line', [10, 0.1], [30, 0.1]);
    expect(s.sketch.constraints.filter((c) => c.type === 'horizontal')).toHaveLength(1);
    expect(axisLinks(s, AXIS_X_ID)).toHaveLength(1);
    expect(s.dof).toBe(2);
  });

  it('garde l’arrivée sur l’axe quand la longueur est tapée le long de celui-ci', () => {
    const typed = (s: SketchSession) => confirmInput(setInputValue(s, 0, '25'));
    const along = typed(pointerMove(drawn(newSession(), 'line', [10, 0.1]), { x: 40, y: 0.1 }));
    expect(along.sketch.constraints.filter((c) => c.type === 'horizontal')).toHaveLength(1);
    expect(axisLinks(along, AXIS_X_ID)).toHaveLength(1);
    // Une longueur qui n'atteint pas l'axe visé ne crée pas de lien.
    const short = typed(pointerMove(drawn(newSession(), 'line', [10, 40]), { x: 10, y: 0.1 }));
    expect(axisLinks(short, AXIS_X_ID)).toHaveLength(0);
    expect(short.sketch.constraints.filter((c) => c.type === 'vertical')).toHaveLength(1);
  });

  it('pose l’arrivée d’un arc sur l’axe seulement si le cercle y passe', () => {
    const arc = (centerY: number) => {
      const s = drawn(newSession(), 'arc', [5, centerY], [25, centerY]);
      return click(pointerMove(s, { x: 24, y: centerY / 2 }), 24.4, 0.1);
    };
    const touching = arc(5);
    expect(touching.message?.kind).toBe('success');
    expect(axisLinks(touching, AXIS_X_ID)).toHaveLength(1);
    const [link] = axisLinks(touching, AXIS_X_ID);
    expect(link?.type === 'pointOn' && positionOf(touching, link.point).y).toBeCloseTo(0, 6);
    const tooFar = arc(30);
    expect(tooFar.message?.kind).toBe('success');
    expect(axisLinks(tooFar, AXIS_X_ID)).toHaveLength(0);
  });

  it('ne s’accroche à rien avec Alt', () => {
    const s = click(setTool(newSession(), 'line'), 20, 0.2, { alt: true });
    expect(s.start).toMatchObject({ kind: 'free' });
  });
});
