import { describe, expect, it } from 'vitest';
import type { SketchConstraint } from '../../src/domain/model';
import { originPlaneFrame } from '../../src/math/frame';
import { emptySketch, findCircle } from '../../src/sketch/model';
import { extractProfiles, profileArea } from '../../src/sketch/profiles';
import { solveSketch } from '../../src/sketch/solver';
import { confirmInput, createSession, pointerDown, pointerMove, setInputActive, setInputValue, setPixelSize, setTool, type SketchSession } from '../../src/sketch/session';

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

const click = (s: SketchSession, x: number, y: number) => pointerDown(pointerMove(s, { x, y }), { x, y });
const count = (s: SketchSession, type: string) => s.sketch.entities.filter((e) => e.type === type).length;

describe('outils d’esquisse : polygone régulier et oblong', () => {
  it('polygone à 6 côtés tapé au clavier : Ø 40, contour fermé d’aire exacte, taille pilotée par la cote', () => {
    let s = setTool(newSession(), 'polygon');
    s = click(s, 50, 50);
    s = pointerMove(s, { x: 50, y: 70 });
    s = setInputValue(s, 0, '40');
    s = setInputActive(s, 1);
    s = setInputValue(s, 1, '6');
    s = confirmInput(s);
    expect(s.input).toBeNull();
    expect(count(s, 'line')).toBe(6);
    const circle = s.sketch.entities.find((e) => e.type === 'circle')!;
    expect(findCircle(s.sketch, circle.id)!.construction).toBe(true);
    const profile = extractProfiles(s.sketch);
    expect(profile.ok).toBe(true);
    // Hexagone inscrit dans un cercle de rayon 20 : 3√3/2 · r².
    expect(profileArea(profile)).toBeCloseTo((3 * Math.sqrt(3) / 2) * 400, 6);
    // Changer la cote du cercle redimensionne le polygone, qui reste régulier.
    const dim = s.sketch.constraints.find((c): c is Extract<SketchConstraint, { type: 'diameter' }> => c.type === 'diameter')!;
    const resized = solveSketch({ ...s.sketch, constraints: s.sketch.constraints.map((c) => (c.id === dim.id ? { ...dim, value: 20 } : c)) });
    expect(resized.converged).toBe(true);
    expect(profileArea(extractProfiles(resized.sketch))).toBeCloseTo((3 * Math.sqrt(3) / 2) * 100, 5);
    // Seule la rotation reste libre.
    expect(resized.dof).toBe(1 + 2);
  });

  it('polygone à la souris : un triangle si on tape 3 côtés', () => {
    let s = setTool(newSession(), 'polygon');
    s = click(s, 0, 0);
    s = setInputActive(s, 1);
    s = setInputValue(s, 1, '3');
    s = click(s, 0, 10);
    expect(count(s, 'line')).toBe(3);
    expect(extractProfiles(s.sketch).ok).toBe(true);
  });

  it('oblong : longueur 30 et largeur 10 tapées, contour fermé d’aire exacte et totalement coté', () => {
    let s = setTool(newSession(), 'slot');
    s = click(s, 0, 0);
    s = pointerMove(s, { x: 20, y: 0 });
    s = setInputValue(s, 0, '30');
    s = confirmInput(s);
    expect(s.slot).not.toBeNull();
    s = pointerMove(s, { x: 15, y: 4 });
    s = setInputValue(s, 0, '10');
    s = confirmInput(s);
    expect(count(s, 'line')).toBe(2);
    expect(count(s, 'arc')).toBe(2);
    const profile = extractProfiles(s.sketch);
    expect(profile.ok).toBe(true);
    expect(profileArea(profile)).toBeCloseTo(30 * 10 + Math.PI * 25, 6);
    // Premier centre accroché à l'origine : seule l'orientation reste libre.
    expect(s.dof).toBe(1);
  });

  it('oblong à la souris : trois clics', () => {
    let s = setTool(newSession(), 'slot');
    s = click(s, 0, 0);
    s = click(s, 0, 20);
    s = click(s, 3, 10);
    expect(count(s, 'arc')).toBe(2);
    expect(profileArea(extractProfiles(s.sketch))).toBeCloseTo(20 * 6 + Math.PI * 9, 4);
  });

});
