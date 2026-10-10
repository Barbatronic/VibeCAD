import { describe, expect, it } from 'vitest';
import { ORIGIN_POINT_ID, type SketchParams } from '../../src/domain/model';
import {
  addCircle,
  addConstraint,
  addLine,
  addRectangle,
  emptySketch,
  findCircle,
  pointPosition,
  removeEntities,
} from '../../src/sketch/model';
import { classifyNewConstraint, measureConstraint, solveSketch } from '../../src/sketch/solver';

const XY = { kind: 'plane', plane: 'XY', offset: 0 } as const;

function plateSketch(width = 60, height = 30): { sketch: SketchParams; lines: string[]; corners: string[] } {
  const r = addRectangle(emptySketch(XY), { x: 0.4, y: -0.3 }, { x: 57, y: 28 });
  let s = r.sketch;
  s = addConstraint(s, { type: 'coincident', a: ORIGIN_POINT_ID, b: r.corners[0] }).sketch;
  s = addConstraint(s, { type: 'length', line: r.lines[0], value: width }).sketch;
  s = addConstraint(s, { type: 'length', line: r.lines[3], value: height }).sketch;
  return { sketch: s, lines: r.lines, corners: r.corners };
}

describe('solveur d’esquisse', () => {
  it('résout un rectangle coté depuis l’origine et le déclare entièrement contraint', () => {
    const { sketch, corners } = plateSketch();
    const res = solveSketch(sketch);
    expect(res.converged).toBe(true);
    expect(res.dof).toBe(0);
    expect(res.freeEntities.size).toBe(0);
    const opposite = pointPosition(res.sketch, corners[2]!)!;
    expect(opposite.x).toBeCloseTo(60, 9);
    expect(opposite.y).toBeCloseTo(30, 9);
    const first = pointPosition(res.sketch, corners[0]!)!;
    expect(first.x).toBe(0);
    expect(first.y).toBe(0);
  });

  it('compte les degrés de liberté d’un rectangle libre', () => {
    const r = addRectangle(emptySketch(XY), { x: 0, y: 0 }, { x: 10, y: 5 });
    const res = solveSketch(r.sketch);
    expect(res.converged).toBe(true);
    // position (2) + largeur + hauteur
    expect(res.dof).toBe(4);
    const anchored = addConstraint(r.sketch, { type: 'coincident', a: ORIGIN_POINT_ID, b: r.corners[0] }).sketch;
    expect(solveSketch(anchored).dof).toBe(2);
  });

  it('modifie la largeur en gardant le coin à l’origine', () => {
    const { sketch, corners } = plateSketch();
    const solved = solveSketch(sketch).sketch;
    const widthId = solved.constraints.find((c) => c.type === 'length')!.id;
    const edited = {
      ...solved,
      constraints: solved.constraints.map((c) => (c.id === widthId && c.type === 'length' ? { ...c, value: 80 } : c)),
    };
    const res = solveSketch(edited);
    expect(res.converged).toBe(true);
    expect(pointPosition(res.sketch, corners[2]!)!.x).toBeCloseTo(80, 9);
    expect(pointPosition(res.sketch, corners[0]!)!.x).toBe(0);
  });

  it('place un cercle par son diamètre et sa position depuis l’origine', () => {
    const c = addCircle(emptySketch(XY), { x: 14, y: 16 }, 2.5);
    let s = c.sketch;
    s = addConstraint(s, { type: 'diameter', circle: c.circleId, value: 6 }).sketch;
    s = addConstraint(s, { type: 'distanceX', a: ORIGIN_POINT_ID, b: c.center, value: 15 }).sketch;
    s = addConstraint(s, { type: 'distanceY', a: ORIGIN_POINT_ID, b: c.center, value: 15 }).sketch;
    const res = solveSketch(s);
    expect(res.converged).toBe(true);
    expect(res.dof).toBe(0);
    expect(findCircle(res.sketch, c.circleId)!.radius).toBeCloseTo(3, 12);
    expect(pointPosition(res.sketch, c.center)).toEqual({ x: 15, y: 15 });
  });

  it('détecte une cote redondante et une cote en conflit', () => {
    const { sketch, lines } = plateSketch();
    const solved = solveSketch(sketch).sketch;
    const same = { id: 'kx', type: 'length' as const, line: lines[2]!, value: 60 };
    const conflicting = { id: 'ky', type: 'length' as const, line: lines[2]!, value: 50 };
    expect(classifyNewConstraint(solved, same)).toBe('redundant');
    expect(classifyNewConstraint(solved, conflicting)).toBe('conflicting');
    const free = addLine(emptySketch(XY), { x: 0, y: 0 }, { x: 10, y: 1 });
    expect(classifyNewConstraint(free.sketch, { id: 'kh', type: 'horizontal', line: free.lineId })).toBe('independent');
  });

  it('signale les contraintes incompatibles sans planter', () => {
    const { sketch, lines } = plateSketch();
    const bad = addConstraint(sketch, { type: 'length', line: lines[2]!, value: 50 }).sketch;
    const res = solveSketch(bad);
    expect(res.converged).toBe(false);
    expect(res.unsatisfied.length).toBeGreaterThan(0);
  });

  it('mesure la valeur actuelle d’une cote', () => {
    const l = addLine(emptySketch(XY), { x: 0, y: 0 }, { x: 3, y: 4 });
    expect(measureConstraint(l.sketch, { id: 'k', type: 'length', line: l.lineId, value: 0 })).toBeCloseTo(5, 12);
  });

  it('retient les variables pondérées pendant un glissement', () => {
    const l = addLine(emptySketch(XY), { x: 0, y: 0 }, { x: 10, y: 0 });
    let s = addConstraint(l.sketch, { type: 'length', line: l.lineId, value: 10 }).sketch;
    // On déplace l'extrémité b vers (0, 20) : la longueur impose 10, b est retenu, a suit.
    s = { ...s, entities: s.entities.map((e) => (e.id === l.b && e.type === 'point' ? { ...e, x: 0, y: 20 } : e)) };
    const res = solveSketch(s, { weights: new Map([[`${l.b}.x`, 1e4], [`${l.b}.y`, 1e4]]) });
    expect(res.converged).toBe(true);
    const b = pointPosition(res.sketch, l.b)!;
    expect(b.x).toBeCloseTo(0, 2);
    expect(b.y).toBeCloseTo(20, 2);
  });

  it('supprime en cascade les points et contraintes d’un segment', () => {
    const { sketch, lines } = plateSketch();
    const after = removeEntities(sketch, [lines[0]!]);
    expect(after.entities.filter((e) => e.type === 'line')).toHaveLength(3);
    expect(after.entities.filter((e) => e.type === 'point')).toHaveLength(6);
    expect(after.constraints.some((c) => c.type === 'length' && c.line === lines[0])).toBe(false);
    expect(after.constraints.filter((c) => c.type === 'coincident')).toHaveLength(2);
  });
});
