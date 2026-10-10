/**
 * Placement des pièces d'un assemblage : repères (LCS) calculés sur le maillage de chaque pièce,
 * puis placement le long de l'arborescence des liaisons à partir de la pièce fixe (la première
 * insérée). Simple calcul de matrices, sans solveur itératif (voir docs/assemblage.md).
 */
import type { Assembly, AssemblyJoint, EdgeRef, FaceRef, Id, JointKind, LcsRef, Part } from '../domain/model';
import { pickFaceReference } from '../features/sketch/support';
import type { FaceTag, MeshData } from '../geometry/kernel';
import type { Frame3D } from '../math/frame';
import { flipX4, frameFromAxis, frameMatrix4, invertRigid4, multiply4, rotationX4, rotationZ4, translation4, type Mat4 } from '../math/mat4';
import { cross3, dot3, length3, scale3, sub3, type Vec3 } from '../math/vec';
import { edgeRefFromPick } from './edges';

const sameTag = (t: FaceTag, r: FaceRef) =>
  t.featureId === r.featureId && t.role === r.role && (t.entityId ?? null) === (r.entityId ?? null) && (t.index ?? null) === (r.index ?? null);

function facesMatching(mesh: MeshData, ref: FaceRef): number[] {
  return mesh.faces.flatMap((f, i) => (f.tags.some((t) => sameTag(t, ref)) ? [i] : []));
}

/** Arêtes communes à deux faces désignées. */
function edgesMatching(mesh: MeshData, ref: EdgeRef): number[] {
  const a = new Set(facesMatching(mesh, ref.faces[0]));
  const b = new Set(facesMatching(mesh, ref.faces[1]));
  return mesh.edges.flatMap((e, i) => (e.faces.some((f) => a.has(f)) && e.faces.some((f) => b.has(f)) ? [i] : []));
}

/** Centre (barycentre des triangles) d'une face du maillage. */
function faceCentroid(mesh: MeshData, faceIndex: number): Vec3 {
  const f = mesh.faces[faceIndex]!;
  const p = mesh.positions;
  let area = 0;
  const c = { x: 0, y: 0, z: 0 };
  for (let k = f.start; k < f.start + f.count; k += 3) {
    const [i, j, l] = [mesh.indices[k]! * 3, mesh.indices[k + 1]! * 3, mesh.indices[k + 2]! * 3];
    const a = { x: p[i]!, y: p[i + 1]!, z: p[i + 2]! };
    const b = { x: p[j]!, y: p[j + 1]!, z: p[j + 2]! };
    const d = { x: p[l]!, y: p[l + 1]!, z: p[l + 2]! };
    const w = length3(cross3(sub3(b, a), sub3(d, a))) / 2;
    area += w;
    c.x += (w * (a.x + b.x + d.x)) / 3;
    c.y += (w * (a.y + b.y + d.y)) / 3;
    c.z += (w * (a.z + b.z + d.z)) / 3;
  }
  return area > 0 ? scale3(c, 1 / area) : { x: p[mesh.indices[f.start]! * 3]!, y: p[mesh.indices[f.start]! * 3 + 1]!, z: p[mesh.indices[f.start]! * 3 + 2]! };
}

/** Extrémités (premier et dernier point) d'une arête du maillage. */
function edgeEnds(mesh: MeshData, edgeIndex: number): Vec3[] {
  const e = mesh.edges[edgeIndex]!;
  const p = mesh.edgePositions;
  return [e.start, e.start + e.count - 1].map((k) => ({ x: p[k * 3]!, y: p[k * 3 + 1]!, z: p[k * 3 + 2]! }));
}

const samePoint = (a: Vec3, b: Vec3) => length3(sub3(a, b)) <= 1e-6 * Math.max(1, length3(a));

