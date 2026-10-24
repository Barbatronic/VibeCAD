import { beforeAll, describe, expect, it } from 'vitest';
import { placeFasteners } from '../../src/app/fasteners';
import { RecomputeEngine } from '../../src/features/engine';
import type { GeometryKernel } from '../../src/geometry/kernel';
import { documentForWorker } from '../../src/geometry/protocol';
import { translation4 } from '../../src/math/mat4';
import { GeometryService } from '../../src/workers/geometry-service';
import { demoMotorMount } from '../helpers/demo-motor';
import { getKernel } from '../helpers/kernel';

let kernel: GeometryKernel;
beforeAll(async () => {
  kernel = await getKernel();
});

describe('projet de démonstration : support moteur NEMA 17', () => {
  it('chaque pièce se calcule, toute la visserie trouve son trou', () => {
    const doc = demoMotorMount();
    const engine = new RecomputeEngine(kernel, { get: () => undefined });
    const res = engine.evaluateDocument(doc);
    for (const p of res) {
      const part = doc.parts.find((x) => x.id === p.partId)!;
      expect({ part: part.name, states: p.statuses.map((s) => s.message ?? s.state) }).toEqual({ part: part.name, states: p.statuses.map(() => 'ok') });
      expect(p.analysis?.solidCount).toBe(1);
    }
    // Capot : tôle pliée deux fois, fentes reportées sur le développé.
    const cover = res.find((p) => doc.parts.find((x) => x.id === p.partId)!.name === 'Capot')!;
    expect(cover.sheet?.folds).toHaveLength(2);
    expect(cover.sheet?.later).toEqual([]);
    const meshes = new Map(res.map((p) => [p.partId, engine.meshOf(p, { linearDeflection: 0.05, angularDeflection: 0.3 })]));
    const inst = new Map(doc.assembly!.instances.map((i) => [i.id, translation4(i.position)]));
    const { matrices, issues } = placeFasteners(doc.assembly!, (id) => meshes.get(id), (id) => inst.get(id));
    expect([...issues.entries()]).toEqual([]);
    expect(matrices.size).toBe(doc.assembly!.fasteners!.length);
  });

  it('les pièces ne se traversent pas', () => {
    const doc = demoMotorMount();
    const placements = doc.assembly!.instances.map((i) => ({
      instanceId: i.id,
      partId: i.partId,
      matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, i.position.x, i.position.y, i.position.z, 1],
    }));
    const { collisions } = new GeometryService(kernel).collisions(documentForWorker(doc), placements);
    expect(collisions.map((c) => `${c.a} / ${c.b} : ${c.volume}`)).toEqual([]);
  });
});
