import { describe, expect, it } from 'vitest';
import { centered, loopBounds, nest, placeLoops, placementProblems, type Loop } from '../../src/app/nesting';

const rect = (w: number, h: number): Loop => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
const piece = (key: string, loops: Loop[]) => ({ key, loops: centered(loops).loops });
const placedLoops = (pieces: { key: string; loops: Loop[] }[], pl: ReturnType<typeof nest>) =>
  pl.map((p) => ({ sheet: p.sheet, loops: placeLoops(pieces.find((x) => x.key === p.key)!.loops, p) }));

describe('imbrication laser', () => {
  it('4 rectangles qui remplissent juste une plaque : une seule plaque, sans chevauchement ni débord', () => {
    const pieces = [0, 1, 2, 3].map((i) => piece(`r${i}`, [rect(140, 90)]));
    const pl = nest(pieces, { w: 300, h: 200 }, 5);
    expect(pl).toHaveLength(4);
    expect(pl.every((p) => p.sheet === 0)).toBe(true);
    const problems = placementProblems(placedLoops(pieces, pl), { w: 300, h: 200 });
    expect(problems.overlap.size).toBe(0);
    expect(problems.outside.size).toBe(0);
  });

  it('une pièce trop haute dans un sens est tournée pour tenir', () => {
    const pieces = [piece('long', [rect(50, 280)])];
    const [p] = nest(pieces, { w: 300, h: 200 }, 5);
    expect(p!.sheet).toBe(0);
    expect(p!.angle % 180).toBe(90);
    const b = loopBounds(placeLoops(pieces[0]!.loops, p!));
    expect(b.maxX).toBeLessThanOrEqual(300);
    expect(b.maxY).toBeLessThanOrEqual(200);
  });

  it('une petite pièce se loge dans le trou d’une grande ; le reste passe sur une 2e plaque', () => {
    const frame = piece('cadre', [rect(180, 180), [{ x: 20, y: 20 }, { x: 20, y: 160 }, { x: 160, y: 160 }, { x: 160, y: 20 }]]);
    const small = piece('petite', [rect(60, 60)]);
    const big = piece('grande', [rect(190, 190)]);
    const pieces = [frame, small, big];
    const pl = nest(pieces, { w: 200, h: 200 }, 4);
    const at = (k: string) => pl.find((p) => p.key === k)!;
    expect(at('cadre').sheet).toBe(at('petite').sheet);
    expect(at('grande').sheet).not.toBe(at('cadre').sheet);
    const problems = placementProblems(placedLoops(pieces, pl), { w: 200, h: 200 });
    expect(problems.overlap.size).toBe(0);
  });

  it('chevauchement et débord signalés', () => {
    const a = { sheet: 0, loops: [rect(50, 50)] };
    const b = { sheet: 0, loops: [rect(50, 50).map((p) => ({ x: p.x + 30, y: p.y + 30 }))] };
    const c = { sheet: 0, loops: [rect(50, 50).map((p) => ({ x: p.x + 280, y: p.y }))] };
    const d = { sheet: 1, loops: [rect(50, 50)] };
    const r = placementProblems([a, b, c, d], { w: 300, h: 200 });
    expect([...r.overlap].sort()).toEqual([0, 1]);
    expect([...r.outside]).toEqual([2]);
  });
});
