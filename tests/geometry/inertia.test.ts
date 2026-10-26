import { beforeAll, describe, expect, it } from 'vitest';
import { addFeature, createDocument, findPart, makePrimitiveFeature } from '../../src/domain/document';
import { RecomputeEngine } from '../../src/features/engine';
import type { GeometryKernel } from '../../src/geometry/kernel';
import { getKernel } from '../helpers/kernel';

let kernel: GeometryKernel;
beforeAll(async () => {
  kernel = await getKernel();
});

describe('analyse : matrice d’inertie', () => {
  it('pavé 40 × 20 × 10 : moments d’un pavé plein, sans terme croisé', () => {
    let doc = createDocument('Pavé');
    const partId = doc.parts[0]!.id;
    const box = makePrimitiveFeature(doc, findPart(doc, partId)!, 'box');
    doc = addFeature(doc, partId, { ...box, params: { ...box.params, width: 40, depth: 20, height: 10 } });
    const [r] = new RecomputeEngine(kernel, { get: () => undefined }).evaluateDocument(doc);
    const I = r!.analysis!.inertia!;
    const V = 40 * 20 * 10;
    // Masse volumique 1 : Ixx = V (b² + c²) / 12, etc.
    expect(I[0]).toBeCloseTo((V * (20 ** 2 + 10 ** 2)) / 12, 3);
    expect(I[4]).toBeCloseTo((V * (40 ** 2 + 10 ** 2)) / 12, 3);
    expect(I[8]).toBeCloseTo((V * (40 ** 2 + 20 ** 2)) / 12, 3);
    for (const k of [1, 2, 3, 5, 6, 7]) expect(Math.abs(I[k]!)).toBeLessThan(1e-3);
  });
});
