/**
 * Désignation d'arêtes à la souris pour les congés et chanfreins : une arête cliquée devient une
 * référence persistante formée des deux faces qui la bordent.
 */
import { sameEdgeRef } from '../domain/document';
import type { EdgeRef, FaceRef, Id, Part } from '../domain/model';
import { pickFaceReference } from '../features/sketch/support';
import type { MeshData } from '../geometry/kernel';
import type { Vec3 } from '../math/vec';

export type EdgePickResult = { kind: 'ref'; ref: EdgeRef } | { kind: 'blend'; index: number } | { kind: 'invalid'; reason: string };

/** Étiquettes d'une face, sans celles de la fonction en cours d'édition. */
function stableTags(mesh: MeshData, faceIndex: number, draftId: Id | null): FaceRef[] {
  return (mesh.faces[faceIndex]?.tags ?? []).filter((t) => t.featureId !== draftId);
}

function blendIndexOf(mesh: MeshData, faceIndex: number, draftId: Id | null): number | null {
  const tag = mesh.faces[faceIndex]?.tags.find((t) => t.featureId === draftId && t.role === 'blend');
  return tag?.index ?? null;
}

/** Interprète un clic sur une arête : nouvelle référence, ou arête déjà arrondie par la fonction en cours. */
export function edgeRefFromPick(mesh: MeshData, edgeIndex: number, part: Part, draftId: Id | null): EdgePickResult {
  const edge = mesh.edges[edgeIndex];
  if (!edge || edge.faces.length < 2) {
    return { kind: 'invalid', reason: 'Cette arête ne peut pas être choisie (raccord d’une surface courbe). Choisissez une arête entre deux faces.' };
  }
  for (const f of edge.faces) {
    const idx = blendIndexOf(mesh, f, draftId);
    if (idx !== null) return { kind: 'blend', index: idx };
  }
  const [a, b] = edge.faces as [number, number];
  const refA = pickFaceReference(stableTags(mesh, a, draftId), part);
  const refB = pickFaceReference(stableTags(mesh, b, draftId), part);
  if (!refA || !refB) return { kind: 'invalid', reason: 'Cette arête ne peut pas être désignée de façon durable.' };
  return { kind: 'ref', ref: { faces: [refA, refB] } };
}

/** Clic sur une face pendant l'édition : face arrondie / chanfreinée de la fonction en cours ? */
export function blendIndexFromFacePick(mesh: MeshData, faceIndex: number, draftId: Id | null): number | null {
  return blendIndexOf(mesh, faceIndex, draftId);
}

/** Ajoute l'arête si elle est absente, la retire sinon. */
export function toggleEdge(edges: readonly EdgeRef[], ref: EdgeRef): EdgeRef[] {
  return edges.some((e) => sameEdgeRef(e, ref)) ? edges.filter((e) => !sameEdgeRef(e, ref)) : [...edges, ref];
}

/**
 * Segments (repère du monde) des arêtes d'un maillage désignées par des références : arêtes
 * bordées par une face de chacune des deux faces de la référence. Sert à montrer les arêtes
 * choisies d'un congé, d'un chanfrein ou d'un bord plié.
 */
export function edgeRefSegments(mesh: MeshData, refs: readonly EdgeRef[]): { a: Vec3; b: Vec3 }[] {
  const same = (t: { featureId: string; role: string; entityId?: string; index?: number }, r: EdgeRef['faces'][number]) =>
    t.featureId === r.featureId && t.role === r.role && (t.entityId ?? null) === (r.entityId ?? null) && (t.index ?? null) === (r.index ?? null);
  const has = (face: number, r: EdgeRef['faces'][number]) => (mesh.faces[face]?.tags ?? []).some((t) => same(t, r));
  const out: { a: Vec3; b: Vec3 }[] = [];
  const pos = mesh.edgePositions;
  for (const e of mesh.edges) {
    if (e.faces.length < 2) continue;
    const [f0, f1] = e.faces as [number, number];
    if (!refs.some((r) => (has(f0, r.faces[0]) && has(f1, r.faces[1])) || (has(f0, r.faces[1]) && has(f1, r.faces[0])))) continue;
    for (let k = e.start; k < e.start + e.count; k += 2) {
      out.push({ a: { x: pos[k * 3]!, y: pos[k * 3 + 1]!, z: pos[k * 3 + 2]! }, b: { x: pos[k * 3 + 3]!, y: pos[k * 3 + 4]!, z: pos[k * 3 + 5]! } });
    }
  }
  return out;
}
