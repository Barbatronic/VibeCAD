import { beforeAll, describe, expect, it } from 'vitest';
import { RecomputeEngine } from '../../src/features/engine';
import type { GeometryKernel } from '../../src/geometry/kernel';
import { getKernel } from '../helpers/kernel';
import { buildPlateDocument } from '../helpers/plate';

let kernel: GeometryKernel;
beforeAll(async () => {
  kernel = await getKernel();
});

describe('centre de gravité', () => {
  it('plaque percée : décalé du côté opposé au trou', () => {
    const { doc } = buildPlateDocument();
    const [res] = new RecomputeEngine(kernel, { get: () => undefined }).evaluateDocument(doc);
    const g = res!.analysis!.centroid!;
    const hole = Math.PI * 9 * 5;
    // Plaque pleine centrée en (30, 15, 2,5), moins le trou centré en (15, 15).
    expect(g.x).toBeCloseTo((9000 * 30 - hole * 15) / (9000 - hole), 6);
    expect(g.y).toBeCloseTo(15, 6);
    expect(g.z).toBeCloseTo(2.5, 6);
  });
});
