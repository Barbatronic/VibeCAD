import { beforeAll, describe, expect, it } from 'vitest';
import { isSphereLcs, lcsFrame, lcsFromPick, solveAssembly } from '../../src/app/assembly';
import { addFeature, addPart, createDocument, findPart, makeExtrudeFeature, makeRevolveFeature, makeSketchFeature } from '../../src/domain/document';
import type { Assembly, CadDocument, Id, LcsRef } from '../../src/domain/model';
import { RecomputeEngine } from '../../src/features/engine';
import type { GeometryKernel, MeshData } from '../../src/geometry/kernel';
import { transformDirection4, transformPoint4 } from '../../src/math/mat4';
import { addArc, addCircle, addConstraint, addLine } from '../../src/sketch/model';
import { solveSketch } from '../../src/sketch/solver';
import { ORIGIN_POINT_ID } from '../../src/domain/model';
import { getKernel } from '../helpers/kernel';
import { buildPlateDocument, setDimension } from '../helpers/plate';
import { documentForWorker } from '../../src/geometry/protocol';
import { GeometryService } from '../../src/workers/geometry-service';
import { translation4 } from '../../src/math/mat4';

let kernel: GeometryKernel;
beforeAll(async () => {
  kernel = await getKernel();
});

const MESH = { linearDeflection: 0.05, angularDeflection: 0.3 };

/** Plaque percée + goupille Ø 6 × 10 (cylindre centré sur l'origine). */
function plateAndPin(): { doc: CadDocument; plateId: Id; pinId: Id } {
  const { doc: base, ids } = buildPlateDocument();
  const r = addPart(base, 'Goupille');
  let doc = r.doc;
  const part = findPart(doc, r.partId)!;
  const sk = makeSketchFeature(doc, part, { kind: 'plane', plane: 'XY', offset: 0 });
  const c = addCircle(sk.params, { x: 0.5, y: 0.5 }, 2);
  let params = addConstraint(c.sketch, { type: 'coincident', a: ORIGIN_POINT_ID, b: c.center }).sketch;
  params = solveSketch(addConstraint(params, { type: 'diameter', circle: c.circleId, value: 6 }).sketch).sketch;
  doc = addFeature(doc, r.partId, { ...sk, params });
  doc = addFeature(doc, r.partId, makeExtrudeFeature(doc, findPart(doc, r.partId)!, sk.id, 10));
  return { doc, plateId: ids.partId, pinId: r.partId };
}

function meshes(doc: CadDocument): Map<Id, MeshData> {
  const engine = new RecomputeEngine(kernel, { get: () => undefined });
  const out = new Map<Id, MeshData>();
  for (const res of engine.evaluateDocument(doc)) out.set(res.partId, engine.meshOf(res, MESH)!);
  return out;
}

/** Repère sur le bord circulaire d'une pièce, au niveau z demandé. */
function circleLcs(doc: CadDocument, mesh: MeshData, partId: Id, z: number): LcsRef {
  const index = mesh.edges.findIndex((e) => e.circle && Math.abs(e.circle.center.z - z) < 1e-6);
  const r = lcsFromPick(mesh, 'edge', index, findPart(doc, partId)!);
  if (!('ref' in r)) throw new Error(r.reason);
  return r.ref;
}