/** Repère (dans les coordonnées de la pièce) désigné par une référence, ou null s'il a disparu. */
export function lcsFrame(mesh: MeshData, ref: LcsRef): Frame3D | null {
  if (ref.kind === 'vertex') {
    const face = facesMatching(mesh, ref.face).find((i) => mesh.faces[i]!.plane);
    if (face === undefined) return null;
    const a = edgesMatching(mesh, ref.edges[0]).flatMap((i) => edgeEnds(mesh, i));
    const b = edgesMatching(mesh, ref.edges[1]).flatMap((i) => edgeEnds(mesh, i));
    const corner = a.find((p) => b.some((q) => samePoint(p, q)));
    return corner ? frameFromAxis(corner, mesh.faces[face]!.plane!.normal) : null;
  }
  if (ref.kind === 'face') {
    const face = facesMatching(mesh, ref.face).find((i) => mesh.faces[i]!.plane);
    if (face === undefined) return null;
    return frameFromAxis(faceCentroid(mesh, face), mesh.faces[face]!.plane!.normal);
  }
  for (const i of edgesMatching(mesh, ref.edge)) {
    const e = mesh.edges[i]!;
    if (ref.kind === 'circle' && e.circle) {
      // Axe orienté comme la normale de la face plane voisine (vers l'extérieur de la matière).
      let axis = e.circle.axis;
      const plane = e.faces.map((f) => mesh.faces[f]!.plane).find(Boolean);
      if (plane && dot3(axis, plane.normal) < 0) axis = scale3(axis, -1);
      return frameFromAxis(e.circle.center, axis);
    }
    if (ref.kind === 'edge' && e.line) {
      const mid = scale3({ x: e.line.start.x + e.line.end.x, y: e.line.start.y + e.line.end.y, z: e.line.start.z + e.line.end.z }, 0.5);
      return frameFromAxis(mid, sub3(e.line.end, e.line.start));
    }
  }
  return null;
}

/**
 * Référence de repère pour une face, une arête ou un sommet cliqué (sommet : `index` = face
 * verrouillée, `point` = le sommet dans les coordonnées de la pièce), ou une explication.
 */
export function lcsFromPick(mesh: MeshData, kind: 'face' | 'edge' | 'vertex', index: number, part: Part, point?: Vec3): { ref: LcsRef } | { reason: string } {
  if (kind === 'vertex') {
    const face = mesh.faces[index];
    if (!face?.plane || !point) return { reason: 'Verrouillez une face plane (touche Maj maintenue) puis visez un de ses sommets.' };
    const faceRef = pickFaceReference(face.tags, part);
    const edges = mesh.edges.flatMap((e, i) => (e.faces.includes(index) && edgeEnds(mesh, i).some((q) => samePoint(q, point)) ? [i] : []));
    const refs = edges.map((i) => edgeRefFromPick(mesh, i, part, null)).flatMap((r) => (r.kind === 'ref' ? [r.ref] : []));
    if (!faceRef || refs.length < 2) return { reason: 'Ce sommet ne peut pas être désigné de façon durable : choisissez un coin entre deux arêtes.' };
    return { ref: { kind: 'vertex', face: faceRef, edges: [refs[0]!, refs[1]!] } };
  }
  if (kind === 'face') {
    const face = mesh.faces[index];
    if (!face) return { reason: 'Face introuvable.' };
    if (face.plane) {
      const ref = pickFaceReference(face.tags, part);
      return ref ? { ref: { kind: 'face', face: ref } } : { reason: 'Cette face ne peut pas être désignée de façon durable.' };
    }
    // Paroi d'un trou ou d'un cylindre : le repère est le centre de l'un de ses bords circulaires.
    const circleEdge = mesh.edges.findIndex((e) => e.circle && e.faces.includes(index));
    if (circleEdge >= 0) return lcsFromPick(mesh, 'edge', circleEdge, part);
    return { reason: 'Choisissez une face plane, un bord circulaire (trou, cylindre) ou une arête droite.' };
  }
  const edge = mesh.edges[index];
  if (!edge || (!edge.circle && !edge.line)) return { reason: 'Choisissez une arête droite ou un bord circulaire.' };
  const r = edgeRefFromPick(mesh, index, part, null);
  if (r.kind !== 'ref') return { reason: r.kind === 'invalid' ? r.reason : 'Cette arête ne peut pas être désignée de façon durable.' };
  return { ref: edge.circle ? { kind: 'circle', edge: r.ref } : { kind: 'edge', edge: r.ref } };
}

