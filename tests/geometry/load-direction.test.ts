import { beforeAll, describe, expect, it } from 'vitest';
import { defaultStudy, studyInput } from '../../src/app/simulation';
import type { SimulationStudy } from '../../src/domain/model';
import { RecomputeEngine } from '../../src/features/engine';
import type { GeometryKernel, MeshData } from '../../src/geometry/kernel';
import { getKernel } from '../helpers/kernel';
import { buildPlateDocument } from '../helpers/plate';

let kernel: GeometryKernel;
let mesh: MeshData;
let ids: ReturnType<typeof buildPlateDocument>['ids'];
beforeAll(async () => {
  kernel = await getKernel();
  const built = buildPlateDocument();
  ids = built.ids;
  const engine = new RecomputeEngine(kernel, { get: () => undefined });
  const res = engine.evaluateDocument(built.doc)[0]!;
  mesh = engine.meshOf(res, { linearDeflection: 0.1, angularDeflection: 0.5 })!;
});

/** Plaque fixée par dessous, chargée de 10 N sur le dessus. */
function force(load: Partial<SimulationStudy['load']>) {
  const base = defaultStudy('p');
  const study: SimulationStudy = {
    ...base,
    fixed: [{ featureId: ids.extrude, role: 'start' }],
    load: { ...base.load, kind: 'force', value: 10, faces: [{ featureId: ids.extrude, role: 'end' }], ...load },
  };
  const r = studyInput(study, { kind: 'part', mesh, key: 'k' });
  if (!r.ok) throw new Error(r.message);
  return r.input.force;
}

describe('sens de la charge', () => {
  it('appuie sur la face du dessus : vers −Z ; tire dessus : vers +Z', () => {
    expect(force({ direction: 'push' }).z).toBeCloseTo(-10, 6);
    expect(force({ direction: 'pull' }).z).toBeCloseTo(10, 6);
  });

  it('direction au choix : normalisée (0 ; 1 ; −1 → 45° vers +Y et vers le bas)', () => {
    const f = force({ direction: 'custom', vector: { x: 0, y: 1, z: -1 } });
    expect([f.x, f.y, f.z].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([0, Math.round((10 / Math.SQRT2) * 1e6) / 1e6, -Math.round((10 / Math.SQRT2) * 1e6) / 1e6]);
  });

  it('une masse peut peser dans un autre sens que −Z', () => {
    const f = force({ kind: 'mass', value: 1, direction: '+x' });
    expect(f.x).toBeCloseTo(9.81, 2);
    expect(Math.abs(f.z)).toBeLessThan(1e-9);
  });
});