describe('assemblage', () => {
  it('pivot : la goupille se place dans le trou, tourne autour de son axe et descend avec le décalage', () => {
    const { doc, plateId, pinId } = plateAndPin();
    const m = meshes(doc);
    const assembly: Assembly = {
      instances: [
        { id: 'i1', partId: plateId, name: 'Plaque', position: { x: 0, y: 0, z: 0 } },
        { id: 'i2', partId: pinId, name: 'Goupille', position: { x: 80, y: 0, z: 0 } },
      ],
      joints: [
        {
          id: 'j1',
          name: 'Pivot 1',
          kind: 'revolute',
          moving: { instanceId: 'i2', lcs: circleLcs(doc, m.get(pinId)!, pinId, 0) },
          base: { instanceId: 'i1', lcs: circleLcs(doc, m.get(plateId)!, plateId, 5) },
          flip: false,
          angle: 0,
          offset: 0,
        },
      ],
    };
    const placed = solveAssembly(assembly, (id) => m.get(id));
    expect(placed.issues.size).toBe(0);
    const pin = placed.matrices.get('i2')!;
    // Le bas de la goupille vient au bord supérieur du trou, la goupille est debout au-dessus.
    const bottom = transformPoint4(pin, { x: 0, y: 0, z: 0 });
    expect(bottom.x).toBeCloseTo(15, 6);
    expect(bottom.y).toBeCloseTo(15, 6);
    expect(bottom.z).toBeCloseTo(5, 6);
    expect(transformDirection4(pin, { x: 0, y: 0, z: 1 }).z).toBeCloseTo(1, 9);

    // Décalage de −5 mm : la goupille descend dans le trou ; rotation de 90° autour de l'axe.
    const moved = solveAssembly({ ...assembly, joints: [{ ...assembly.joints[0]!, offset: -5, angle: 90 }] }, (id) => m.get(id));
    const pin2 = moved.matrices.get('i2')!;
    expect(transformPoint4(pin2, { x: 0, y: 0, z: 0 }).z).toBeCloseTo(0, 6);
    const x0 = transformDirection4(pin, { x: 1, y: 0, z: 0 });
    const x1 = transformDirection4(pin2, { x: 1, y: 0, z: 0 });
    expect(x0.x * x1.x + x0.y * x1.y + x0.z * x1.z).toBeCloseTo(0, 9);
    expect(moved.jointFrames.get('j1')!.base.origin).toEqual({ x: 15, y: 15, z: 5 });
  });

  it('liaison en double : compatible, elle est satisfaite ; incompatible, la boucle est signalée', () => {
    const { doc, plateId, pinId } = plateAndPin();
    const m = meshes(doc);
    const lcsPin = circleLcs(doc, m.get(pinId)!, pinId, 0);
    const lcsHole = circleLcs(doc, m.get(plateId)!, plateId, 5);
    const joint = (id: string, moving: string, base: string) => ({
      id,
      name: id,
      kind: 'fixed' as const,
      moving: { instanceId: moving, lcs: moving === 'i1' ? lcsHole : lcsPin },
      base: { instanceId: base, lcs: base === 'i1' ? lcsHole : lcsPin },
      flip: false,
      angle: 0,
      offset: 0,
    });
    const placed = solveAssembly(
      {
        instances: [
          { id: 'i1', partId: plateId, name: 'Plaque', position: { x: 0, y: 0, z: 0 } },
          { id: 'i2', partId: pinId, name: 'Goupille', position: { x: 80, y: 0, z: 0 } },
        ],
        joints: [joint('j1', 'i2', 'i1'), joint('j2', 'i2', 'i1'), joint('j3', 'i1', 'i2')],
      },
      (id) => m.get(id),
    );
    // Les liaisons j2 et j3 redisent j1 (la pièce fixe peut aussi être « mobile » d'une boucle).
    expect(placed.issues.size).toBe(0);
    expect(placed.closingJoints).toEqual(new Set(['j2', 'j3']));
    // Liaisons fixes, aucun réglage libre : un décalage différent ne peut pas être satisfait.
    const clash = solveAssembly(
      {
        instances: [
          { id: 'i1', partId: plateId, name: 'Plaque', position: { x: 0, y: 0, z: 0 } },
          { id: 'i2', partId: pinId, name: 'Goupille', position: { x: 80, y: 0, z: 0 } },
        ],
        joints: [joint('j1', 'i2', 'i1'), { ...joint('j2', 'i2', 'i1'), offset: 3 }],
      },
      (id) => m.get(id),
    );
    expect(clash.issues.get('j2')).toBe('LOOP_UNSOLVED');
    expect(clash.issues.has('j1')).toBe(false);
  });

  it('repère sur un sommet d’une face : il reste au coin quand la pièce change', () => {
    const { doc, ids } = buildPlateDocument();
    const mesh = meshes(doc).get(ids.partId)!;
    const top = mesh.faces.findIndex((f) => f.plane && f.plane.normal.z > 0.99);
    const r = lcsFromPick(mesh, 'vertex', top, findPart(doc, ids.partId)!, { x: 60, y: 30, z: 5 });
    if (!('ref' in r)) throw new Error(r.reason);
    expect(r.ref.kind).toBe('vertex');
    const frame = lcsFrame(mesh, r.ref)!;
    expect([frame.origin.x, frame.origin.y, frame.origin.z]).toEqual([60, 30, 5]);
    expect(frame.normal.z).toBeCloseTo(1, 9);
    // Plaque élargie à 80 mm : le repère suit le coin.
    const wider = setDimension(doc, ids.sketch1, ids.widthConstraint, 80);
    const moved = lcsFrame(meshes(wider).get(ids.partId)!, r.ref)!;
    expect(moved.origin.x).toBeCloseTo(80, 6);
    expect(moved.origin.y).toBeCloseTo(30, 6);
    // Un point qui n'est pas un coin est refusé.
    expect('reason' in lcsFromPick(mesh, 'vertex', top, findPart(doc, ids.partId)!, { x: 30, y: 15, z: 5 })).toBe(true);
  });

  it('boule : son centre sert de repère de rotule', () => {
    let doc = createDocument('Boule');
    const partId = doc.parts[0]!.id;
    const sk = makeSketchFeature(doc, findPart(doc, partId)!, { kind: 'plane', plane: 'XY', offset: 0 });
    // Demi-disque de rayon 10 posé sur l'axe Y, tourné d'un tour complet.
    const arc = addArc(sk.params, { x: 0, y: 0 }, { x: 0, y: -10 }, { x: 0, y: 10 });
    const line = addLine(arc.sketch, { x: 0, y: 10 }, { x: 0, y: -10 });
    let params = addConstraint(line.sketch, { type: 'coincident', a: arc.end, b: line.a }).sketch;
    params = addConstraint(params, { type: 'coincident', a: line.b, b: arc.start }).sketch;
    doc = addFeature(doc, partId, { ...sk, params: solveSketch(params).sketch });
    doc = addFeature(doc, partId, makeRevolveFeature(doc, findPart(doc, partId)!, sk.id, { kind: 'sketch-y' }, 360));
    const mesh = meshes(doc).get(partId)!;
    const sphere = mesh.faces.findIndex((f) => f.sphere);
    expect(sphere).toBeGreaterThanOrEqual(0);
    expect(mesh.faces[sphere]!.sphere!.radius).toBeCloseTo(10, 6);
    const r = lcsFromPick(mesh, 'face', sphere, findPart(doc, partId)!);
    if (!('ref' in r)) throw new Error(r.reason);
    expect(isSphereLcs(mesh, r.ref)).toBe(true);
    const frame = lcsFrame(mesh, r.ref)!;
    expect(Math.hypot(frame.origin.x, frame.origin.y, frame.origin.z)).toBeCloseTo(0, 6);
  });

  it('collisions : goupille ajustée dans le trou = simple contact ; goupille dans la matière = collision', () => {
    const { doc, plateId, pinId } = plateAndPin();
    const svc = new GeometryService(kernel);
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    // Goupille Ø 6 posée dans le trou Ø 6 (centre 15, 15).
    const inHole = svc.collisions(documentForWorker(doc), [
      { instanceId: 'plaque', partId: plateId, matrix: identity },
      { instanceId: 'goupille', partId: pinId, matrix: translation4({ x: 15, y: 15, z: -2 }) },
    ]);
    expect(inHole.collisions).toEqual([]);
    // Goupille plantée dans la matière (x = 40) : partie commune = cylindre Ø 6 sur 5 mm.
    const inside = svc.collisions(documentForWorker(doc), [
      { instanceId: 'plaque', partId: plateId, matrix: identity },
      { instanceId: 'goupille', partId: pinId, matrix: translation4({ x: 40, y: 15, z: -2 }) },
    ]);
    expect(inside.collisions).toHaveLength(1);
    expect(inside.collisions[0]).toMatchObject({ a: 'plaque', b: 'goupille' });
    expect(inside.collisions[0]!.volume).toBeCloseTo(Math.PI * 9 * 5, 3);
    expect(inside.collisions[0]!.mesh.positions.length).toBeGreaterThan(0);
  });
});
