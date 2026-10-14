import { beforeAll, describe, expect, it } from 'vitest';
import { explodeOffsets, lcsFromPick, meshBox, solveAssembly } from '../../src/app/assembly';
import { addFeature, addPart, createDocument, findPart, makePrimitiveFeature, makeSketchFeature } from '../../src/domain/document';
import type { Assembly, AssemblyJoint, CadDocument, Id, LcsRef } from '../../src/domain/model';
import { RecomputeEngine } from '../../src/features/engine';
import type { GeometryKernel, MeshData } from '../../src/geometry/kernel';
import { transformDirection4 } from '../../src/math/mat4';
import { getKernel } from '../helpers/kernel';
import { frameToWorld } from '../../src/math/frame';
import { transformPoint4 } from '../../src/math/mat4';

let kernel: GeometryKernel;
beforeAll(async () => {
  kernel = await getKernel();
});

/** Barre de 5 mm d'épaisseur, percée de deux trous Ø 6 à `entraxe` l'un de l'autre (x = 5 et x = 5 + entraxe). */
function bar(doc: CadDocument, name: string, entraxe: number): { doc: CadDocument; partId: Id } {
  const r = addPart(doc, name);
  let d = r.doc;
  const box = makePrimitiveFeature(d, findPart(d, r.partId)!);
  d = addFeature(d, r.partId, { ...box, params: { ...box.params, width: entraxe + 10, depth: 10, height: 5 } });
  for (const x of [5, 5 + entraxe]) {
    const hole = makePrimitiveFeature(d, findPart(d, r.partId)!, 'cylinder', 'cut');
    d = addFeature(d, r.partId, { ...hole, params: { ...hole.params, position: { x, y: 5, z: 0 }, diameter: 6, height: 5 } });
  }
  return { doc: d, partId: r.partId };
}

function meshes(doc: CadDocument): Map<Id, MeshData> {
  const engine = new RecomputeEngine(kernel, { get: () => undefined });
  const out = new Map<Id, MeshData>();
  for (const res of engine.evaluateDocument(doc)) if (res.shape) out.set(res.partId, engine.meshOf(res, { linearDeflection: 0.05, angularDeflection: 0.3 })!);
  return out;
}

/** Repère sur le bord du trou centré en x, au niveau z (0 : dessous, 5 : dessus). */
function hole(doc: CadDocument, m: Map<Id, MeshData>, partId: Id, x: number, z: number): LcsRef {
  const mesh = m.get(partId)!;
  const index = mesh.edges.findIndex((e) => e.circle && Math.abs(e.circle.center.z - z) < 1e-6 && Math.abs(e.circle.center.x - x) < 1e-6);
  const r = lcsFromPick(mesh, 'edge', index, findPart(doc, partId)!);
  if (!('ref' in r)) throw new Error(r.reason);
  return r.ref;
}

/** Quadrilatère articulé : socle (entraxe 60), manivelle 30, bielle 60, balancier 30 (parallélogramme). */
function fourBar(couplerLength = 60) {
  let doc = createDocument('Quadrilatère');
  const parts: Record<string, Id> = {};
  for (const [name, e] of [['socle', 60], ['manivelle', 30], ['bielle', couplerLength], ['balancier', 30]] as const) {
    const r = bar(doc, name, e);
    doc = r.doc;
    parts[name] = r.partId;
  }
  const m = meshes(doc);
  const rev = (id: string, moving: [string, Id, LcsRef], base: [string, Id, LcsRef], angle = 0): AssemblyJoint => ({
    id,
    name: id,
    kind: 'revolute',
    moving: { instanceId: moving[0], lcs: moving[2] },
    base: { instanceId: base[0], lcs: base[2] },
    flip: false,
    angle,
    offset: 0,
  });
  const P = parts as Record<'socle' | 'manivelle' | 'bielle' | 'balancier', Id>;
  const assembly: Assembly = {
    instances: [
      { id: 'socle', partId: P.socle, name: 'Socle', position: { x: 0, y: 0, z: 0 } },
      { id: 'manivelle', partId: P.manivelle, name: 'Manivelle', position: { x: 0, y: 30, z: 0 } },
      { id: 'bielle', partId: P.bielle, name: 'Bielle', position: { x: 0, y: 60, z: 0 } },
      { id: 'balancier', partId: P.balancier, name: 'Balancier', position: { x: 0, y: 90, z: 0 } },
    ],
    joints: [
      rev('j1', ['manivelle', P.manivelle, hole(doc, m, P.manivelle, 5, 0)], ['socle', P.socle, hole(doc, m, P.socle, 5, 5)], 70),
      rev('j2', ['bielle', P.bielle, hole(doc, m, P.bielle, 5, 0)], ['manivelle', P.manivelle, hole(doc, m, P.manivelle, 35, 5)], -70),
      rev('j3', ['balancier', P.balancier, hole(doc, m, P.balancier, 5, 0)], ['socle', P.socle, hole(doc, m, P.socle, 65, 5)], 60),
      // Elle referme la boucle : la bielle est déjà tenue par la manivelle.
      rev('j4', ['bielle', P.bielle, hole(doc, m, P.bielle, 5 + couplerLength, 0)], ['balancier', P.balancier, hole(doc, m, P.balancier, 35, 5)]),
    ],
  };
  return { assembly, meshOf: (id: Id) => m.get(id) };
}

