import { describe, expect, it } from 'vitest';
import type { SketchArc, SketchLine, SketchParams } from '../../src/domain/model';
import { addCircle, addConstraint, addLine, arcGeometry, emptySketch, linePoints } from '../../src/sketch/model';
import { extractProfiles, profileArea } from '../../src/sketch/profiles';
import { solveSketch } from '../../src/sketch/solver';
import { trimAt, trimPiece } from '../../src/sketch/trim';

const XY = { kind: 'plane', plane: 'XY', offset: 0 } as const;
const lines = (s: SketchParams) => s.entities.filter((e): e is SketchLine => e.type === 'line');

function solved(s: SketchParams): SketchParams {
  const r = solveSketch(s);
  expect(r.converged).toBe(true);
  return r.sketch;
}

describe('esquisse : couper', () => {
  it('coupe le bout d’un segment à la croisée d’un autre ; la nouvelle extrémité reste posée dessus', () => {
    const h = addLine(emptySketch(XY), { x: 0, y: 0 }, { x: 10, y: 0 });
    const v = addLine(h.sketch, { x: 5, y: -5 }, { x: 5, y: 5 });
    const piece = trimPiece(v.sketch, h.lineId, { x: 8, y: 0 })!;
    expect(piece.lo!.point.x).toBeCloseTo(5, 9);
    expect(piece.hi).toBeNull();
    const out = trimAt(v.sketch, h.lineId, { x: 8, y: 0 })!;
    expect(out.deleted).toBe(false);
    const s = solved(out.sketch);
    const [a, b] = linePoints(s, lines(s).find((l) => l.id === h.lineId)!)!;
    expect([a.x, b.x]).toEqual([0, 5]);
    expect(s.constraints.some((c) => c.type === 'pointOn' && c.curve === v.lineId)).toBe(true);
    // L'ancienne extrémité a disparu.
    expect(s.entities.some((e) => e.id === h.b)).toBe(false);
  });

  it('coupe le milieu d’un segment : deux segments alignés, la longueur cotée est retirée', () => {
    let s = addLine(emptySketch(XY), { x: 0, y: 0 }, { x: 10, y: 0 }).sketch;
    const id = lines(s)[0]!.id;
    s = addConstraint(s, { type: 'length', line: id, value: 10 }).sketch;
    s = addConstraint(s, { type: 'horizontal', line: id }).sketch;
    s = addLine(s, { x: 3, y: -2 }, { x: 3, y: 2 }).sketch;
    s = addLine(s, { x: 7, y: -2 }, { x: 7, y: 2 }).sketch;
    const out = trimAt(s, id, { x: 5, y: 0 })!;
    expect(out.droppedConstraints).toBe(1);
    const r = solved(out.sketch);
    const horizontal = lines(r).filter((l) => {
      const [a, b] = linePoints(r, l)!;
      return Math.abs(a.y) < 1e-9 && Math.abs(b.y) < 1e-9;
    });
    expect(horizontal).toHaveLength(2);
    expect(horizontal.map((l) => linePoints(r, l)!.map((p) => p.x))).toEqual([
      [0, 3],
      [7, 10],
    ]);
    expect(r.constraints.some((c) => c.type === 'collinear')).toBe(true);
    expect(r.constraints.some((c) => c.type === 'length')).toBe(false);
  });

  it('un segment sans croisement est supprimé', () => {
    const s = addLine(emptySketch(XY), { x: 0, y: 0 }, { x: 10, y: 0 });
    const out = trimAt(s.sketch, s.lineId, { x: 5, y: 0 })!;
    expect(out.deleted).toBe(true);
    expect(out.sketch.entities).toHaveLength(0);
  });

  it('un cercle coupé par un diamètre devient le demi-cercle qui reste (même identifiant, cote gardée)', () => {
    const c = addCircle(emptySketch(XY), { x: 0, y: 0 }, 5);
    let s = addConstraint(c.sketch, { type: 'diameter', circle: c.circleId, value: 10 }).sketch;
    s = addLine(s, { x: -8, y: 0 }, { x: 8, y: 0 }).sketch;
    const out = trimAt(s, c.circleId, { x: 0, y: 5 })!;
    const r = solved(out.sketch);
    const arc = r.entities.find((e): e is SketchArc => e.id === c.circleId && e.type === 'arc')!;
    const g = arcGeometry(r, arc)!;
    expect(g.sweep).toBeCloseTo(Math.PI, 9);
    // Le reste passe par le bas.
    expect(Math.sin(g.startAngle + g.sweep / 2)).toBeCloseTo(-1, 9);
    expect(r.constraints.some((k) => k.type === 'diameter' && k.circle === c.circleId)).toBe(true);
  });

  it('couper pour obtenir un contour fermé : carré avec une bosse demi-circulaire', () => {
    // Carré 10 × 10 et cercle R 3 centré au milieu du côté droit.
    let s = emptySketch(XY);
    const corners = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const r = addLine(s, corners[i]!, corners[(i + 1) % 4]!);
      s = r.sketch;
      ids.push(r.lineId);
    }
    for (let i = 0; i < 4; i++) {
      const a = lines(s).find((l) => l.id === ids[i])!;
      const b = lines(s).find((l) => l.id === ids[(i + 1) % 4])!;
      s = addConstraint(s, { type: 'coincident', a: a.b, b: b.a }).sketch;
    }
    const circle = addCircle(s, { x: 10, y: 5 }, 3);
    s = circle.sketch;
    // Retirer le morceau du côté droit à l'intérieur du cercle, puis la moitié gauche du cercle.
    s = solved(trimAt(s, ids[1]!, { x: 10, y: 5 })!.sketch);
    s = solved(trimAt(s, circle.circleId, { x: 7, y: 5 })!.sketch);
    const profile = extractProfiles(s);
    expect(profile.ok).toBe(true);
    expect(profileArea(profile)).toBeCloseTo(100 + (Math.PI * 9) / 2, 6);
  });
});
