import { beforeAll, describe, expect, it } from 'vitest';
import { addFeature, createDocument, findPart, makeExtrudeFeature, makeSketchFeature } from '../../src/domain/document';
import type { CadDocument, Id } from '../../src/domain/model';
import { RecomputeEngine } from '../../src/features/engine';
import type { GeometryKernel, MeshData } from '../../src/geometry/kernel';
import { addLine } from '../../src/sketch/model';
import { getKernel } from '../helpers/kernel';

let kernel: GeometryKernel;
beforeAll(async () => {
  kernel = await getKernel();
});

/** Arêtes entre deux faces planes du même plan (coutures inutiles). */
function coplanarSeams(mesh: MeshData): number {
  return mesh.edges.filter((e) => {
    if (e.faces.length !== 2) return false;
    const [a, b] = e.faces.map((i) => mesh.faces[i]!.plane);
    if (!a || !b) return false;
    const dot = a.normal.x * b.normal.x + a.normal.y * b.normal.y + a.normal.z * b.normal.z;
    const d = (a.origin.x - b.origin.x) * a.normal.x + (a.origin.y - b.origin.y) * a.normal.y + (a.origin.z - b.origin.z) * a.normal.z;
    return dot > 1 - 1e-9 && Math.abs(d) < 1e-6;
  }).length;
}

/** Carré 20 × 20 extrudé de 5 mm dont le côté du bas est dessiné en deux segments alignés. */
function splitSideSquare(): { doc: CadDocument; partId: Id; lines: string[] } {
  let doc = createDocument('Côté en deux');
  const partId = doc.parts[0]!.id;
  const sk = makeSketchFeature(doc, findPart(doc, partId)!, { kind: 'plane', plane: 'XY', offset: 0 });
  let s = sk.params;
  const lines: string[] = [];
  for (const [a, b] of [[[0, 0], [10, 0]], [[10, 0], [20, 0]], [[20, 0], [20, 20]], [[20, 20], [0, 20]], [[0, 20], [0, 0]]] as const) {
    const r = addLine(s, { x: a[0], y: a[1] }, { x: b[0], y: b[1] });
    s = r.sketch;
    lines.push(r.lineId);
  }
  doc = addFeature(doc, partId, { ...sk, params: s });
  doc = addFeature(doc, partId, makeExtrudeFeature(doc, findPart(doc, partId)!, sk.id, 5));
  return { doc, partId, lines };
}

describe('faces coplanaires', () => {
  it('un côté dessiné en deux segments donne une seule face, sans arête au milieu', () => {
    const { doc, lines } = splitSideSquare();
    const engine = new RecomputeEngine(kernel, { get: () => undefined });
    const [res] = engine.evaluateDocument(doc);
    const mesh = engine.meshOf(res!, { linearDeflection: 0.05, angularDeflection: 0.3 })!;
    expect(mesh.faces.length).toBe(6);
    expect(coplanarSeams(mesh)).toBe(0);
    expect(res!.analysis!.volume).toBeCloseTo(2000, 6);
    // Les deux segments désignent la même face (les étapes suivantes la retrouvent par l'un ou l'autre).
    const extrudeId = doc.parts[0]!.features[1]!.id;
    for (const id of lines.slice(0, 2)) {
      const f = kernel.findFacePlane(res!.shape!, { featureId: extrudeId, role: 'side', entityId: id });
      expect(f).toMatchObject({ status: 'found', faceCount: 1 });
      if (f.status === 'found') expect(f.normal.y).toBeCloseTo(-1, 9);
    }
  });
});
