import { describe, expect, it } from 'vitest';
import { addCircle, addConstraint, addLine, addRectangle, emptySketch } from '../../src/sketch/model';
import { extractProfiles, profileArea } from '../../src/sketch/profiles';
import { solveSketch } from '../../src/sketch/solver';

const XY = { kind: 'plane', plane: 'XY', offset: 0 } as const;

describe('profils fermés', () => {
  it('reconnaît un rectangle fermé', () => {
    const r = addRectangle(emptySketch(XY), { x: 0, y: 0 }, { x: 60, y: 30 });
    const res = extractProfiles(r.sketch);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.regions).toHaveLength(1);
    expect(res.regions[0]!.outer.segments).toHaveLength(4);
    expect(res.regions[0]!.outer.signedArea).toBeCloseTo(1800, 9);
  });

  it('transforme un cercle intérieur en trou', () => {
    let s = addRectangle(emptySketch(XY), { x: 0, y: 0 }, { x: 60, y: 30 }).sketch;
    s = addCircle(s, { x: 15, y: 15 }, 3).sketch;
    const res = extractProfiles(s);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.regions).toHaveLength(1);
    expect(res.regions[0]!.holes).toHaveLength(1);
    expect(res.regions[0]!.holes[0]!.signedArea).toBeLessThan(0);
    expect(profileArea(res)).toBeCloseTo(1800 - Math.PI * 9, 9);
  });

  it('accepte des contours séparés et des îlots', () => {
    let s = addCircle(emptySketch(XY), { x: 0, y: 0 }, 20).sketch;
    s = addCircle(s, { x: 0, y: 0 }, 10).sketch;
    s = addCircle(s, { x: 0, y: 0 }, 5).sketch;
    s = addCircle(s, { x: 100, y: 0 }, 5).sketch;
    const res = extractProfiles(s);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.regions).toHaveLength(3);
  });

  it('indique les deux extrémités d’un contour ouvert', () => {
    let s = emptySketch(XY);
    const l1 = addLine(s, { x: 0, y: 0 }, { x: 10, y: 0 });
    s = l1.sketch;
    const l2 = addLine(s, { x: 10, y: 0 }, { x: 10, y: 10 });
    s = l2.sketch;
    s = addConstraint(s, { type: 'coincident', a: l1.b, b: l2.a }).sketch;
    const res = extractProfiles(solveSketch(s).sketch);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('PROFILE_OPEN');
    expect(res.points.sort()).toEqual([l1.a, l2.b].sort());
  });

  it('refuse un contour qui se croise', () => {
    let s = emptySketch(XY);
    const pts = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ];
    for (let i = 0; i < 4; i++) s = addLine(s, pts[i]!, pts[(i + 1) % 4]!).sketch;
    const res = extractProfiles(s);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('PROFILE_SELF_INTERSECTING');
  });

  it('refuse deux contours qui se chevauchent', () => {
    let s = addRectangle(emptySketch(XY), { x: 0, y: 0 }, { x: 10, y: 10 }).sketch;
    s = addCircle(s, { x: 10, y: 5 }, 3).sketch;
    const res = extractProfiles(s);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('PROFILE_OVERLAPPING');
  });

  it('signale une esquisse vide', () => {
    const res = extractProfiles(emptySketch(XY));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('PROFILE_EMPTY');
  });
});
