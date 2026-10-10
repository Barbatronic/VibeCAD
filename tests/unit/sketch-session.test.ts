import { describe, expect, it } from 'vitest';
import { ORIGIN_POINT_ID } from '../../src/domain/model';
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
