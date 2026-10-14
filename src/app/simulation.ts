/**
 * Onglet Simulation (calculs purs, testables) : étude par défaut d'une pièce, faces désignées →
 * triangles du maillage, force appliquée, signature d'un calcul, verdict et affichage du résultat
 * (pièce déformée, couleurs). Le calcul lui-même est dans `src/sim`. Voir docs/simulation.md.
 */
import type { CadDocument, FaceRef, Id, LoadDirection, SimulationStudy, StudyFace } from '../domain/model';
import { transformPoint4, type Mat4 } from '../math/mat4';
import type { FaceTag, MeshData } from '../geometry/kernel';
import { GRAVITY, simMaterial } from '../sim/materials';
import { heatColor, type StudyInput, type StudyOutput } from '../sim/study';

/** Précision : nombre de cubes visé. */
export const QUALITY_CELLS: Record<SimulationStudy['quality'], number> = { coarse: 3000, normal: 8000, fine: 20000 };

export const QUALITY_LABELS: Record<SimulationStudy['quality'], string> = { coarse: 'Rapide', normal: 'Normale', fine: 'Fine' };

export const DIRECTION_LABELS: Record<LoadDirection, string> = {
  push: 'Appuie sur la face',
  pull: 'Tire sur la face',
  '-z': 'Vers le bas (−Z)',
  '+z': 'Vers le haut (+Z)',
  '-x': 'Vers −X',
  '+x': 'Vers +X',
  '-y': 'Vers −Y',
  '+y': 'Vers +Y',
  custom: 'Direction au choix (X, Y, Z)',
};

export function defaultStudy(partId: Id): SimulationStudy {
  return { partId, materialId: 'pla', quality: 'normal', fixed: [], load: { faces: [], kind: 'mass', value: 1, direction: '-z' } };
}

/** Étude enregistrée d'une pièce, ou l'étude par défaut. */
export function studyOf(doc: CadDocument, partId: Id): SimulationStudy {
  return doc.simulation?.studies.find((s) => s.partId === partId) ?? defaultStudy(partId);
}

/** Document dont l'étude de la pièce est remplacée. */
export function withStudy(doc: CadDocument, study: SimulationStudy): CadDocument {
  const studies = (doc.simulation?.studies ?? []).filter((s) => s.partId !== study.partId);
  return { ...doc, simulation: { studies: [...studies, study] } };
}

const sameTag = (t: FaceTag, r: FaceRef) =>
  t.featureId === r.featureId && t.role === r.role && (t.entityId ?? null) === (r.entityId ?? null) && (t.index ?? null) === (r.index ?? null);

export const sameFaceRef = (a: StudyFace, b: StudyFace) =>
  a.featureId === b.featureId && a.role === b.role && (a.entityId ?? null) === (b.entityId ?? null) && (a.index ?? null) === (b.index ?? null) && (a.instanceId ?? null) === (b.instanceId ?? null);

/** Rangs des faces du maillage désignées (une référence peut désigner plusieurs faces). */
export function faceIndices(mesh: MeshData, refs: readonly FaceRef[]): number[] {
  const out: number[] = [];
  mesh.faces.forEach((f, i) => {
    if (refs.some((r) => f.tags.some((t) => sameTag(t, r)))) out.push(i);
  });
  return out;
}

/** Triangles (9 nombres chacun) des faces données. */
export function faceTriangles(mesh: MeshData, faces: readonly number[]): Float32Array {
  const out: number[] = [];
  for (const fi of faces) {
    const f = mesh.faces[fi];
    if (!f) continue;
    for (let k = f.start; k < f.start + f.count; k++) {
      const v = mesh.indices[k]!;
      out.push(mesh.positions[3 * v]!, mesh.positions[3 * v + 1]!, mesh.positions[3 * v + 2]!);
    }
  }
  return Float32Array.from(out);
}

/** Normale sortante moyenne (pondérée par l'aire) de triangles. */
function meanNormal(tris: Float32Array): { x: number; y: number; z: number } {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let t = 0; t + 8 < tris.length; t += 9) {
    const ux = tris[t + 3]! - tris[t]!, uy = tris[t + 4]! - tris[t + 1]!, uz = tris[t + 5]! - tris[t + 2]!;
    const vx = tris[t + 6]! - tris[t]!, vy = tris[t + 7]! - tris[t + 1]!, vz = tris[t + 8]! - tris[t + 2]!;
    x += uy * vz - uz * vy;
    y += uz * vx - ux * vz;
    z += ux * vy - uy * vx;
  }
  const n = Math.hypot(x, y, z) || 1;
  return { x: x / n, y: y / n, z: z / n };
}

