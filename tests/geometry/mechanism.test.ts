import { beforeAll, describe, expect, it } from 'vitest';
import { computeMechanism, defaultMechanismStudy, drivableJoints, type MassOf } from '../../src/app/mechanism';
import { writeFileSync } from 'node:fs';
import type { GeometryKernel } from '../../src/geometry/kernel';
import { serializeDocument } from '../../src/io/native-format';
import { armProject } from '../helpers/arm';
import { getKernel } from '../helpers/kernel';

let kernel: GeometryKernel;
beforeAll(async () => {
  kernel = await getKernel();
});

describe('étude « Mécanisme » : couple nécessaire sur une liaison', () => {
  it.runIf(!!process.env.FIXTURE_OUT)('projet du bras écrit pour les tests e2e', () => {
    writeFileSync(`${process.env.FIXTURE_OUT}/mechanism-arm.vibecad`, serializeDocument(armProject(kernel).doc, '2026-10-26T00:00:00.000Z') + '\n');
  });

  it('bras en pivot sur un axe horizontal : couple du poids = m g r cos θ', () => {
    const { doc, arm, meshes, analysis } = armProject(kernel);
    const assembly = doc.assembly!;
    // Bras en PLA : masse en kg, centre de gravité en mm (repère de la pièce).
    const massOf: MassOf = (partId) => {
      const a = analysis.get(partId);
      return a?.centroid ? { mass: (a.volume / 1000) * 1.24 / 1000, centroid: a.centroid, inertia: a.inertia!.map((v) => v * 1.24e-12) } : null;
    };
    expect(drivableJoints(assembly).map((d) => [d.joint.id, d.kind])).toEqual([['pivot', 'angle']]);
    const study = { ...defaultMechanismStudy(assembly.joints[0]!, 'angle'), safety: 1 };
    expect([study.from, study.to]).toEqual([0, 360]);
    const result = computeMechanism(assembly, study, (id) => meshes.get(id), massOf)!;
    expect(result.unit).toBe('N·m');
    expect(result.failed).toBe(0);
    // Masse du bras et bras de levier : centre de gravité à 20 mm de l'axe (barre de 50, axe à 5).
    const m = massOf(arm)!.mass;
    const expected = m * 9.81 * 0.02;
    expect(result.movingMass).toBeCloseTo(m, 6);
    expect(Math.abs(result.peak!.value)).toBeCloseTo(expected, 4);
    expect(result.required).toBeCloseTo(expected, 4);
    // Sinusoïde sur un tour : nulle au quart de tour du maximum, opposée à l'opposé.
    const at = (deg: number) => result.samples.find((s) => Math.abs(s.at - deg) < 1e-9)!.gravity!;
    const peakAt = result.peak!.at;
    expect(Math.abs(at((peakAt + 90) % 360))).toBeLessThan(expected * 0.01);
    expect(at((peakAt + 180) % 360)).toBeCloseTo(-result.peak!.value, 4);

    // Accélération de 10 rad/s² : + J α, J = m r² + inertie propre du bras autour de l'axe Y. Le
    // trou près de l'axe éloigne un peu le centre de gravité : r vient du couple de pesanteur.
    const r = Math.abs(result.peak!.value) / (m * 9.81);
    expect(r).toBeGreaterThan(0.02);
    expect(r).toBeLessThan(0.022);
    const fast = computeMechanism(assembly, { ...study, acceleration: 10, friction: 0.01, safety: 2 }, (id) => meshes.get(id), massOf)!;
    const J = m * r ** 2 + massOf(arm)!.inertia![4]!;
    expect(Math.abs(fast.peak!.value)).toBeCloseTo(Math.abs(result.peak!.value) + J * 10, 7);
    expect(fast.required).toBeCloseTo((Math.abs(fast.peak!.value) + 0.01) * 2, 6);

    // Masse portée de 50 g, posée au centre de gravité du bras : + 0,05 g r.
    const loaded = computeMechanism(assembly, { ...study, loads: [{ instanceKey: 'bras', mass: 0.05 }] }, (id) => meshes.get(id), massOf)!;
    expect(Math.abs(loaded.peak!.value)).toBeCloseTo(Math.abs(result.peak!.value) + 0.05 * 9.81 * r, 7);
    expect(loaded.movingMass).toBeCloseTo(m + 0.05, 6);
  });
});
