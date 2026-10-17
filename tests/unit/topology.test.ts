import { describe, expect, it } from 'vitest';
import { meshVolume } from '../../src/sim/study';
import { closeThinContacts, keepHeldPieces, runTopology, topologySurface } from '../../src/sim/topology';

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

const face = (x: number, sy: number, z0: number, z1: number) => Float32Array.from([x, 0, z0, x, sy, z0, x, sy, z1, x, 0, z0, x, sy, z1, x, 0, z1]);

const PLA = { E: 3000, nu: 0.36 };
// Console 60 × 6 × 30 mm encastrée en x = 0, chargée vers le bas au bas du bout (x = 60).
const L = 60;
const T = 6;
const H = 30;

describe('optimisation topologique', () => {
  const m = boxMesh(L, T, H);
  const r = runTopology({ ...m, fixed: face(0, T, 0, H), loaded: face(L, T, 0, 4), force: { x: 0, y: 0, z: -100 }, material: PLA, targetCells: 3000, volumeFraction: 0.4 });

  it('respecte la part de matière visée et rend la pièce plus raide au fil des itérations', () => {
    expect(r.volumeFraction).toBeGreaterThan(0.37);
    expect(r.volumeFraction).toBeLessThan(0.43);
    expect(r.history.at(-1)!).toBeLessThan(r.history[0]!);
    // Moins raide que la pièce pleine (mesuré : 37 % de sa raideur avec 40 % de la matière ; une
    // console pleine percée au hasard au même volume en garderait bien moins).
    expect(r.compliance).toBeGreaterThan(r.complianceFull);
    expect(r.complianceFull / r.compliance).toBeGreaterThan(0.3);
    expect(r.converged).toBe(true);
  });

  it('met la matière sur le haut et le bas de la console (là où la flexion tire et pousse)', () => {
    const { nx, ny, nz } = r.grid;
    const mean = (k0: number, k1: number) => {
      let s = 0;
      let n = 0;
      for (let k = k0; k < k1; k++)
        for (let j = 0; j < ny; j++)
          for (let i = 0; i < Math.floor(nx / 3); i++) {
            const d = r.density[i + nx * (j + ny * k)]!;
            if (d < 0) continue;
            s += d;
            n++;
          }
      return s / n;
    };
    const band = Math.max(1, Math.floor(nz / 6));
    const middle = mean(Math.floor(nz / 2) - band, Math.floor(nz / 2) + band);
    expect(mean(0, band)).toBeGreaterThan(middle);
    expect(mean(nz - band, nz)).toBeGreaterThan(middle);
  });

  it('densités presque toutes tranchées (plein ou vide)', () => {
    let grey = 0;
    let n = 0;
    for (const d of r.density) {
      if (d < 0) continue;
      n++;
      if (d > 0.2 && d < 0.8) grey++;
    }
    expect(grey / n).toBeLessThan(0.35);
  });

  it('forme obtenue : surface fermée, d’un volume proche des cubes gardés', () => {
    const s = topologySurface(r, 0.5, 0);
    expect(s.cells).toBeGreaterThan(0);
    // Sans lissage : exactement le volume des cubes.
    expect(meshVolume(s.positions, s.indices)).toBeCloseTo(s.volume, 3);
    // Chaque arête est partagée par un nombre pair de triangles (surface fermée).
    const edges = new Map<string, number>();
    for (let t = 0; t < s.indices.length; t += 3)
      for (let e = 0; e < 3; e++) {
        const a = s.indices[t + e]!;
        const b = s.indices[t + ((e + 1) % 3)]!;
        const key = a < b ? `${a}:${b}` : `${b}:${a}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    // Exactement deux : pas de contact par une arête (surface « pincée »).
    expect([...edges.values()].every((c) => c === 2)).toBe(true);
    // Lissée : le volume reste proche.
    const smooth = topologySurface(r, 0.5);
    expect(meshVolume(smooth.positions, smooth.indices)).toBeGreaterThan(0.85 * s.volume);
    expect(meshVolume(smooth.positions, smooth.indices)).toBeLessThan(1.1 * s.volume);
    // Seuil plus haut : moins de matière.
    expect(topologySurface(r, 0.8, 0).cells).toBeLessThanOrEqual(s.cells);
  });

  it('pièce plate : même forme sur toute l’épaisseur (trous traversants)', () => {
    expect(r.extrusion).toBe(1);
    const { nx, ny, nz } = r.grid;
    for (let k = 0; k < nz; k++)
      for (let i = 0; i < nx; i++) {
        const first = r.density[i + nx * nz * 0 + nx * ny * k]!;
        for (let j = 1; j < ny; j++) {
          const d = r.density[i + nx * (j + ny * k)]!;
          if (d >= 0 && first >= 0) expect(d).toBe(first);
        }
      }
  });

  it('forme libre en 3D quand on la demande', () => {
    const free = runTopology({ ...m, fixed: face(0, T, 0, H), loaded: face(L, T, 0, 4), force: { x: 0, y: 0, z: -100 }, material: PLA, targetCells: 1500, volumeFraction: 0.4, extrusion: null, maxIterations: 15 });
    expect(free.extrusion).toBeNull();
    expect(free.volumeFraction).toBeGreaterThan(0.37);
    expect(free.volumeFraction).toBeLessThan(0.43);
  });

  it('durée raisonnable (3 200 cubes : environ 9 s, 40 itérations)', () => {
    expect(r.durationMs).toBeLessThan(60_000);
  });
});

describe('optimisation topologique : forme d’un seul tenant', () => {
  it('comble un contact par une arête et par un coin', () => {
    // 2 × 2 × 1 : deux cubes en diagonale.
    const edge = Uint8Array.from([1, 0, 0, 1]);
    closeThinContacts(edge, 2, 2, 1);
    expect(edge.reduce((a, v) => a + v, 0)).toBe(3);
    // 2 × 2 × 2 : deux coins opposés.
    const corner = new Uint8Array(8);
    corner[0] = corner[7] = 1;
    closeThinContacts(corner, 2, 2, 2);
    expect(corner.reduce((a, v) => a + v, 0)).toBeGreaterThanOrEqual(4);
    // Chemin par faces de 0 à 7.
    const seen = new Set([0]);
    const stack = [0];
    while (stack.length) {
      const c = stack.pop()!;
      for (const d of [1, 2, 4]) {
        const f = c ^ d;
        if (corner[f] && !seen.has(f)) {
          seen.add(f);
          stack.push(f);
        }
      }
    }
    expect(seen.has(7)).toBe(true);
  });

  it('écarte les morceaux qui ne tiennent à aucune face fixée', () => {
    // 3 × 1 × 1 : cubes 0 et 2 pleins, séparés ; seul le cube 0 touche le nœud bloqué 0.
    const keep = Uint8Array.from([1, 0, 1]);
    keepHeldPieces(keep, 3, 1, 1, [0]);
    expect([...keep]).toEqual([1, 0, 0]);
  });
});

describe('optimisation topologique : faces à garder', () => {
  it('les cubes qui touchent une face à garder restent pleins', () => {
    const m = boxMesh(L, T, H);
    // Face du dessus (z = H) gardée : en temps normal, peu de matière au milieu du dessus.
    const top = Float32Array.from([0, 0, H, L, 0, H, L, T, H, 0, 0, H, L, T, H, 0, T, H]);
    const r = runTopology({ ...m, fixed: face(0, T, 0, H), loaded: face(L, T, 0, 4), keep: top, force: { x: 0, y: 0, z: -100 }, material: PLA, targetCells: 1500, volumeFraction: 0.4, maxIterations: 10 });
    const { nx, ny, nz } = r.grid;
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < ny; j++) {
        const c = i + nx * (j + ny * (nz - 1));
        if (r.density[c]! >= 0) expect(r.passive[c]).toBe(1);
      }
  });
});
