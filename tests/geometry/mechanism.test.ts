import { beforeAll, describe, expect, it } from 'vitest';
import { lcsFromPick } from '../../src/app/assembly';
import { computeMechanism, defaultMechanismStudy, drivableJoints, type MassOf } from '../../src/app/mechanism';
import { addFeature, addPart, createDocument, findPart, makeExtrudeFeature, makePocketFeature, makeSketchFeature } from '../../src/domain/document';
import type { Assembly, CadDocument, Id, LcsRef } from '../../src/domain/model';
import { RecomputeEngine } from '../../src/features/engine';
import type { GeometryKernel, MeshData } from '../../src/geometry/kernel';
import { getKernel } from '../helpers/kernel';
import { circles, rectangle, solved } from '../library/sketch';

let kernel: GeometryKernel;
beforeAll(async () => {
  kernel = await getKernel();
});

/** Barre dressée (dans le plan XZ, épaisseur 5 en Y) de longueur `length`, percée Ø 6 à x = 5, z = 5 (axe Y). */
function standingBar(doc: CadDocument, name: string, length: number): { doc: CadDocument; partId: Id } {
  const r = addPart(doc, name);
  let d = r.doc;
  const sk = makeSketchFeature(d, findPart(d, r.partId)!, { kind: 'plane', plane: 'XZ', offset: 0 });
  d = addFeature(d, r.partId, { ...sk, params: solved(rectangle(sk.params, length, 10, length / 2, 5).sketch) });
  const ex = makeExtrudeFeature(d, findPart(d, r.partId)!, sk.id, 5);
  d = addFeature(d, r.partId, { ...ex, params: { ...ex.params, direction: 'reversed' } });
  const sh = makeSketchFeature(d, findPart(d, r.partId)!, { kind: 'plane', plane: 'XZ', offset: 0 });
  d = addFeature(d, r.partId, { ...sh, params: circles(sh.params, [{ x: 5, y: 5, r: 3 }]).sketch });
  d = addFeature(d, r.partId, makePocketFeature(d, findPart(d, r.partId)!, sh.id, { kind: 'throughAll' }, 'symmetric'));
  return { doc: d, partId: r.partId };
}

/** Repère sur le bord du trou, sur la face y = `y`. */
function holeEdge(doc: CadDocument, mesh: MeshData, partId: Id, y: number): LcsRef {
  const index = mesh.edges.findIndex((e) => e.circle && Math.abs(e.circle.center.y - y) < 1e-6);
  const r = lcsFromPick(mesh, 'edge', index, findPart(doc, partId)!);
  if (!('ref' in r)) throw new Error(r.reason);
  return r.ref;
}

describe('étude « Mécanisme » : couple nécessaire sur une liaison', () => {
  it('bras en pivot sur un axe horizontal : couple du poids = m g r cos θ', () => {
    let doc = createDocument('Bras');
    doc = { ...doc, parts: [] };
    const socle = standingBar(doc, 'Socle', 70);
    doc = socle.doc;
    const arm = standingBar(doc, 'Bras', 50);
    doc = arm.doc;
    const engine = new RecomputeEngine(kernel, { get: () => undefined });
    const results = engine.evaluateDocument(doc);
    const meshes = new Map(results.map((r) => [r.partId, engine.meshOf(r, { linearDeflection: 0.05, angularDeflection: 0.3 })!]));
    const analysis = new Map(results.map((r) => [r.partId, r.analysis!]));
    // Bras en PLA : masse en kg, centre de gravité en mm (repère de la pièce).
    const massOf: MassOf = (partId) => {
      const a = analysis.get(partId);
      return a?.centroid ? { mass: (a.volume / 1000) * 1.24 / 1000, centroid: a.centroid } : null;
    };
    const assembly: Assembly = {
      instances: [
        { id: 'socle', partId: socle.partId, name: 'Socle', position: { x: 0, y: 0, z: 0 } },
        { id: 'bras', partId: arm.partId, name: 'Bras', position: { x: 0, y: 20, z: 0 } },
      ],
      joints: [
        {
          id: 'pivot',
          name: 'Pivot',
          kind: 'revolute',
          base: { instanceId: 'socle', lcs: holeEdge(doc, meshes.get(socle.partId)!, socle.partId, 5) },
          moving: { instanceId: 'bras', lcs: holeEdge(doc, meshes.get(arm.partId)!, arm.partId, 0) },
          flip: false,
          angle: 0,
          offset: 0,
        },
      ],
    };
    expect(drivableJoints(assembly).map((d) => [d.joint.id, d.kind])).toEqual([['pivot', 'angle']]);
    const study = { ...defaultMechanismStudy(assembly.joints[0]!, 'angle'), safety: 1 };
    expect([study.from, study.to]).toEqual([0, 360]);
    const result = computeMechanism(assembly, study, (id) => meshes.get(id), massOf)!;
    expect(result.unit).toBe('N·m');
    expect(result.failed).toBe(0);
    // Masse du bras et bras de levier : centre de gravité à 20 mm de l'axe (barre de 50, axe à 5).
    const m = massOf(arm.partId)!.mass;
    const expected = m * 9.81 * 0.02;
    expect(result.movingMass).toBeCloseTo(m, 6);
    expect(Math.abs(result.peak!.value)).toBeCloseTo(expected, 4);
    expect(result.required).toBeCloseTo(expected, 4);
    // Sinusoïde sur un tour : nulle au quart de tour du maximum, opposée à l'opposé.
    const at = (deg: number) => result.samples.find((s) => Math.abs(s.at - deg) < 1e-9)!.gravity!;
    const peakAt = result.peak!.at;
    expect(Math.abs(at((peakAt + 90) % 360))).toBeLessThan(expected * 0.01);
    expect(at((peakAt + 180) % 360)).toBeCloseTo(-result.peak!.value, 4);

    // Accélération de 10 rad/s² : + J α, J = m r² (masse ponctuelle au centre de gravité).
    const fast = computeMechanism(assembly, { ...study, acceleration: 10, friction: 0.01, safety: 2 }, (id) => meshes.get(id), massOf)!;
    expect(Math.abs(fast.peak!.value)).toBeCloseTo(expected + m * 0.02 ** 2 * 10, 4);
    expect(fast.required).toBeCloseTo((Math.abs(fast.peak!.value) + 0.01) * 2, 6);
  });
});