/** Intensité de la charge (N). */
export function loadNewtons(study: SimulationStudy): number {
  return study.load.kind === 'mass' ? study.load.value * GRAVITY : study.load.value;
}

/** Direction unitaire de la charge (face : normale moyenne des faces chargées). */
function loadDirection(load: SimulationStudy['load'], loaded: Float32Array): { x: number; y: number; z: number } {
  if (load.direction === 'push' || load.direction === 'pull') return meanNormal(loaded);
  if (load.direction === 'custom') {
    const v = load.vector ?? { x: 0, y: 0, z: -1 };
    const n = Math.hypot(v.x, v.y, v.z);
    return n > 1e-12 ? { x: v.x / n, y: v.y / n, z: v.z / n } : { x: 0, y: 0, z: -1 };
  }
  return AXES[load.direction];
}

const AXES: Record<Exclude<LoadDirection, 'push' | 'pull' | 'custom'>, { x: number; y: number; z: number }> = {
  '-z': { x: 0, y: 0, z: -1 },
  '+z': { x: 0, y: 0, z: 1 },
  '-x': { x: -1, y: 0, z: 0 },
  '+x': { x: 1, y: 0, z: 0 },
  '-y': { x: 0, y: -1, z: 0 },
  '+y': { x: 0, y: 1, z: 0 },
};

export type StudyProblem = { ok: true; input: StudyInput } | { ok: false; message: string };

/** Données du calcul, ou ce qui manque pour le lancer. */
/**
 * Ce qu'on étudie : une pièce (son maillage), ou l'assemblage (chaque pièce insérée placée par
 * sa matrice). `key` change dès que la géométrie ou les placements changent.
 */
export type StudySource =
  | { kind: 'part'; mesh: MeshData; key: string }
  | { kind: 'assembly'; items: { instanceId: Id; mesh: MeshData; matrix: Mat4 }[]; key: string };

/** Pièces de la source, avec les faces de l'étude qui les concernent. */
function sourceItems(source: StudySource, refs: readonly StudyFace[]): { mesh: MeshData; matrix: Mat4 | null; refs: StudyFace[]; instanceId: Id | null }[] {
  if (source.kind === 'part') return [{ mesh: source.mesh, matrix: null, refs: [...refs], instanceId: null }];
  return source.items.map((it) => ({ mesh: it.mesh, matrix: it.matrix, refs: refs.filter((r) => r.instanceId === it.instanceId), instanceId: it.instanceId }));
}

function transformed(tris: Float32Array, matrix: Mat4 | null): Float32Array {
  if (!matrix) return tris;
  const out = new Float32Array(tris.length);
  for (let k = 0; k < tris.length; k += 3) {
    const p = transformPoint4(matrix, { x: tris[k]!, y: tris[k + 1]!, z: tris[k + 2]! });
    out[k] = p.x;
    out[k + 1] = p.y;
    out[k + 2] = p.z;
  }
  return out;
}

const concat = (arrays: Float32Array[]) => {
  const out = new Float32Array(arrays.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrays) {
    out.set(a, o);
    o += a.length;
  }
  return out;
};

/** Faces désignées de chaque pièce de la source (rangs dans son maillage), sans doublon fixé/chargé. */
export function studyFaces(study: SimulationStudy, source: StudySource): { instanceId: Id | null; fixed: number[]; load: number[] }[] {
  const fixed = sourceItems(source, study.fixed);
  const load = sourceItems(source, study.load.faces);
  return fixed.map((f, i) => {
    const fixedFaces = faceIndices(f.mesh, f.refs);
    return { instanceId: f.instanceId, fixed: fixedFaces, load: faceIndices(f.mesh, load[i]!.refs).filter((x) => !fixedFaces.includes(x)) };
  });
}

