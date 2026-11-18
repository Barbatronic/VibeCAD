import { describe, expect, it } from 'vitest';
import { originPlaneFrame } from '../../src/math/frame';
import { addArc, addCircle, addLine, addPoint, emptySketch } from '../../src/sketch/model';
import { CONSTRAINT_TOOLS, createSession, pointerDown, pointerMove, pointerUp, setPixelSize, setTool, type ConstraintTool, type SketchSession } from '../../src/sketch/session';

const XY = { kind: 'plane', plane: 'XY', offset: 0 } as const;

/** Deux segments, deux cercles, un point seul, un arc ; positions où cliquer chacun. */
function scene() {
  const l1 = addLine(emptySketch(XY), { x: 0, y: 0 }, { x: 20, y: 3 });
  const l2 = addLine(l1.sketch, { x: 30, y: 10 }, { x: 52, y: 14 });
  const c1 = addCircle(l2.sketch, { x: 0, y: 40 }, 5);
  const c2 = addCircle(c1.sketch, { x: 30, y: 40 }, 7);
  const p = addPoint(c2.sketch, { x: 60, y: 60 });
  const q = addPoint(p.sketch, { x: 70, y: 60 });
  const a = addArc(q.sketch, { x: 80, y: 0 }, { x: 90, y: 0 }, { x: 80, y: 10 });
  const s = setPixelSize(createSession({ featureId: 'f', partId: 'p', isNew: false, frame: originPlaneFrame('XY'), sketch: a.sketch }), 0.1);
  const at: Record<string, [number, number]> = { P1: [20, 3], P2: [30, 10], L1: [10, 1.5], L2: [41, 12], C1: [5, 40], C2: [37, 40], PT: [60, 60], PT2: [70, 60], ARC: [80 + 10 * Math.SQRT1_2, 10 * Math.SQRT1_2], AXX: [-40, 0] };
  return { s, at, count: a.sketch.constraints.length };
}

function select(s: SketchSession, at: Record<string, [number, number]>, names: string[]): SketchSession {
  let cur = setTool(s, 'select');
  for (const n of names) {
    const [x, y] = at[n]!;
    cur = pointerUp(pointerDown(pointerMove(cur, { x, y }), { x, y }));
  }
  return cur;
}

const CASES: Record<ConstraintTool, string[][]> = {
  coincident: [['P1', 'P2'], ['PT', 'L2'], ['L2', 'PT'], ['PT', 'C1'], ['C1', 'C2']],
  horizontal: [['L1']],
  vertical: [['L1']],
  parallel: [['L1', 'L2'], ['L1', 'AXX']],
  perpendicular: [['L1', 'L2']],
  collinear: [['L1', 'L2']],
  equal: [['L1', 'L2'], ['C1', 'C2']],
  tangent: [['L1', 'C1'], ['C1', 'C2'], ['L2', 'ARC']],
  pointOn: [['PT', 'L1'], ['C1', 'PT']],
  midpoint: [['PT', 'L1'], ['L1', 'PT']],
  symmetric: [['P1', 'P2', 'PT'], ['P1', 'P2', 'AXX'], ['L1', 'PT']],
  concentric: [['C1', 'C2'], ['C1', 'ARC']],
};

describe('contraintes : sélection d’abord, outil ensuite', () => {
  it('chaque outil de contrainte s’applique à la sélection, dans n’importe quel ordre de clic', () => {
    const { s, at, count } = scene();
    for (const tool of CONSTRAINT_TOOLS) {
      expect(CASES[tool], tool).toBeDefined();
      for (const names of CASES[tool]) {
        const after = setTool(select(s, at, names), tool);
        expect(after.sketch.constraints.length, `${tool} ${names.join('+')}`).toBe(count + 1);
        expect(after.tool).toBe('select');
        expect(after.selection).toEqual([]);
      }
    }
  });

  it('un seul élément choisi : il devient le premier choix de l’outil', () => {
    const { s, at, count } = scene();
    let cur = setTool(select(s, at, ['P1']), 'coincident');
    expect(cur.tool).toBe('coincident');
    expect(cur.picks).toHaveLength(1);
    cur = pointerDown(pointerMove(cur, { x: 30, y: 10 }), { x: 30, y: 10 });
    expect(cur.sketch.constraints.length).toBe(count + 1);
    expect(cur.sketch.constraints.at(-1)).toMatchObject({ type: 'coincident' });
    // Symétrie : deux points choisis, l'axe reste à cliquer.
    cur = setTool(select(s, at, ['P1', 'P2']), 'symmetric');
    expect(cur.tool).toBe('symmetric');
    expect(cur.picks).toHaveLength(2);
  });

  it('plusieurs éléments : points réunis, points sur une courbe, égalités en chaîne', () => {
    const { s, at, count } = scene();
    let cur = setTool(select(s, at, ['P1', 'P2', 'PT']), 'coincident');
    expect(cur.sketch.constraints.slice(count).map((c) => c.type)).toEqual(['coincident', 'coincident']);
    cur = setTool(select(s, at, ['PT', 'PT2', 'L2']), 'pointOn');
    expect(cur.sketch.constraints.slice(count).map((c) => c.type)).toEqual(['pointOn', 'pointOn']);
    expect(cur.message?.text).toBe('2 contraintes ajoutées : point sur.');
    cur = setTool(select(s, at, ['C1', 'C2', 'ARC']), 'equal');
    expect(cur.sketch.constraints.slice(count).map((c) => c.type)).toEqual(['equal', 'equal']);
  });

  it('sélection inadaptée : l’outil reste actif et dit quoi choisir', () => {
    const { s, at, count } = scene();
    const cur = setTool(select(s, at, ['L1', 'L2']), 'tangent');
    expect(cur.sketch.constraints.length).toBe(count);
    expect(cur.tool).toBe('tangent');
    expect(cur.selection).toEqual([]);
    expect(cur.message?.text).toBe('Deux segments ne peuvent pas être tangents : choisissez un cercle.');
  });
});
