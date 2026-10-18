import { beforeAll, describe, expect, it } from 'vitest';
import type { GeometryKernel, KernelShape } from '../../src/geometry/kernel';
import { foldSheet, type FoldSpec } from '../../src/features/sheet/fold';
import { originPlaneFrame } from '../../src/math/frame';
import { getKernel } from '../helpers/kernel';

let kernel: GeometryKernel;
beforeAll(async () => {
  kernel = await getKernel();
});

/** Tôle 100 × 40 × 2 mm (x 0 → 100, y 0 → 40, z 0 → 2). */
const plate = (): KernelShape =>
  kernel.makePrimitive({ featureId: 'base', shape: 'box', position: { x: 0, y: 0, z: 0 }, width: 100, depth: 40, height: 2, diameter: 1, thickness: 1 });

const frame = originPlaneFrame('XY');
// Ligne x = 60 (direction +Y) ; le côté x > 60 (à droite de +Y) se plie.
const fold = (over: Partial<FoldSpec> = {}): FoldSpec => ({ featureId: 'pli', point: { x: 60, y: 0 }, dir: { x: 0, y: 1 }, side: -1, angle: Math.PI / 2, radius: 2, k: 0.5, ...over });

describe('tôlerie : pli d’une tôle', () => {
  it('pli à 90° vers le haut : volume conservé (K = 0,5), rebord vertical à la bonne place', () => {
    const flat = plate();
    const bent = foldSheet(kernel, { flat, frame, thickness: 2, folds: [fold()] });
    const a = kernel.analyze(bent);
    expect(a.valid).toBe(true);
    expect(a.solidCount).toBe(1);
    expect(a.volume).toBeCloseTo(100 * 40 * 2, 0);
    // Axe à x = 60, z = 4 ; rebord entre x = 62 et 64, de z = 4 à 4 + (40 − π/2 · 3).
    const allowance = (Math.PI / 2) * 3;
    expect(a.bbox!.max.x).toBeCloseTo(64, 3);
    expect(a.bbox!.max.z).toBeCloseTo(4 + 40 - allowance, 3);
    expect(a.bbox!.min.z).toBeCloseTo(0, 6);
    // Le plat n'est pas touché.
    expect(kernel.analyze(flat).volume).toBeCloseTo(8000, 6);
    kernel.dispose(bent);
    kernel.dispose(flat);
  });

  it('pli vers le bas, et deux plis parallèles (profil en U)', () => {
    const flat = plate();
    const down = foldSheet(kernel, { flat, frame, thickness: 2, folds: [fold({ angle: -Math.PI / 2 })] });
    const d = kernel.analyze(down);
    expect(d.volume).toBeCloseTo(8000, 0);
    expect(d.bbox!.max.z).toBeCloseTo(2, 6);
    expect(d.bbox!.min.z).toBeLessThan(-30);
    // U : plis à x = 20 (le côté x < 20 se plie) et à x = 80 (le côté x > 80).
    const u = foldSheet(kernel, { flat, frame, thickness: 2, folds: [fold({ point: { x: 20, y: 0 }, side: 1 }), fold({ point: { x: 80, y: 0 } })] });
    const ua = kernel.analyze(u);
    expect(ua.solidCount).toBe(1);
    expect(ua.volume).toBeCloseTo(8000, 0);
    // Les deux rebords montent : chaque pli part de sa ligne (arrondi extérieur à 4 mm au-delà).
    expect(ua.bbox!.max.z).toBeCloseTo(4 + 20 - (Math.PI / 2) * 3, 3);
    expect(ua.bbox!.min.x).toBeCloseTo(16, 3);
    expect(ua.bbox!.max.x).toBeCloseTo(84, 3);
    for (const s of [down, u, flat]) kernel.dispose(s);
  });

  it('pli de 45° : le volume reste celui de la tôle', () => {
    const flat = plate();
    const bent = foldSheet(kernel, { flat, frame, thickness: 2, folds: [fold({ angle: Math.PI / 4 })] });
    expect(kernel.analyze(bent).volume).toBeCloseTo(8000, 0);
    kernel.dispose(bent);
    kernel.dispose(flat);
  });
});