/** Matrice de placement de la pièce mobile d'une liaison. */
export function jointMatrix(
  joint: Pick<AssemblyJoint, 'angle' | 'offset' | 'flip'> & Partial<Pick<AssemblyJoint, 'kind' | 'tilt' | 'tiltDirection'>>,
  baseMatrix: Mat4,
  baseFrame: Frame3D,
  movingFrame: Frame3D,
): Mat4 {
  let m = multiply4(baseMatrix, frameMatrix4(baseFrame));
  if (joint.kind === 'spherical' && joint.tilt) {
    // Rotule : la pièce se penche de `tilt` vers la direction `tiltDirection`, autour du point d'accroche.
    // Direction 0° : la pièce penche vers l'axe X du repère de référence ; 90° : vers son axe Y.
    const dir = (((joint.tiltDirection ?? 0) - 90) * Math.PI) / 180;
    m = multiply4(m, multiply4(rotationZ4(dir), multiply4(rotationX4(-(joint.tilt * Math.PI) / 180), rotationZ4(-dir))));
  }
  m = multiply4(m, rotationZ4((joint.angle * Math.PI) / 180));
  m = multiply4(m, translation4({ x: 0, y: 0, z: joint.offset }));
  // Par défaut, les axes Z sont opposés : les faces se touchent, la goupille entre dans le trou.
  if (!joint.flip) m = multiply4(m, flipX4());
  return multiply4(m, invertRigid4(frameMatrix4(movingFrame)));
}

export type JointIssue = 'LCS_LOST' | 'LOOP' | 'FIXED_MOVING';

export const JOINT_ISSUE_MESSAGES: Record<JointIssue, string> = {
  LCS_LOST: 'Un repère de cette liaison n’existe plus (la pièce a changé) : choisissez un nouveau repère.',
  LOOP: 'Cette pièce est déjà tenue par une autre liaison : une pièce ne peut être tenue que par une seule liaison.',
  FIXED_MOVING: 'La première pièce de l’assemblage est fixe : elle ne peut pas être la pièce mobile d’une liaison.',
};

export interface AssemblyPlacement {
  /** Placement de chaque pièce insérée (coordonnées du monde). */
  matrices: Map<Id, Mat4>;
  /** Repères des liaisons dans le monde (origine et axe), pour l'affichage et le glisser. */
  jointFrames: Map<Id, { base: Frame3D; moving: Frame3D }>;
  issues: Map<Id, JointIssue>;
}

function worldFrame(m: Mat4, f: Frame3D): Frame3D {
  const t = (p: Vec3) => ({ x: m[0]! * p.x + m[4]! * p.y + m[8]! * p.z + m[12]!, y: m[1]! * p.x + m[5]! * p.y + m[9]! * p.z + m[13]!, z: m[2]! * p.x + m[6]! * p.y + m[10]! * p.z + m[14]! });
  const d = (v: Vec3) => ({ x: m[0]! * v.x + m[4]! * v.y + m[8]! * v.z, y: m[1]! * v.x + m[5]! * v.y + m[9]! * v.z, z: m[2]! * v.x + m[6]! * v.y + m[10]! * v.z });
  return { origin: t(f.origin), xAxis: d(f.xAxis), yAxis: d(f.yAxis), normal: d(f.normal) };
}

