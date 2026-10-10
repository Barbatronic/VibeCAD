import { beforeAll, describe, expect, it } from 'vitest';
import type { GeometryKernel, MeshData } from '../../src/geometry/kernel';
import { documentForWorker } from '../../src/geometry/protocol';
import { GeometryService } from '../../src/workers/geometry-service';
import { getKernel } from '../helpers/kernel';
import { buildPlateDocument } from '../helpers/plate';

let kernel: GeometryKernel;
beforeAll(async () => {
  kernel = await getKernel();
});

const extent = (mesh: MeshData, k: 0 | 1 | 2) => {
  const v = Array.from(mesh.positions).filter((_x, i) => i % 3 === k);
  return [Math.min(...v), Math.max(...v)];
};

describe('vue en coupe', () => {
  it('coupe la plaque à mi-largeur : la moitié gardée et la face de coupe repérée', () => {
    const { doc } = buildPlateDocument();
    const svc = new GeometryService(kernel);
    const { parts } = svc.section(documentForWorker(doc), { plane: 'YZ', offset: 15, flip: false });
    const mesh = parts[0]!.mesh!;
    expect(extent(mesh, 0)[1]).toBeCloseTo(15, 6);
    // Le plan passe par le centre du trou (x = 15) : la face de coupe est trouée d'une encoche.
    expect(parts[0]!.cutFaces.length).toBeGreaterThanOrEqual(1);
    for (const i of parts[0]!.cutFaces) expect(mesh.faces[i]!.plane!.normal.x).toBeCloseTo(1, 9);
    // Autre moitié.
    const other = svc.section(documentForWorker(doc), { plane: 'YZ', offset: 15, flip: true }).parts[0]!.mesh!;
    expect(extent(other, 0)[0]).toBeCloseTo(15, 6);
    expect(extent(other, 0)[1]).toBeCloseTo(60, 6);
  });

  it('plan hors de la pièce : pièce entière, ou rien', () => {
    const { doc } = buildPlateDocument();
    const svc = new GeometryService(kernel);
    const all = svc.section(documentForWorker(doc), { plane: 'XY', offset: 50, flip: false }).parts[0]!;
    expect(all.cutFaces).toEqual([]);
    expect(extent(all.mesh!, 2)).toEqual([0, 5]);
    expect(svc.section(documentForWorker(doc), { plane: 'XY', offset: -1, flip: false }).parts[0]!.mesh).toBeNull();
  });
});