const dist = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

describe('assemblage : boucles fermées', () => {
  it('quadrilatère articulé : la liaison qui referme la boucle est satisfaite', () => {
    const { assembly, meshOf } = fourBar();
    const placed = solveAssembly(assembly, meshOf);
    expect(placed.issues.size).toBe(0);
    expect(placed.closingJoints).toEqual(new Set(['j4']));
    const f = placed.jointFrames.get('j4')!;
    expect(dist(f.base.origin, f.moving.origin)).toBeLessThan(1e-3);
    // Le balancier a dû tourner pour rejoindre la bielle : son nouveau réglage est rendu.
    expect(placed.solvedValues.size).toBeGreaterThan(0);
  });

  it('tourner la manivelle : le balancier et la bielle suivent, la bielle reste parallèle au socle', () => {
    const { assembly, meshOf } = fourBar();
    // Réglages refermés de départ, puis manivelle à 40° (elle mène, les autres suivent).
    const first = solveAssembly(assembly, meshOf);
    const settled: Assembly = { ...assembly, joints: assembly.joints.map((j) => ({ ...j, ...(first.solvedValues.get(j.id) ?? {}) })) };
    for (const crank of [40, 100, 150]) {
      const driven: Assembly = { ...settled, joints: settled.joints.map((j) => (j.id === 'j1' ? { ...j, angle: crank } : j)) };
      const placed = solveAssembly(driven, meshOf, { driver: 'j1' });
      expect(placed.issues.size).toBe(0);
      const f = placed.jointFrames.get('j4')!;
      expect(dist(f.base.origin, f.moving.origin)).toBeLessThan(1e-3);
      expect(placed.solvedValues.has('j1')).toBe(false);
      // Parallélogramme : l'axe de la bielle reste parallèle à celui du socle.
      const bx = transformDirection4(placed.matrices.get('bielle')!, { x: 1, y: 0, z: 0 });
      expect(Math.abs(bx.x)).toBeCloseTo(1, 4);
    }
  });

  it('bielle trop longue : la boucle ne peut pas se refermer, la liaison le signale', () => {
    const { assembly, meshOf } = fourBar(150);
    const placed = solveAssembly(assembly, meshOf);
    expect(placed.issues.get('j4')).toBe('LOOP_UNSOLVED');
    expect(placed.solvedValues.size).toBe(0);
  });
});

describe('assemblage : engrenages et crémaillères entre liaisons', () => {
  /** Socle (entraxe 30) et deux barres en pivot sur ses trous. */
  function twoWheels(kind2: 'revolute' | 'cylindrical' = 'revolute') {
    let doc = createDocument('Engrenage');
    const parts: Record<string, Id> = {};
    for (const [name, e] of [['socle', 30], ['a', 20], ['b', 20]] as const) {
      const r = bar(doc, name, e);
      doc = r.doc;
      parts[name] = r.partId;
    }
    const m = meshes(doc);
    const joint = (id: string, kind: 'revolute' | 'cylindrical', moving: string, x: number): AssemblyJoint => ({
      id,
      name: id,
      kind,
      moving: { instanceId: moving, lcs: hole(doc, m, parts[moving]!, 5, 0) },
      base: { instanceId: 'socle', lcs: hole(doc, m, parts.socle!, x, 5) },
      flip: false,
      angle: 0,
      offset: 0,
    });
    const assembly: Assembly = {
      instances: [
        { id: 'socle', partId: parts.socle!, name: 'Socle', position: { x: 0, y: 0, z: 0 } },
        { id: 'a', partId: parts.a!, name: 'A', position: { x: 0, y: 30, z: 0 } },
        { id: 'b', partId: parts.b!, name: 'B', position: { x: 0, y: 60, z: 0 } },
      ],
      joints: [joint('ja', 'revolute', 'a', 5), joint('jb', kind2, 'b', 35)],
    };
    return { assembly, meshOf: (id: Id) => m.get(id) };
  }

  it('roues de 10 et 20 dents : la menée tourne deux fois moins vite, en sens opposé ; manipuler la menée fait tourner la menante', () => {
    const { assembly, meshOf } = twoWheels();
    const coupled: Assembly = {
      ...assembly,
      joints: assembly.joints.map((j) => (j.id === 'ja' ? { ...j, angle: 40 } : j)),
      couplings: [{ id: 'c1', name: 'Engrenage 1', kind: 'gear', driver: 'ja', driven: 'jb', teeth: [10, 20], pitchDiameter: 0, reversed: false, phase: 0 }],
    };
    const placed = solveAssembly(coupled, meshOf);
    expect(placed.issues.size).toBe(0);
    expect(placed.solvedValues.get('jb')!.angle).toBeCloseTo(-20, 9);
    // La barre B a bien tourné : son axe X est tourné de −20° autour de Z.
    const x = transformDirection4(placed.matrices.get('b')!, { x: 1, y: 0, z: 0 });
    expect(Math.abs(Math.atan2(x.y, x.x) * (180 / Math.PI))).toBeCloseTo(20, 6);

    const back = solveAssembly({ ...coupled, joints: coupled.joints.map((j) => (j.id === 'jb' ? { ...j, angle: 30 } : j)) }, meshOf, { driver: 'jb' });
    expect(back.solvedValues.get('ja')!.angle).toBeCloseTo(-60, 9);
  });

  it('crémaillère : un quart de tour d’une roue de Ø 20 fait avancer la glissière de π × 20 / 4', () => {
    const { assembly, meshOf } = twoWheels('cylindrical');
    const coupled: Assembly = {
      ...assembly,
      joints: assembly.joints.map((j) => (j.id === 'ja' ? { ...j, angle: 90 } : j)),
      couplings: [{ id: 'c1', name: 'Crémaillère 1', kind: 'rack', driver: 'ja', driven: 'jb', teeth: [1, 1], pitchDiameter: 20, reversed: false, phase: 2 }],
    };
    const placed = solveAssembly(coupled, meshOf);
    expect(placed.solvedValues.get('jb')!.offset).toBeCloseTo(2 + (Math.PI * 20) / 4, 9);
  });
});

