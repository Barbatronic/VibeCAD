/**
 * Onglet Simulation (calculs purs, testables) : étude par défaut d'une pièce, faces désignées →
 * triangles du maillage, force appliquée, signature d'un calcul, verdict et affichage du résultat
 * (pièce déformée, couleurs). Le calcul lui-même est dans `src/sim`. Voir docs/simulation.md.
 */
import type { CadDocument, FaceRef, Id, LoadDirection, SimulationStudy } from '../domain/model';
import type { FaceTag, MeshData } from '../geometry/kernel';
import { GRAVITY, simMaterial } from '../sim/materials';
import { heatColor, type StudyInput, type StudyOutput } from '../sim/study';

/** Précision : nombre de cubes visé. */
export const QUALITY_CELLS: Record<SimulationStudy['quality'], number> = { coarse: 3000, normal: 8000, fine: 20000 };

export const QUALITY_LABELS: Record<SimulationStudy['quality'], string> = { coarse: 'Rapide', normal: 'Normale', fine: 'Fine' };

export const DIRECTION_LABELS: Record<LoadDirection, string> = {
  push: 'Appuie sur la face',
  '-z': 'Vers le bas (−Z)',
  '+z': 'Vers le haut (+Z)',
  '-x': 'Vers −X',
  '+x': 'Vers +X',
  '-y': 'Vers −Y',
  '+y': 'Vers +Y',
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

export const sameFaceRef = (a: FaceRef, b: FaceRef) => a.featureId === b.featureId && a.role === b.role && (a.entityId ?? null) === (b.entityId ?? null) && (a.index ?? null) === (b.index ?? null);

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

const AXES: Record<Exclude<LoadDirection, 'push'>, { x: number; y: number; z: number }> = {
  '-z': { x: 0, y: 0, z: -1 },
  '+z': { x: 0, y: 0, z: 1 },
  '-x': { x: -1, y: 0, z: 0 },
  '+x': { x: 1, y: 0, z: 0 },
  '-y': { x: 0, y: -1, z: 0 },
  '+y': { x: 0, y: 1, z: 0 },
};

export type StudyProblem = { ok: true; input: StudyInput } | { ok: false; message: string };

/** Données du calcul, ou ce qui manque pour le lancer. */
export function studyInput(study: SimulationStudy, mesh: MeshData): StudyProblem {
  const fixedFaces = faceIndices(mesh, study.fixed);
  const loadFaces = faceIndices(mesh, study.load.faces).filter((f) => !fixedFaces.includes(f));
  if (fixedFaces.length === 0) return { ok: false, message: 'Choisissez au moins une face fixée (là où la pièce est tenue).' };
  if (loadFaces.length === 0) return { ok: false, message: 'Choisissez au moins une face où appuie la charge.' };
  if (!(study.load.value > 0)) return { ok: false, message: 'Indiquez la valeur de la charge.' };
  const loaded = faceTriangles(mesh, loadFaces);
  const F = loadNewtons(study);
  const dir = study.load.direction === 'push' ? meanNormal(loaded) : AXES[study.load.direction];
  const sign = study.load.direction === 'push' ? -1 : 1;
  const material = simMaterial(study.materialId);
  return {
    ok: true,
    input: {
      positions: mesh.positions,
      indices: mesh.indices,
      fixed: faceTriangles(mesh, fixedFaces),
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
export function studyKey(study: SimulationStudy, meshKey: string): string {
  return `${meshKey}|${JSON.stringify(study)}`;
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
