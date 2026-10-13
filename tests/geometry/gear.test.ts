import { beforeAll, describe, expect, it } from 'vitest';
import { addFeature, createDocument, makeGearFeature } from '../../src/domain/document';
import type { GearFeature } from '../../src/domain/model';
import { RecomputeEngine } from '../../src/features/engine';
import { gearShape } from '../../src/features/gear/evaluate';
import { pulleyOutsideDiameter, rackProfile, spurGearProfile, pulleyProfile } from '../../src/features/gear/profiles';
import type { GeometryKernel } from '../../src/geometry/kernel';
import { multiply4, rotationZ4, translation4 } from '../../src/math/mat4';
import { getKernel } from '../helpers/kernel';

let kernel: GeometryKernel;
beforeAll(async () => {
  kernel = await getKernel();
});

function gear(params: Partial<GearFeature['params']>): GearFeature {
  const doc = createDocument('g');
  const f = makeGearFeature(doc, doc.parts[0]!);
  return { ...f, params: { ...f.params, ...params } };
}

function evaluate(feature: GearFeature) {
  const doc0 = createDocument('g');
  const doc = addFeature(doc0, doc0.parts[0]!.id, { ...feature, id: 'ge-1' });
  const [part] = new RecomputeEngine(kernel, { get: () => undefined }).evaluateDocument(doc);
  return part!;
}

describe('générateurs : solides', () => {
  it('roue dentée m 2 × 20 dents, épaisseur 6, alésage 5 : solide valide, volume = aire du profil × épaisseur', () => {
    const part = evaluate(gear({ kind: 'spur', module: 2, teeth: 20, thickness: 6, bore: 5 }));
    expect(part.failedFeatureId).toBeNull();
    expect(part.analysis!.valid).toBe(true);
    const area = spurGearProfile(2, 20, 20, 5).area;
    expect(Math.abs(part.analysis!.volume - area * 6) / (area * 6)).toBeLessThan(2e-3);
    expect(part.analysis!.bbox!.max.x).toBeCloseTo(22, 2);
  });

  it('crémaillère : volume exact (contour polygonal)', () => {
    const part = evaluate(gear({ kind: 'rack', module: 1.5, teeth: 10, thickness: 8, rackHeight: 4 }));
    expect(part.analysis!.valid).toBe(true);
    expect(part.analysis!.volume).toBeCloseTo(rackProfile(1.5, 10, 20, 4).area * 8, 3);
  });

  it('poulie GT2 20 dents avec joues : Ø 12,22 mm, joues de 1 mm de chaque côté', () => {
    const part = evaluate(gear({ kind: 'pulley', belt: 'GT2-2', teeth: 20, thickness: 7, bore: 5, flanges: true }));
    expect(part.analysis!.valid).toBe(true);
    const bb = part.analysis!.bbox!;
    expect(bb.max.z - bb.min.z).toBeCloseTo(9, 6);
    expect(bb.max.x).toBeCloseTo(pulleyOutsideDiameter('GT2-2', 20) / 2 + 1.5, 3);
    const body = pulleyProfile('GT2-2', 20, 5).area * 7;
    const flange = (Math.PI * ((12.224 / 2 + 1.5) ** 2 - 2.5 ** 2)) * 2;
    expect(Math.abs(part.analysis!.volume - (body + flange)) / (body + flange)).toBeLessThan(3e-3);
  });

  it('deux roues de même module à l’entraxe théorique engrènent sans se rentrer dedans ; décalées d’une demi-dent, elles se chevauchent', () => {
    const m = 2;
    const z1 = 17;
    const z2 = 24;
    const a = (m * (z1 + z2)) / 2;
    const g1 = gearShape(kernel, gear({ kind: 'spur', module: m, teeth: z1, thickness: 5, bore: 0 }));
    const raw2 = gearShape(kernel, gear({ kind: 'spur', module: m, teeth: z2, thickness: 5, bore: 0 }));
    // La roue 2 présente un creux face à la dent de la roue 1 (dent en 0°) : z2 pair → demi-pas.
    const place = (extra: number) => kernel.transformed(raw2, multiply4(translation4({ x: a, y: 0, z: 0 }), rotationZ4(Math.PI / z2 + extra)));
    const meshed = place(0);
    const overlap = kernel.analyze(kernel.common(g1, meshed)).volume;
    // Contact sans jeu entre développantes : volume commun quasi nul (numérique).
    expect(overlap).toBeLessThan(0.05);
    const wrong = place(Math.PI / z2);
    const clash = kernel.analyze(kernel.common(g1, wrong)).volume;
    expect(clash).toBeGreaterThan(10);
  });
});
