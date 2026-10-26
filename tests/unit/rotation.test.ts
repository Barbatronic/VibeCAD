import { describe, expect, it } from 'vitest';
import { instanceMatrix } from '../../src/app/assembly';
import { eulerXYZ, rotationXYZ4, transformPoint4 } from '../../src/math/mat4';

describe('orientation d’une pièce insérée', () => {
  it('angles → matrice → angles, y compris le blocage de cardan', () => {
    for (const r of [{ x: 10, y: 20, z: 30 }, { x: -90, y: 45, z: 170 }, { x: 0, y: 0, z: -60 }]) {
      const back = eulerXYZ(rotationXYZ4(r));
      expect(rotationXYZ4(back).map((v) => +v.toFixed(9) + 0)).toEqual(rotationXYZ4(r).map((v) => +v.toFixed(9) + 0));
      expect(back.x).toBeCloseTo(r.x, 9);
      expect(back.y).toBeCloseTo(r.y, 9);
      expect(back.z).toBeCloseTo(r.z, 9);
    }
    // Y = 90° : X et Z se confondent ; la matrice est retrouvée.
    const lock = rotationXYZ4({ x: 30, y: 90, z: 20 });
    expect(rotationXYZ4(eulerXYZ(lock)).map((v) => +v.toFixed(9) + 0)).toEqual(lock.map((v) => +v.toFixed(9) + 0));
  });

  it('placement : rotation autour de l’origine de la pièce, puis position', () => {
    const m = instanceMatrix({ position: { x: 100, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 90 } });
    const p = transformPoint4(m, { x: 10, y: 0, z: 0 });
    expect(p.x).toBeCloseTo(100, 9);
    expect(p.y).toBeCloseTo(10, 9);
    expect(instanceMatrix({ position: { x: 1, y: 2, z: 3 } })).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 2, 3, 1]);
  });
});
