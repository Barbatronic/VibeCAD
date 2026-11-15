import { describe, expect, it } from 'vitest';
import { buildBvh, raycastBvh } from '../../src/viewport/bvh';

/** Générateur pseudo-aléatoire reproductible. */
function random(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

/** Lancer de rayon sur tous les triangles, sans accélération (référence). */
function brute(positions: Float32Array, index: Uint32Array, o: [number, number, number], d: [number, number, number]) {
  let best = Infinity;
  let hit = -1;
  for (let t = 0; t < index.length / 3; t++) {
    const one = buildBvh(positions, index.subarray(3 * t, 3 * t + 3));
    const r = raycastBvh(one, positions, index.subarray(3 * t, 3 * t + 3), o, d);
    if (r && r.t < best) {
      best = r.t;
      hit = t;
    }
  }
  return hit >= 0 ? { t: best, triangle: hit } : null;
}

describe('arbre de sélection (BVH)', () => {
  it('trouve le même premier triangle qu’un parcours de tous les triangles', () => {
    const rnd = random(42);
    const n = 600;
    const positions = new Float32Array(9 * n);
    const index = new Uint32Array(3 * n);
    for (let t = 0; t < n; t++) {
      const c = [rnd() * 100, rnd() * 100, rnd() * 100];
      for (let v = 0; v < 3; v++) for (let k = 0; k < 3; k++) positions[9 * t + 3 * v + k] = c[k]! + (rnd() - 0.5) * 12;
      index.set([3 * t, 3 * t + 1, 3 * t + 2], 3 * t);
    }
    const bvh = buildBvh(positions, index);
    let hits = 0;
    for (let i = 0; i < 300; i++) {
      const o: [number, number, number] = [rnd() * 100, rnd() * 100, -50];
      // Quelques rayons parallèles à un axe (divisions par zéro dans le test des boîtes).
      const raw = i % 10 === 0 ? [0, 0, 1] : [rnd() - 0.5, rnd() - 0.5, 1];
      const len = Math.hypot(raw[0]!, raw[1]!, raw[2]!);
      const d: [number, number, number] = [raw[0]! / len, raw[1]! / len, raw[2]! / len];
      const fast = raycastBvh(bvh, positions, index, o, d);
      const slow = brute(positions, index, o, d);
      expect(fast?.triangle ?? -1).toBe(slow?.triangle ?? -1);
      if (fast && slow) expect(fast.t).toBeCloseTo(slow.t, 9);
      if (fast) hits++;
    }
    expect(hits).toBeGreaterThan(50);
  });

  it('respecte la distance maximale et gère un maillage vide', () => {
    const positions = Float32Array.from([0, 0, 10, 10, 0, 10, 0, 10, 10]);
    const index = Uint32Array.from([0, 1, 2]);
    const bvh = buildBvh(positions, index);
    expect(raycastBvh(bvh, positions, index, [1, 1, 0], [0, 0, 1])).toEqual({ t: 10, triangle: 0 });
    expect(raycastBvh(bvh, positions, index, [1, 1, 0], [0, 0, 1], 5)).toBeNull();
    expect(raycastBvh(buildBvh(new Float32Array(0), new Uint32Array(0)), new Float32Array(0), new Uint32Array(0), [0, 0, 0], [0, 0, 1])).toBeNull();
  });
});
