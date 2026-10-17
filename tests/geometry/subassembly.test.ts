import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020';
import { beforeAll, describe, expect, it } from 'vitest';
import { flattenAssembly, lcsFromPick, solveAssembly } from '../../src/app/assembly';
import { addFeature, addPart, createDocument, findPart, makePrimitiveFeature } from '../../src/domain/document';
import type { Assembly, AssemblyJoint, CadDocument, Id, LcsRef } from '../../src/domain/model';
import { assemblyContents, closedDocument, openSubassembly, subassemblyContent, subassemblyUses } from '../../src/domain/subassemblies';
import { RecomputeEngine } from '../../src/features/engine';
import type { GeometryKernel, MeshData } from '../../src/geometry/kernel';
import { parseNativeFile, serializeDocument } from '../../src/io/native-format';
import { transformPoint4 } from '../../src/math/mat4';
import { getKernel } from '../helpers/kernel';

let kernel: GeometryKernel;
beforeAll(async () => {
  kernel = await getKernel();
});

/** Barre de 5 mm d'épaisseur percée de deux trous Ø 6 (x = 5 et x = 5 + entraxe). */
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

function hole(doc: CadDocument, m: Map<Id, MeshData>, partId: Id, x: number, z: number): LcsRef {
  const mesh = m.get(partId)!;
  const index = mesh.edges.findIndex((e) => e.circle && Math.abs(e.circle.center.z - z) < 1e-6 && Math.abs(e.circle.center.x - x) < 1e-6);
  const r = lcsFromPick(mesh, 'edge', index, findPart(doc, partId)!);
  if (!('ref' in r)) throw new Error(r.reason);
  return r.ref;
}

const rev = (id: string, moving: AssemblyJoint['moving'], base: AssemblyJoint['base'], angle = 0): AssemblyJoint => ({ id, name: id, kind: 'revolute', moving, base, flip: false, angle, offset: 0 });

/** Socle (entraxe 60) ; bloc « Bras » : barre 1 (fixe dans le bloc) et barre 2 en pivot à 90° ; deux bras insérés sur le socle. */
function robot() {
  let doc = createDocument('Robot');
  const p: Record<string, Id> = {};
  for (const [name, e] of [['socle', 60], ['b1', 30], ['b2', 20]] as const) {
    const r = bar(doc, name, e);
    doc = r.doc;
    p[name] = r.partId;
  }
  const m = meshes(doc);
  const arm: Assembly = {
    instances: [
      { id: 'a1', partId: p.b1!, name: 'Barre 1', position: { x: 0, y: 0, z: 0 } },
      { id: 'a2', partId: p.b2!, name: 'Barre 2', position: { x: 0, y: 20, z: 0 } },
    ],
    joints: [rev('ja', { instanceId: 'a2', lcs: hole(doc, m, p.b2!, 5, 0) }, { instanceId: 'a1', lcs: hole(doc, m, p.b1!, 35, 5) }, 90)],
  };
  const main: Assembly = {
    instances: [
      { id: 'socle', partId: p.socle!, name: 'Socle', position: { x: 0, y: 0, z: 0 } },
      { id: 'brasG', partId: '', subassemblyId: 'sa-bras', name: 'Bras gauche', position: { x: 0, y: 40, z: 0 } },
      { id: 'brasD', partId: '', subassemblyId: 'sa-bras', name: 'Bras droit', position: { x: 0, y: 80, z: 0 } },
    ],
    joints: [
      rev('jg', { instanceId: 'brasG', member: ['a1'], lcs: hole(doc, m, p.b1!, 5, 0) }, { instanceId: 'socle', lcs: hole(doc, m, p.socle!, 5, 5) }),
      rev('jd', { instanceId: 'brasD', member: ['a1'], lcs: hole(doc, m, p.b1!, 5, 0) }, { instanceId: 'socle', lcs: hole(doc, m, p.socle!, 65, 5) }, 180),
    ],
  };
  doc = { ...doc, assembly: main, subassemblies: [{ ...arm, id: 'sa-bras', name: 'Bras' }] };
  const options = { subassemblyOf: (id: Id) => subassemblyContent(doc, id) };
  return { doc, m, options, meshOf: (id: Id) => m.get(id) };
}