/** Données du calcul, ou ce qui manque pour le lancer. */
export function studyInput(study: SimulationStudy, source: StudySource): StudyProblem {
  const items = sourceItems(source, []);
  const faces = studyFaces(study, source);
  if (faces.every((f) => f.fixed.length === 0)) return { ok: false, message: 'Choisissez au moins une face fixée (là où la pièce est tenue).' };
  if (faces.every((f) => f.load.length === 0)) return { ok: false, message: 'Choisissez au moins une face où appuie la charge.' };
  if (!(study.load.value > 0)) return { ok: false, message: 'Indiquez la valeur de la charge.' };
  // Maillage fusionné (coordonnées de l'assemblage) : un solide fermé par pièce.
  const positions = concat(items.map((it) => transformed(it.mesh.positions, it.matrix)));
  const indices = new Uint32Array(items.reduce((n, it) => n + it.mesh.indices.length, 0));
  const parts: { start: number; count: number }[] = [];
  let offset = 0;
  let vertexOffset = 0;
  for (const it of items) {
    for (let k = 0; k < it.mesh.indices.length; k++) indices[offset + k] = it.mesh.indices[k]! + vertexOffset;
    parts.push({ start: offset, count: it.mesh.indices.length });
    offset += it.mesh.indices.length;
    vertexOffset += it.mesh.positions.length / 3;
  }
  const loaded = concat(items.map((it, i) => transformed(faceTriangles(it.mesh, faces[i]!.load), it.matrix)));
  const fixed = concat(items.map((it, i) => transformed(faceTriangles(it.mesh, faces[i]!.fixed), it.matrix)));
  const F = loadNewtons(study);
  const dir = loadDirection(study.load, loaded);
  const sign = study.load.direction === 'push' ? -1 : 1;
  const material = simMaterial(study.materialId);
  return {
    ok: true,
    input: {
      positions,
      indices,
      ...(source.kind === 'assembly' ? { parts } : {}),
      fixed,
      loaded,
      force: { x: sign * F * dir.x, y: sign * F * dir.y, z: sign * F * dir.z },
      material: { E: material.E, nu: material.nu },
      targetCells: QUALITY_CELLS[study.quality],
    },
  };
}

/** Taille (diagonale de la boîte, mm) d'un maillage. */
export function meshSize(positions: ArrayLike<number>): number {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) {
    lo[i % 3] = Math.min(lo[i % 3]!, positions[i]!);
    hi[i % 3] = Math.max(hi[i % 3]!, positions[i]!);
  }
  return Math.hypot(hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!);
}

/** Signature d'un calcul : le résultat affiché est périmé dès qu'elle change. */
export function studyKey(study: SimulationStudy, sourceKey: string): string {
  return `${sourceKey}|${JSON.stringify(study)}`;
}

export type Verdict = { level: 'ok' | 'tight' | 'fail'; margin: number; label: string };

/** Marge de sécurité : résistance du matériau / contrainte maximale. */
export function verdict(study: SimulationStudy, maxStress: number): Verdict {
  const margin = maxStress > 0 ? simMaterial(study.materialId).strength / maxStress : Infinity;
  if (margin >= 2) return { level: 'ok', margin, label: 'La pièce tient' };
  if (margin >= 1) return { level: 'tight', margin, label: 'C’est juste' };
  return { level: 'fail', margin, label: 'Risque de casser' };
}

export type ResultDisplay = 'stress' | 'displacement';

/** Pièce déformée (déplacements multipliés par `scale`) et couleur de chaque sommet. */
export function resultGeometry(result: StudyOutput, display: ResultDisplay, scale: number): { positions: Float32Array; colors: Float32Array } {
  const nv = result.positions.length / 3;
  const positions = new Float32Array(3 * nv);
  const colors = new Float32Array(3 * nv);
  const top = display === 'stress' ? result.maxStress : result.maxDisplacement;
  for (let v = 0; v < nv; v++) {
    const dx = result.displacement[3 * v]!;
    const dy = result.displacement[3 * v + 1]!;
    const dz = result.displacement[3 * v + 2]!;
    positions[3 * v] = result.positions[3 * v]! + scale * dx;
    positions[3 * v + 1] = result.positions[3 * v + 1]! + scale * dy;
    positions[3 * v + 2] = result.positions[3 * v + 2]! + scale * dz;
    const value = display === 'stress' ? result.stress[v]! : Math.hypot(dx, dy, dz);
    const [r, g, b] = heatColor(top > 0 ? value / top : 0);
    colors[3 * v] = r;
    colors[3 * v + 1] = g;
    colors[3 * v + 2] = b;
  }
  return { positions, colors };
}