describe('assemblage : vue éclatée', () => {
  it('chaque barre s’écarte du socle le long de l’axe de son pivot, d’autant plus qu’elle est grande ; le socle ne bouge pas', () => {
    const { assembly, meshOf } = fourBar();
    const placed = solveAssembly(assembly, meshOf);
    const offsets = explodeOffsets(assembly, placed, meshOf, 0.5);
    expect(offsets.get('socle')).toEqual({ x: 0, y: 0, z: 0 });
    const size = meshBox(meshOf(assembly.instances[1]!.partId)!).size;
    const crank = offsets.get('manivelle')!;
    // Pivot d'axe Z : la manivelle monte de la moitié de sa taille.
    expect(Math.abs(crank.z)).toBeCloseTo(0.5 * size, 6);
    expect(Math.hypot(crank.x, crank.y)).toBeCloseTo(0, 6);
    // La bielle, posée sur la manivelle, s'écarte encore plus.
    expect(Math.abs(offsets.get('bielle')!.z)).toBeGreaterThan(Math.abs(crank.z));
    expect(explodeOffsets(assembly, placed, meshOf, 0).size).toBe(0);
  });
});

describe('assemblage : repères sur des points d’esquisse', () => {
  it('liaison fixe entre deux points seuls : les points se superposent, axes de l’esquisse opposés', () => {
    let doc = createDocument('Points');
    const ids: Id[] = [];
    for (const [name, x] of [['a', 7], ['b', 12]] as const) {
      const r = bar(doc, name, 20);
      doc = r.doc;
      const sk = makeSketchFeature(doc, findPart(doc, r.partId)!, { kind: 'plane', plane: 'XY', offset: 5 });
      doc = addFeature(doc, r.partId, { ...sk, id: `sk-${name}`, params: { ...sk.params, entities: [{ id: 'p1', type: 'point', x, y: 3 }] } });
      ids.push(r.partId);
    }
    const engine = new RecomputeEngine(kernel, { get: () => undefined });
    const results = engine.evaluateDocument(doc);
    const m = meshes(doc);
    const sketchesOf = (partId: Id) => results.find((r) => r.partId === partId)?.sketches;
    const assembly: Assembly = {
      instances: [
        { id: 'a', partId: ids[0]!, name: 'A', position: { x: 0, y: 0, z: 0 } },
        { id: 'b', partId: ids[1]!, name: 'B', position: { x: 0, y: 40, z: 0 } },
      ],
      joints: [{ id: 'j', name: 'j', kind: 'fixed', moving: { instanceId: 'b', lcs: { kind: 'point', sketchId: 'sk-b', pointId: 'p1' } }, base: { instanceId: 'a', lcs: { kind: 'point', sketchId: 'sk-a', pointId: 'p1' } }, flip: false, angle: 0, offset: 0 }],
    };
    const placed = solveAssembly(assembly, (id) => m.get(id), { sketchesOf });
    expect(placed.issues.size).toBe(0);
    const frameA = sketchesOf(ids[0]!)!.find((k) => k.featureId === 'sk-a')!.frame!;
    const frameB = sketchesOf(ids[1]!)!.find((k) => k.featureId === 'sk-b')!.frame!;
    const pa = transformPoint4(placed.matrices.get('a')!, frameToWorld(frameA, { x: 7, y: 3 }));
    const pb = transformPoint4(placed.matrices.get('b')!, frameToWorld(frameB, { x: 12, y: 3 }));
    expect(dist(pa, pb)).toBeCloseTo(0, 6);
    // Sans les esquisses, le repère est introuvable.
    expect(solveAssembly(assembly, (id) => m.get(id)).issues.get('j')).toBe('LCS_LOST');
  });
});
