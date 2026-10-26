/**
 * Bras pendulaire pour les études « Mécanisme » : socle dressé (70 × 10, épaisseur 5) et bras
 * (50 × 10) percés Ø 6 à 5 mm du bout, reliés par un pivot d'axe horizontal (Y). Le centre de
 * gravité du bras est à 20 mm de l'axe.
 */
import { lcsFromPick } from '../../src/app/assembly';
import { addFeature, addPart, createDocument, findPart, makeExtrudeFeature, makePocketFeature, makeSketchFeature } from '../../src/domain/document';
import type { CadDocument, Id, LcsRef } from '../../src/domain/model';
import { RecomputeEngine } from '../../src/features/engine';
import type { GeometryKernel, MeshData, ShapeAnalysis } from '../../src/geometry/kernel';
import { circles, rectangle, solved } from '../library/sketch';

/** Barre dressée (dans le plan XZ, épaisseur 5 en Y) de longueur `length`, percée Ø 6 à x = 5, z = 5 (axe Y). */
export function standingBar(doc: CadDocument, name: string, length: number): { doc: CadDocument; partId: Id } {
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
export function holeEdge(doc: CadDocument, mesh: MeshData, partId: Id, y: number): LcsRef {
  const index = mesh.edges.findIndex((e) => e.circle && Math.abs(e.circle.center.y - y) < 1e-6);
  const r = lcsFromPick(mesh, 'edge', index, findPart(doc, partId)!);
  if (!('ref' in r)) throw new Error(r.reason);
  return r.ref;
}


export function armProject(kernel: GeometryKernel): { doc: CadDocument; socle: Id; arm: Id; meshes: Map<Id, MeshData>; analysis: Map<Id, ShapeAnalysis> } {
  let doc = createDocument('Bras pendulaire');
  doc = { ...doc, parts: [] };
  const socle = standingBar(doc, 'Socle', 70);
  doc = socle.doc;
  const arm = standingBar(doc, 'Bras', 50);
  doc = arm.doc;
  const engine = new RecomputeEngine(kernel, { get: () => undefined });
  const results = engine.evaluateDocument(doc);
  const meshes = new Map(results.map((r) => [r.partId, engine.meshOf(r, { linearDeflection: 0.05, angularDeflection: 0.3 })!]));
  const analysis = new Map(results.map((r) => [r.partId, r.analysis!]));
  doc = {
    ...doc,
    assembly: {
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
    },
  };
  return { doc, socle: socle.partId, arm: arm.partId, meshes, analysis };
}
