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
    const face = facesMatching(mesh, ref.face).find((i) => mesh.faces[i]!.plane || mesh.faces[i]!.sphere);
    if (face === undefined) return null;
    const f = mesh.faces[face]!;
    // Face sphérique (rotule) : repère au centre de la sphère, axe Z de la pièce.
    if (f.sphere) return frameFromAxis(f.sphere.center, { x: 0, y: 0, z: 1 });
    return frameFromAxis(faceCentroid(mesh, face), f.plane!.normal);
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
    if (face.plane || face.sphere) {
      const ref = pickFaceReference(face.tags, part);
      return ref ? { ref: { kind: 'face', face: ref } } : { reason: 'Cette face ne peut pas être désignée de façon durable.' };
    }
    // Paroi d'un trou ou d'un cylindre : le repère est le centre de l'un de ses bords circulaires.
    const circleEdge = mesh.edges.findIndex((e) => e.circle && e.faces.includes(index));
    if (circleEdge >= 0) return lcsFromPick(mesh, 'edge', circleEdge, part);
    return { reason: 'Choisissez une face plane, une sphère, un bord circulaire (trou, cylindre) ou une arête droite.' };
  }
  const edge = mesh.edges[index];
  if (!edge || (!edge.circle && !edge.line)) return { reason: 'Choisissez une arête droite ou un bord circulaire.' };
  const r = edgeRefFromPick(mesh, index, part, null);
  if (r.kind !== 'ref') return { reason: r.kind === 'invalid' ? r.reason : 'Cette arête ne peut pas être désignée de façon durable.' };
  return { ref: edge.circle ? { kind: 'circle', edge: r.ref } : { kind: 'edge', edge: r.ref } };
}

