import { describe, expect, it } from 'vitest';
import { nodeIndex, solveFea, unitCubeStiffness, type VoxelGrid } from '../../src/sim/fea';
import { activeNodes, nodePosition, nodesNearTriangles, voxelize } from '../../src/sim/voxelize';

/** Maillage fermé d'une boîte alignée sur les axes (12 triangles, normales sortantes). */
function boxMesh(sx: number, sy: number, sz: number) {
  const p = [
    [0, 0, 0], [sx, 0, 0], [sx, sy, 0], [0, sy, 0],
    [0, 0, sz], [sx, 0, sz], [sx, sy, sz], [0, sy, sz],
  ];
  const quads = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [0, 4, 7, 3]];
  const indices = quads.flatMap(([a, b, c, d]) => [a!, b!, c!, a!, c!, d!]);
  return { positions: p.flat(), indices };
}

/** Triangles (9 nombres chacun) de la face x = valeur d'une boîte. */
const endFace = (x: number, sy: number, sz: number) => [x, 0, 0, x, sy, 0, x, sy, sz, x, 0, 0, x, sy, sz, x, 0, sz];

const PLA = { E: 3500, nu: 0.35 };
const L = 100;
const B = 10;

function beam(h = 2.5) {
  const grid = voxelize(boxMesh(L, B, B), h);
  const fixed = nodesNearTriangles(grid, endFace(0, B, B), h / 4);
  const tip = nodesNearTriangles(grid, endFace(L, B, B), h / 4);
  return { grid, fixed, tip };
}

const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;

describe('simulation : éléments finis voxels', () => {
  it('raideur du cube : symétrique, sans effort pour un déplacement d’ensemble', () => {
    const K = unitCubeStiffness(0.3);
    for (let p = 0; p < 24; p++) for (let q = 0; q < 24; q++) expect(K[p * 24 + q]!).toBeCloseTo(K[q * 24 + p]!, 9);
    for (let c = 0; c < 3; c++) {
      for (let p = 0; p < 24; p++) {
        let s = 0;
        for (let a = 0; a < 8; a++) s += K[p * 24 + 3 * a + c]!;
        expect(Math.abs(s)).toBeLessThan(1e-9);
      }
    }
  });

  it('voxelisation d’une boîte : tous les cubes pleins, nœuds des faces retrouvés', () => {
    const { grid, fixed, tip } = beam();
    expect([grid.nx, grid.ny, grid.nz]).toEqual([40, 4, 4]);
    expect(grid.solid.every((v) => v === 1)).toBe(true);
    expect(activeNodes(grid).length).toBe(41 * 5 * 5);
    expect(fixed.length).toBe(25);
    expect(tip.every((n) => Math.abs(nodePosition(grid, n).x - L) < 1e-9)).toBe(true);
  });

  it('traction : allongement F·L / (E·S)', () => {
    const { grid, fixed, tip } = beam();
    const F = 1000;
    const forces = new Map(tip.map((n) => [n, { x: F / tip.length, y: 0, z: 0 }]));
    const r = solveFea({ grid, material: PLA, fixedNodes: fixed, forces });
    expect(r.converged).toBe(true);
    const ux = mean(tip.map((n) => r.displacement[3 * n]!));
    expect(ux / ((F * L) / (PLA.E * B * B))).toBeGreaterThan(0.97);
    expect(ux / ((F * L) / (PLA.E * B * B))).toBeLessThan(1.01);
  });

  it('poutre console : flèche F·L³ / (3·E·I), contrainte maximale près de l’encastrement', () => {
    const { grid, fixed, tip } = beam();
    const F = 10;
    const forces = new Map(tip.map((n) => [n, { x: 0, y: 0, z: -F / tip.length }]));
    const r = solveFea({ grid, material: PLA, fixedNodes: fixed, forces });
    expect(r.converged).toBe(true);
    const I = (B * B ** 3) / 12;
    const expected = (F * L ** 3) / (3 * PLA.E * I);
    const w = -mean(tip.map((n) => r.displacement[3 * n + 2]!));
    // Modes incompatibles : à quelques % de la théorie des poutres (sans eux, ~ 30 % trop raide).
    expect(w / expected).toBeGreaterThan(0.95);
    expect(w / expected).toBeLessThan(1.06);
    // Contrainte de flexion M·c / I à l'encastrement : 6 MPa (au centre des cubes, un peu moins).
    expect(r.maxVonMises).toBeGreaterThan(3.5);
    expect(r.maxVonMises).toBeLessThan(9);
    const hot = r.vonMises.indexOf(r.maxVonMises);
    expect(hot % grid.nx).toBeLessThan(3);
  });

  it('cube isolé sans encastrement ni force : rien ne bouge', () => {
    const grid: VoxelGrid = { nx: 1, ny: 1, nz: 1, h: 1, origin: { x: 0, y: 0, z: 0 }, solid: new Uint8Array([1]) };
    const r = solveFea({ grid, material: PLA, fixedNodes: [nodeIndex(grid, 0, 0, 0)], forces: new Map() });
    expect(r.maxDisplacement).toBe(0);
  });
});
