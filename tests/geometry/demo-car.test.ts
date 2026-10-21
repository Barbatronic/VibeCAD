import { beforeAll, describe, expect, it } from 'vitest';
import { RecomputeEngine } from '../../src/features/engine';
import type { GeometryKernel } from '../../src/geometry/kernel';
import { documentForWorker } from '../../src/geometry/protocol';
import { GeometryService } from '../../src/workers/geometry-service';
import { demoCar } from '../helpers/demo-car';
import { getKernel } from '../helpers/kernel';

let kernel: GeometryKernel;
beforeAll(async () => {
  kernel = await getKernel();
});

describe('projet de démonstration (captures de la documentation)', () => {
  it('la petite voiture se calcule sans erreur', () => {
    const doc = demoCar();
    const res = new RecomputeEngine(kernel, { get: () => undefined }).evaluateDocument(doc);
    for (const p of res) {
      const part = doc.parts.find((x) => x.id === p.partId)!;
      expect({ part: part.name, states: p.statuses.map((s) => s.message ?? s.state) }).toEqual({ part: part.name, states: p.statuses.map(() => 'ok') });
      expect(p.analysis?.solidCount).toBe(1);
    }
    // Carrosserie : pliée, fenêtres reportées sur le développé.
    const body = res.find((p) => doc.parts.find((x) => x.id === p.partId)!.name === 'Carrosserie')!;
    expect(body.sheet?.folds).toHaveLength(2);
    expect(body.sheet?.later).toEqual([]);
  });

  it('aucune pièce de l’assemblage n’en traverse une autre', () => {
    const doc = demoCar();
    const placements = doc.assembly!.instances.map((i) => ({
      instanceId: i.id,
      partId: i.partId,
      matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, i.position.x, i.position.y, i.position.z, 1],
    }));
    const { collisions } = new GeometryService(kernel).collisions(documentForWorker(doc), placements);
    const names = (id: string) => doc.assembly!.instances.find((i) => i.id === id)!.name;
    expect(collisions.map((c) => `${names(c.a)} / ${names(c.b)} : ${c.volume}`)).toEqual([]);
  });
});