/** Place toutes les pièces insérées ; `meshOf` donne le maillage d'une pièce du projet. */
export function solveAssembly(assembly: Assembly, meshOf: (partId: Id) => MeshData | null | undefined): AssemblyPlacement {
  const matrices = new Map<Id, Mat4>();
  const jointFrames = new Map<Id, { base: Frame3D; moving: Frame3D }>();
  const issues = new Map<Id, JointIssue>();
  const instance = new Map(assembly.instances.map((i) => [i.id, i]));
  const fixed = assembly.instances[0];
  if (fixed) matrices.set(fixed.id, translation4(fixed.position));
  const held = new Set<Id>();
  const pending: AssemblyJoint[] = [];
  for (const j of assembly.joints) {
    if (fixed && j.moving.instanceId === fixed.id) issues.set(j.id, 'FIXED_MOVING');
    else if (held.has(j.moving.instanceId)) issues.set(j.id, 'LOOP');
    else {
      held.add(j.moving.instanceId);
      pending.push(j);
    }
  }
  // Placement de proche en proche, depuis la pièce fixe.
  let progress = true;
  while (progress && pending.length > 0) {
    progress = false;
    for (let k = 0; k < pending.length; k++) {
      const j = pending[k]!;
      const baseMatrix = matrices.get(j.base.instanceId);
      if (!baseMatrix) continue;
      pending.splice(k--, 1);
      progress = true;
      const baseInst = instance.get(j.base.instanceId);
      const movingInst = instance.get(j.moving.instanceId);
      const baseMesh = baseInst && meshOf(baseInst.partId);
      const movingMesh = movingInst && meshOf(movingInst.partId);
      const bf = baseMesh ? lcsFrame(baseMesh, j.base.lcs) : null;
      const mf = movingMesh ? lcsFrame(movingMesh, j.moving.lcs) : null;
      if (!bf || !mf || !movingInst) {
        issues.set(j.id, 'LCS_LOST');
        continue;
      }
      const m = jointMatrix(j, baseMatrix, bf, mf);
      matrices.set(movingInst.id, m);
      jointFrames.set(j.id, { base: worldFrame(baseMatrix, bf), moving: worldFrame(m, mf) });
    }
  }
  // Liaisons dont la pièce de référence n'est reliée à rien de fixe : elles attendent.
  for (const i of assembly.instances) if (!matrices.has(i.id)) matrices.set(i.id, translation4(i.position));
  for (const j of pending) {
    const baseMatrix = matrices.get(j.base.instanceId)!;
    const baseInst = instance.get(j.base.instanceId);
    const movingInst = instance.get(j.moving.instanceId);
    const bf = baseInst && meshOf(baseInst.partId) ? lcsFrame(meshOf(baseInst.partId)!, j.base.lcs) : null;
    const mf = movingInst && meshOf(movingInst.partId) ? lcsFrame(meshOf(movingInst.partId)!, j.moving.lcs) : null;
    if (!bf || !mf || !movingInst) {
      issues.set(j.id, 'LCS_LOST');
      continue;
    }
    const m = jointMatrix(j, baseMatrix, bf, mf);
    matrices.set(movingInst.id, m);
    jointFrames.set(j.id, { base: worldFrame(baseMatrix, bf), moving: worldFrame(m, mf) });
  }
  return { matrices, jointFrames, issues };
}

/** Mouvements libres d'un type de liaison. */
export function jointFreedoms(kind: JointKind): { angle: boolean; offset: boolean; tilt: boolean } {
  return { angle: kind === 'revolute' || kind === 'cylindrical' || kind === 'spherical', offset: kind === 'slider' || kind === 'cylindrical', tilt: kind === 'spherical' };
}

/** Valeur ramenée dans ses limites éventuelles. */
export function clampToLimits(value: number, limits: [number, number] | undefined): number {
  if (!limits) return value;
  return Math.min(Math.max(value, Math.min(limits[0], limits[1])), Math.max(limits[0], limits[1]));
}


/** Point où un rayon traverse un plan (null s'il lui est parallèle). */
export function rayPlane(ray: { origin: Vec3; direction: Vec3 }, origin: Vec3, normal: Vec3): Vec3 | null {
  const denom = dot3(ray.direction, normal);
  if (Math.abs(denom) < 1e-6) return null;
  const t = dot3(sub3(origin, ray.origin), normal) / denom;
  return { x: ray.origin.x + ray.direction.x * t, y: ray.origin.y + ray.direction.y * t, z: ray.origin.z + ray.direction.z * t };
}

/** Abscisse, sur l'axe (origine + s·axe), du point le plus proche du rayon (null si parallèles). */
export function rayAxisParam(ray: { origin: Vec3; direction: Vec3 }, origin: Vec3, axis: Vec3): number | null {
  const w0 = sub3(origin, ray.origin);
  const a = dot3(axis, axis);
  const b = dot3(axis, ray.direction);
  const c = dot3(ray.direction, ray.direction);
  const d = dot3(axis, w0);
  const e = dot3(ray.direction, w0);
  const denom = a * c - b * b;
  if (Math.abs(denom) < 1e-9) return null;
  return (b * e - c * d) / denom;
}
