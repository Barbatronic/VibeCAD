import { describe, expect, it } from 'vitest';
import { exaggerationFor, gridFor, heatColor, meshVolume, refineMesh, runStudy, StudyError, surfaceNodes } from '../../src/sim/study';

/** Maillage fermé d'une boîte alignée sur les axes. */
function boxMesh(sx: number, sy: number, sz: number) {
  const p = [
    [0, 0, 0], [sx, 0, 0], [sx, sy, 0], [0, sy, 0],
    [0, 0, sz], [sx, 0, sz], [sx, sy, sz], [0, sy, sz],
  ];
  const quads = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [0, 4, 7, 3]];
  const indices = quads.flatMap(([a, b, c, d]) => [a!, b!, c!, a!, c!, d!]);
  return { positions: Float32Array.from(p.flat()), indices: Uint32Array.from(indices) };
}

const endFace = (x: number, sy: number, sz: number) => Float32Array.from([x, 0, 0, x, sy, 0, x, sy, sz, x, 0, 0, x, sy, sz, x, 0, sz]);

const L = 100;
const B = 10;
const PLA = { E: 3000, nu: 0.36 };

describe('simulation : étude d’une pièce', () => {
  it('volume d’un maillage fermé', () => {
    const m = boxMesh(L, B, B);
    expect(meshVolume(m.positions, m.indices)).toBeCloseTo(L * B * B, 6);
  });

  it('taille des cubes choisie pour approcher le nombre visé', () => {
    const m = boxMesh(L, B, B);
    const g = gridFor(m.positions, m.indices, 3000);
    const cells = g.solid.reduce((s, v) => s + v, 0);
    expect(cells).toBeGreaterThan(1500);
    expect(cells).toBeLessThan(6000);
  });

  it('nœuds de surface : ni ceux de l’intérieur, ni ceux hors de la pièce', () => {
    const m = boxMesh(4, 4, 4);
    const g = gridFor(m.positions, m.indices, 64);
    // 5 × 5 × 5 nœuds, dont 3 × 3 × 3 à l'intérieur.
    expect([g.nx, g.ny, g.nz]).toEqual([4, 4, 4]);
    expect(surfaceNodes(g).length).toBe(125 - 27);
  });

  it('console encastrée : flèche proche de F·L³ / (3·E·I) au bout, déplacements reportés sur le maillage', () => {
    const m = boxMesh(L, B, B);
    const F = 10;
    const r = runStudy({ ...m, fixed: endFace(0, B, B), loaded: endFace(L, B, B), force: { x: 0, y: 0, z: -F }, material: PLA, targetCells: 3000 });
    expect(r.converged).toBe(true);
    const theory = (F * L ** 3) / (3 * PLA.E * (B ** 4 / 12));
    // Sommet du bout (x = L) : il descend d'environ la flèche théorique ; sommet encastré : immobile.
    expect(-r.displacement[3 * 1 + 2]!).toBeGreaterThan(0.85 * theory);
    expect(-r.displacement[3 * 1 + 2]!).toBeLessThan(1.15 * theory);
    expect(Math.abs(r.displacement[2]!)).toBeLessThan(0.02 * theory);
    expect(r.maxDisplacement).toBeGreaterThan(0.85 * theory);
    // Contrainte maximale à l'encastrement : M·c / I = 6·F·L / B³ (pic local accepté).
    const sigma = (6 * F * L) / B ** 3;
    expect(r.maxStress).toBeGreaterThan(0.5 * sigma);
    expect(r.maxStress).toBeLessThan(3 * sigma);
    expect(r.stress[0]!).toBeGreaterThan(r.stress[1]!);
  });

  it('matériau souple (TPU, ν = 0,45) : la flèche suit encore la théorie', () => {
    const m = boxMesh(L, B, B);
    const TPU = { E: 30, nu: 0.45 };
    const F = 0.1;
    const r = runStudy({ ...m, fixed: endFace(0, B, B), loaded: endFace(L, B, B), force: { x: 0, y: 0, z: -F }, material: TPU, targetCells: 3000 });
    expect(r.converged).toBe(true);
    const theory = (F * L ** 3) / (3 * TPU.E * (B ** 4 / 12));
    expect(-r.displacement[3 * 1 + 2]! / theory).toBeGreaterThan(0.85);
    expect(-r.displacement[3 * 1 + 2]! / theory).toBeLessThan(1.15);
  });

  it('erreurs : aucune face fixée, aucune face chargée', () => {
    const m = boxMesh(L, B, B);
    const base = { ...m, force: { x: 0, y: 0, z: -1 }, material: PLA, targetCells: 500 };
    const code = (f: () => unknown) => {
      try {
        f();
      } catch (e) {
        return (e as StudyError).code;
      }
      return null;
    };
    expect(code(() => runStudy({ ...base, fixed: new Float32Array(), loaded: endFace(L, B, B) }))).toBe('NO_FIXED');
    expect(code(() => runStudy({ ...base, fixed: endFace(0, B, B), loaded: endFace(0, B, B) }))).toBe('NO_LOAD');
  });

  it('subdivision du maillage : arêtes courtes, volume conservé, aucune fente', () => {
    const m = boxMesh(L, B, B);
    const r = refineMesh(m.positions, m.indices, 3);
    expect(meshVolume(r.positions, r.indices)).toBeCloseTo(L * B * B, 3);
    const edges = new Map<string, number>();
    const key = (v: number) => [0, 1, 2].map((c) => r.positions[3 * v + c]!.toFixed(4)).join(',');
    for (let t = 0; t < r.indices.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        const a = r.indices[t + e]!;
        const b = r.indices[t + ((e + 1) % 3)]!;
        const d = Math.hypot(...[0, 1, 2].map((c) => r.positions[3 * a + c]! - r.positions[3 * b + c]!));
        expect(d).toBeLessThanOrEqual(3 + 1e-6);
        const k = [key(a), key(b)].sort().join('|');
        edges.set(k, (edges.get(k) ?? 0) + 1);
      }
    }
    // Maillage fermé et conforme : chaque arête est partagée par exactement deux triangles.
    expect([...edges.values()].every((n) => n === 2)).toBe(true);
    expect(r.indices.length / 3).toBeGreaterThan(500);
  });

  it('exagération et couleurs', () => {
    expect(exaggerationFor(0.1, 100)).toBeCloseTo(80, 6);
    expect(exaggerationFor(50, 100)).toBe(1);
    expect(heatColor(0)[2]).toBeGreaterThan(0.5);
    expect(heatColor(1)[0]).toBeGreaterThan(0.8);
  });
});
