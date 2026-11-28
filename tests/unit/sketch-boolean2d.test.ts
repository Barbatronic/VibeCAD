import { describe, expect, it } from 'vitest';
import {
  booleanOperand,
  circlePrim,
  primsArea,
  rectanglePrims,
  regularPolygonPoints,
  roundedPolygon,
  simpleOperand,
  slotPrims,
  type Prim,
} from '../../src/sketch/boolean2d';

const rect = (x: number, y: number, w: number, h: number, r = 0) => simpleOperand(rectanglePrims({ x, y }, w, h, r));
const disc = (x: number, y: number, r: number) => simpleOperand([circlePrim({ x, y }, r)]);
const kinds = (prims: Prim[]) => prims.map((p) => p.kind).sort().join(',');

describe('formes de base', () => {
  it('rectangle aux coins arrondis : 4 segments, 4 arcs, aire exacte', () => {
    const prims = rectanglePrims({ x: 0, y: 0 }, 40, 20, 5);
    expect(kinds(prims)).toBe('arc,arc,arc,arc,line,line,line,line');
    const area = 40 * 20 - (4 - Math.PI) * 25;
    expect(Math.abs(primsArea(booleanOperand('union', [simpleOperand(prims)]).prims))).toBeCloseTo(area, 6);
  });

  it('oblong : aire d’un rectangle plus un disque', () => {
    const r = booleanOperand('union', [simpleOperand(slotPrims({ x: 0, y: 0 }, { x: 30, y: 0 }, 10))]);
    expect(primsArea(r.prims)).toBeCloseTo(30 * 10 + Math.PI * 25, 6);
  });

  it('hexagone aux coins arrondis : 6 arcs tangents', () => {
    const prims = roundedPolygon(regularPolygonPoints({ x: 0, y: 0 }, 6, 20), 3);
    expect(prims.filter((p) => p.kind === 'arc')).toHaveLength(6);
    expect(prims.filter((p) => p.kind === 'line')).toHaveLength(6);
  });
});

describe('booléens', () => {
  it('union de deux rectangles qui se chevauchent', () => {
    const r = booleanOperand('union', [rect(0, 0, 20, 10), rect(10, 5, 20, 10)]);
    expect(primsArea(r.prims)).toBeCloseTo(200 + 200 - 50, 6);
    expect(r.prims.every((p) => p.kind === 'line')).toBe(true);
  });

  it('union de rectangles bord à bord : l’arête commune disparaît', () => {
    const r = booleanOperand('union', [rect(0, 0, 10, 10), rect(10, 0, 10, 10)]);
    expect(primsArea(r.prims)).toBeCloseTo(200, 6);
    expect(r.prims.some((p) => p.kind === 'line' && Math.abs(p.a.x - 10) < 1e-9 && Math.abs(p.b.x - 10) < 1e-9)).toBe(false);
  });

  it('différence : rectangle moins un disque qui mord le bord', () => {
    const r = booleanOperand('difference', [rect(0, 0, 40, 20), disc(40, 10, 5)]);
    expect(primsArea(r.prims)).toBeCloseTo(800 - (Math.PI * 25) / 2, 6);
    expect(r.prims.filter((p) => p.kind === 'arc')).toHaveLength(1);
  });

  it('différence : disque entièrement à l’intérieur → trou', () => {
    const r = booleanOperand('difference', [rect(0, 0, 40, 20), disc(20, 10, 5)]);
    expect(primsArea(r.prims)).toBeCloseTo(800 - Math.PI * 25, 6);
  });

  it('intersection de deux disques (lentille)', () => {
    const r = booleanOperand('intersection', [disc(0, 0, 10), disc(10, 0, 10)]);
    const lens = 2 * 100 * Math.acos(0.5) - 5 * Math.sqrt(400 - 100);
    expect(primsArea(r.prims)).toBeCloseTo(lens, 6);
    expect(kinds(r.prims)).toBe('arc,arc');
  });

  it('booléens imbriqués : (union) moins un trou', () => {
    const u = booleanOperand('union', [rect(0, 0, 20, 10), disc(20, 5, 5)]);
    const r = booleanOperand('difference', [u, disc(5, 5, 2)]);
    expect(primsArea(r.prims)).toBeCloseTo(200 + (Math.PI * 25) / 2 - Math.PI * 4, 6);
  });

  it('différence sans contact : la forme reste entière', () => {
    const r = booleanOperand('difference', [rect(0, 0, 10, 10), disc(50, 50, 3)]);
    expect(primsArea(r.prims)).toBeCloseTo(100, 6);
  });
});