describe('sous-assemblages', () => {
  it('le bloc est inséré deux fois, accroché par une de ses pièces ; son pivot interne reste à 90°', () => {
    const { doc, options, meshOf } = robot();
    const placed = solveAssembly(doc.assembly!, meshOf, options);
    expect(placed.issues.size).toBe(0);
    const leaves = flattenAssembly(doc.assembly!, placed, meshOf, options);
    expect(leaves.map((l) => l.key)).toEqual(['socle', 'brasG/a1', 'brasG/a2', 'brasD/a1', 'brasD/a2']);
    expect(leaves[2]!.name).toBe('Bras gauche › Barre 2');
    // Bras gauche : sa barre 1 est posée sur le trou gauche du socle (x = 5), au-dessus (z = 5 à 10).
    const b1 = leaves.find((l) => l.key === 'brasG/a1')!;
    const holeCenter = transformPoint4(b1.matrix, { x: 5, y: 5, z: 0 });
    expect([holeCenter.x, holeCenter.y, holeCenter.z].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([5, 5, 5]);
    // Bras droit : sur le trou droit (x = 65).
    const d1 = leaves.find((l) => l.key === 'brasD/a1')!;
    expect(Math.round(transformPoint4(d1.matrix, { x: 5, y: 5, z: 0 }).x * 1e6) / 1e6).toBe(65);
    // Dans chaque bras, la barre 2 reste posée sur le second trou de la barre 1, tournée de 90°.
    for (const side of ['brasG', 'brasD']) {
      const one = leaves.find((l) => l.key === `${side}/a1`)!;
      const two = leaves.find((l) => l.key === `${side}/a2`)!;
      const a = transformPoint4(one.matrix, { x: 35, y: 5, z: 5 });
      const b = transformPoint4(two.matrix, { x: 5, y: 5, z: 0 });
      expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeCloseTo(0, 6);
    }
  });

  it('ouvrir un bloc échange son contenu avec l’assemblage principal ; l’enregistrement le referme', () => {
    const { doc } = robot();
    const open = openSubassembly(doc, 'sa-bras');
    expect(open.editingSubassembly).toBe('sa-bras');
    expect(open.assembly!.instances.map((i) => i.id)).toEqual(['a1', 'a2']);
    expect(subassemblyUses(open, 'sa-bras')).toEqual(['l’assemblage principal']);
    const closed = closedDocument(open);
    expect(closed).toEqual(doc);
    // Fichier : refermé, relu à l'identique et conforme au schéma.
    const text = serializeDocument(open);
    const parsed = parseNativeFile(text);
    expect(parsed.ok && parsed.doc.subassemblies).toEqual(doc.subassemblies);
    expect(parsed.ok && parsed.doc.assembly).toEqual(doc.assembly);
    const validate = new Ajv2020({ allErrors: true, strict: false }).compile(JSON.parse(readFileSync('docs/vibecad.schema.json', 'utf8')));
    expect(validate(JSON.parse(text)), JSON.stringify(validate.errors)).toBe(true);
  });

  it('nomenclature : les pièces des blocs comptent autant de fois que le bloc est inséré', () => {
    const { doc } = robot();
    const counts = assemblyContents(doc, doc.assembly).counts;
    expect([...counts.values()].sort()).toEqual([1, 2, 2]);
  });

  it('un bloc qui se contient lui-même est refusé à la lecture', () => {
    const { doc } = robot();
    const looped = { ...doc, subassemblies: doc.subassemblies!.map((s) => ({ ...s, instances: [...s.instances, { id: 'x', partId: '', subassemblyId: 'sa-bras', name: 'Boucle', position: { x: 0, y: 0, z: 0 } }] })) };
    const parsed = parseNativeFile(serializeDocument(looped));
    expect(parsed.ok).toBe(false);
  });
});