/** Vrai si le repère est le centre d'une sphère (une liaison qui l'utilise est une rotule). */
export function isSphereLcs(mesh: MeshData, ref: LcsRef): boolean {
  return ref.kind === 'face' && facesMatching(mesh, ref.face).some((i) => !!mesh.faces[i]!.sphere);
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

export type JointIssue = 'LCS_LOST' | 'LOOP_UNSOLVED';

export const JOINT_ISSUE_MESSAGES: Record<JointIssue, string> = {
  LCS_LOST: 'Un repère de cette liaison n’existe plus (la pièce a changé) : choisissez un nouveau repère.',
  LOOP_UNSOLVED:
    'Cette liaison referme une boucle que les pièces ne peuvent pas atteindre (trop courtes, trop longues, ou bloquées) : changez les longueurs, le type de liaison ou les réglages.',
};

/** Réglages libres d'une liaison (ceux que le solveur de boucles peut ajuster). */
export interface JointValues {
  angle: number;
  offset: number;
  tilt: number;
  tiltDirection: number;
}

export interface AssemblyPlacement {
  /** Placement de chaque pièce insérée (coordonnées du monde). */
  matrices: Map<Id, Mat4>;
  /** Repères des liaisons dans le monde (origine et axe), pour l'affichage et le glisser. */
  jointFrames: Map<Id, { base: Frame3D; moving: Frame3D }>;
  issues: Map<Id, JointIssue>;
  /**
   * Boucles fermées : réglages recalculés des liaisons qui ont dû bouger pour que la boucle se
   * referme (à reporter dans le document pour que l'assemblage reste continu).
   */
  solvedValues: Map<Id, JointValues>;
  /** Liaisons qui referment une boucle (une pièce tenue par deux chemins). */
  closingJoints: Set<Id>;
}

function worldFrame(m: Mat4, f: Frame3D): Frame3D {
  const t = (p: Vec3) => ({ x: m[0]! * p.x + m[4]! * p.y + m[8]! * p.z + m[12]!, y: m[1]! * p.x + m[5]! * p.y + m[9]! * p.z + m[13]!, z: m[2]! * p.x + m[6]! * p.y + m[10]! * p.z + m[14]! });
  const d = (v: Vec3) => ({ x: m[0]! * v.x + m[4]! * v.y + m[8]! * v.z, y: m[1]! * v.x + m[5]! * v.y + m[9]! * v.z, z: m[2]! * v.x + m[6]! * v.y + m[10]! * v.z });
  return { origin: t(f.origin), xAxis: d(f.xAxis), yAxis: d(f.yAxis), normal: d(f.normal) };
}

const valuesOf = (j: AssemblyJoint): JointValues => ({ angle: j.angle, offset: j.offset, tilt: j.tilt ?? 0, tiltDirection: j.tiltDirection ?? 0 });

/** Réglages qu'un type de liaison laisse libres. */
function freeKeys(kind: JointKind): (keyof JointValues)[] {
  const f = jointFreedoms(kind);
  return [...(f.angle ? (['angle'] as const) : []), ...(f.offset ? (['offset'] as const) : []), ...(f.tilt ? (['tilt', 'tiltDirection'] as const) : [])];
}

/** Échelle (mm) donnée à un écart d'orientation dans les équations de fermeture. */
const AXIS_SCALE = 20;
/** Fermeture acceptée : écart de position (mm) et d'orientation résiduels. */
const CLOSURE_TOL = 1e-3;

/**
 * Place toutes les pièces insérées ; `meshOf` donne le maillage d'une pièce du projet.
 *
 * Les liaisons forment un arbre depuis la pièce fixe : chaque pièce est placée par la première
 * liaison qui la tient. Une liaison de plus vers une pièce déjà tenue referme une boucle
 * (quadrilatère articulé, bielle-manivelle…) : elle devient une contrainte, satisfaite en ajustant
 * les réglages libres (angles, décalages) des liaisons de l'arbre, au plus près de leurs valeurs
 * enregistrées (Levenberg-Marquardt). La liaison `driver` (celle que l'on manipule) n'est pas
 * ajustée : ce sont les autres qui suivent.
 */
export function solveAssembly(assembly: Assembly, meshOf: (partId: Id) => MeshData | null | undefined, options: { driver?: Id } = {}): AssemblyPlacement {
  const jointFrames = new Map<Id, { base: Frame3D; moving: Frame3D }>();
  const issues = new Map<Id, JointIssue>();
  const solvedValues = new Map<Id, JointValues>();
  const instance = new Map(assembly.instances.map((i) => [i.id, i]));
  const fixed = assembly.instances[0];

  // Repères locaux de chaque liaison (calculés une fois).
  const frames = new Map<Id, { bf: Frame3D; mf: Frame3D }>();
  for (const j of assembly.joints) {
    const b = instance.get(j.base.instanceId);
    const m = instance.get(j.moving.instanceId);
    const bm = b && meshOf(b.partId);
    const mm = m && meshOf(m.partId);
    const bf = bm ? lcsFrame(bm, j.base.lcs) : null;
    const mf = mm ? lcsFrame(mm, j.moving.lcs) : null;
    if (bf && mf) frames.set(j.id, { bf, mf });
    else issues.set(j.id, 'LCS_LOST');
  }

  // Arbre : la première liaison qui tient une pièce la place ; les autres referment une boucle.
  const held = new Set<Id>(fixed ? [fixed.id] : []);
  const tree: AssemblyJoint[] = [];
  const closing: AssemblyJoint[] = [];
  for (const j of assembly.joints) {
    if (!frames.has(j.id)) continue;
    if (held.has(j.moving.instanceId)) closing.push(j);
    else {
      held.add(j.moving.instanceId);
      tree.push(j);
    }
  }
  // Ordre de placement : de proche en proche depuis la pièce fixe ; les chaînes qui ne
  // rejoignent rien de fixe partent de la position enregistrée de leur pièce de référence.
  const placed = new Set<Id>(fixed ? [fixed.id] : []);
  const order: AssemblyJoint[] = [];
  const rest = [...tree];
  while (rest.length > 0) {
    let k = rest.findIndex((j) => placed.has(j.base.instanceId));
    if (k < 0) {
      k = 0;
      placed.add(rest[0]!.base.instanceId);
    }
    const j = rest.splice(k, 1)[0]!;
    placed.add(j.moving.instanceId);
    order.push(j);
  }

  const place = (values: Map<Id, JointValues>): Map<Id, Mat4> => {
    const matrices = new Map<Id, Mat4>();
    for (const i of assembly.instances) matrices.set(i.id, translation4(i.position));
    for (const j of order) {
      const f = frames.get(j.id)!;
      const v = values.get(j.id) ?? valuesOf(j);
      matrices.set(j.moving.instanceId, jointMatrix({ ...j, ...v }, matrices.get(j.base.instanceId)!, f.bf, f.mf));
    }
    return matrices;
  };

  // Écarts de fermeture d'une liaison de boucle, selon ce que son type impose.
  const closure = (j: AssemblyJoint, matrices: Map<Id, Mat4>): number[] => {
    const f = frames.get(j.id)!;
    const mb = matrices.get(j.base.instanceId)!;
    const B = worldFrame(mb, f.bf);
    const M = worldFrame(matrices.get(j.moving.instanceId)!, f.mf);
    const ideal = worldFrame(jointMatrix(j, mb, f.bf, f.mf), f.mf);
    const zt = ideal.normal;
    const dO = sub3(M.origin, B.origin);
    const along = dot3(dO, B.normal);
    const perp = sub3(dO, scale3(B.normal, along));
    const axis = scale3(sub3(M.normal, zt), AXIS_SCALE);
    const xs = scale3(sub3(M.xAxis, ideal.xAxis), AXIS_SCALE);
    const v3 = (v: Vec3) => [v.x, v.y, v.z];
    switch (j.kind) {
      case 'spherical':
        return v3(dO);
      case 'revolute':
        return [...v3(dO), ...v3(axis)];
      case 'cylindrical':
        return [...v3(perp), ...v3(axis)];
      case 'slider':
        return [...v3(perp), ...v3(axis), ...v3(xs)];
      default:
        return [...v3(sub3(M.origin, ideal.origin)), ...v3(axis), ...v3(xs)];
    }
  };

  const stored = new Map(tree.map((j) => [j.id, valuesOf(j)]));
  let values = stored;
  if (closing.length > 0) {
    // Inconnues : réglages libres des liaisons de l'arbre (sauf celle que l'on manipule).
    const slots = tree.filter((j) => j.id !== options.driver).flatMap((j) => freeKeys(j.kind).map((key) => ({ id: j.id, key })));
    const p0 = slots.map((s) => stored.get(s.id)![s.key]);
    const toValues = (p: number[]) => {
      const v = new Map([...stored].map(([id, x]) => [id, { ...x }]));
      slots.forEach((s, i) => (v.get(s.id)![s.key] = p[i]!));
      return v;
    };
    const closureOf = (p: number[]) => {
      const m = place(toValues(p));
      return closing.flatMap((j) => closure(j, m));
    };
    // Rappel léger vers les valeurs enregistrées : la boucle bouge le moins possible.
    const REG = 1e-3;
    const residual = (p: number[]) => [...closureOf(p), ...p.map((x, i) => REG * (x - p0[i]!))];
    const cost = (r: number[]) => r.reduce((s, x) => s + x * x, 0);
    let p = [...p0];
    let r = residual(p);
    let lambda = 1e-3;
    const n = p.length;
    for (let it = 0; it < 200 && n > 0; it++) {
      if (Math.max(0, ...closureOf(p).map(Math.abs)) < CLOSURE_TOL * 1e-3) break;
      // Jacobienne par différences finies.
      const J: number[][] = r.map(() => new Array<number>(n).fill(0));
      for (let c = 0; c < n; c++) {
        const h = 1e-6 * Math.max(1, Math.abs(p[c]!));
        const q = [...p];
        q[c] = q[c]! + h;
        const rq = residual(q);
        for (let i = 0; i < r.length; i++) J[i]![c] = (rq[i]! - r[i]!) / h;
      }
      const JtJ = Array.from({ length: n }, (_, a) => Array.from({ length: n }, (_, b) => J.reduce((s, row) => s + row[a]! * row[b]!, 0)));
      const Jtr = Array.from({ length: n }, (_, a) => J.reduce((s, row, i) => s + row[a]! * r[i]!, 0));
      let improved = false;
      for (let tries = 0; tries < 12; tries++) {
        const A = JtJ.map((row, a) => row.map((x, b) => (a === b ? x + lambda * (x + 1e-9) : x)));
        const step = solveLinear(A, Jtr.map((x) => -x));
        if (!step) break;
        const q = p.map((x, i) => x + step[i]!);
        const rq = residual(q);
        if (cost(rq) < cost(r)) {
          p = q;
          r = rq;
          lambda = Math.max(lambda / 3, 1e-12);
          improved = true;
          break;
        }
        lambda *= 4;
      }
      if (!improved) break;
    }
    values = toValues(p);
    const ok = Math.max(0, ...closureOf(p).map(Math.abs)) < CLOSURE_TOL;
    if (ok) {
      for (const [id, v] of values) {
        const s = stored.get(id)!;
        if (Math.abs(v.angle - s.angle) + Math.abs(v.offset - s.offset) + Math.abs(v.tilt - s.tilt) + Math.abs(v.tiltDirection - s.tiltDirection) > 1e-9) solvedValues.set(id, v);
      }
    } else {
      // Boucle impossible : les pièces restent à leurs réglages enregistrés.
      values = stored;
      for (const j of closing) issues.set(j.id, 'LOOP_UNSOLVED');
    }
  }

  const matrices = place(values);
  for (const j of [...tree, ...closing]) {
    const f = frames.get(j.id)!;
    jointFrames.set(j.id, { base: worldFrame(matrices.get(j.base.instanceId)!, f.bf), moving: worldFrame(matrices.get(j.moving.instanceId)!, f.mf) });
  }
  return { matrices, jointFrames, issues, solvedValues, closingJoints: new Set(closing.map((j) => j.id)) };
}

/** Résout A x = b (petit système, pivot partiel) ; null si singulier. */
function solveLinear(Ain: number[][], bIn: number[]): number[] | null {
  const n = bIn.length;
  const A = Ain.map((row) => [...row]);
  const b = [...bIn];
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r]![c]!) > Math.abs(A[piv]![c]!)) piv = r;
    if (Math.abs(A[piv]![c]!) < 1e-14) return null;
    [A[c], A[piv]] = [A[piv]!, A[c]!];
    [b[c], b[piv]] = [b[piv]!, b[c]!];
    for (let r = c + 1; r < n; r++) {
      const f = A[r]![c]! / A[c]![c]!;
      for (let k = c; k < n; k++) A[r]![k] = A[r]![k]! - f * A[c]![k]!;
      b[r] = b[r]! - f * b[c]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r]!;
    for (let k = r + 1; k < n; k++) s -= A[r]![k]! * x[k]!;
    x[r] = s / A[r]![r]!;
  }
  return x;
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
