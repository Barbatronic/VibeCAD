/**
 * Étude « Mécanisme » : couple (pivot) ou force (glissière) nécessaire sur une liaison motrice
 * pour faire bouger l'assemblage, sur toute sa plage de mouvement. Voir docs/mecanisme.md.
 *
 * Méthode des travaux virtuels, par différences finies sur le solveur d'assemblage (boucles
 * fermées, engrenages et crémaillères compris) :
 * - poids : couple statique = dU/dq, U = Σ m g z (énergie potentielle, centre de gravité de
 *   chaque pièce placée) ; positif, il faut pousser la liaison dans le sens +q ;
 * - accélération voulue α : + J(q) α, inertie équivalente J = Σ m |dp/dq|² (masses ponctuelles au
 *   centre de gravité : l'inertie propre des pièces autour de leur centre est négligée) ;
 * - frottement : couple (ou force) constant, toujours contre le mouvement.
 */
import type { Assembly, AssemblyJoint, Id, MechanismStudy } from '../domain/model';
import type { MeshData } from '../geometry/kernel';
import { transformPoint4 } from '../math/mat4';
import type { Vec3 } from '../math/vec';
import { flattenAssembly, jointFreedoms, solveAssembly, type SolveOptions } from './assembly';

/** Pesanteur (m/s²). */
const G = 9.81;

/** Moteurs courants : couple disponible (N·m), pour la comparaison d'un pivot. */
export const COMMON_MOTORS: { name: string; torque: number; note: string }[] = [
  { name: 'Micro-servo SG90', torque: 0.18, note: 'sous 4,8 V' },
  { name: 'Micro-servo MG90S', torque: 0.22, note: 'sous 4,8 V' },
  { name: 'Moteur pas à pas NEMA 17 × 34', torque: 0.28, note: 'couple de maintien' },
  { name: 'Moteur pas à pas NEMA 17 × 40', torque: 0.42, note: 'couple de maintien' },
  { name: 'Moteur pas à pas NEMA 17 × 48', torque: 0.55, note: 'couple de maintien' },
  { name: 'Servo standard MG996R', torque: 1.0, note: 'sous 6 V' },
  { name: 'Moteur pas à pas NEMA 23 × 56', torque: 1.26, note: 'couple de maintien' },
];

/** Masse (kg) et centre de gravité (mm, repère de la pièce) d'une pièce. */
export type MassOf = (partId: Id) => { mass: number; centroid: Vec3 } | null;

export interface MechanismSample {
  /** Position de la liaison motrice (degrés ou mm). */
  at: number;
  /** Dû au poids (N·m ou N) ; null si l'assemblage ne se place pas à cette position. */
  gravity: number | null;
  /** Avec l'accélération voulue (sans frottement ni sécurité). */
  total: number | null;
}

export interface MechanismResult {
  joint: { id: Id; name: string; kind: 'angle' | 'offset' };
  unit: 'N·m' | 'N';
  samples: MechanismSample[];
  /** Plus grande valeur absolue (avec accélération) et sa position. */
  peak: { value: number; at: number } | null;
  /** Couple (force) à fournir par le moteur : (pic + frottement) × sécurité. */
  required: number | null;
  /** Masse totale en mouvement prise en compte (kg). */
  movingMass: number;
  /** Positions où l'assemblage ne se place pas (liaison bloquée, boucle impossible). */
  failed: number;
}

/** Liaisons qui peuvent mener un mécanisme : pivot (angle) ou glissière (décalage). */
export function drivableJoints(assembly: Assembly | undefined): { joint: AssemblyJoint; kind: 'angle' | 'offset' }[] {
  return (assembly?.joints ?? []).flatMap((j): { joint: AssemblyJoint; kind: 'angle' | 'offset' }[] => {
    const f = jointFreedoms(j.kind);
    if (j.kind === 'spherical') return [];
    return f.angle ? [{ joint: j, kind: 'angle' }] : f.offset ? [{ joint: j, kind: 'offset' }] : [];
  });
}

/** Étude par défaut d'une liaison : sa plage limitée, sinon un tour (pivot) ou ±50 mm. */
export function defaultMechanismStudy(joint: AssemblyJoint, kind: 'angle' | 'offset'): MechanismStudy {
  const limits = kind === 'angle' ? joint.angleLimits : joint.offsetLimits;
  const [from, to] = limits ? [Math.min(...limits), Math.max(...limits)] : kind === 'angle' ? [0, 360] : [-50, 50];
  return { jointId: joint.id, from, to, friction: 0, acceleration: 0, safety: 2 };
}

/** Assemblage avec la liaison motrice réglée sur `value`. */
function withValue(assembly: Assembly, jointId: Id, kind: 'angle' | 'offset', value: number): Assembly {
  return { ...assembly, joints: assembly.joints.map((j) => (j.id === jointId ? { ...j, [kind]: value } : j)) };
}

/**
 * Calcule l'étude. `meshOf` et `options` : comme pour le solveur d'assemblage ; `massOf` : masse et
 * centre de gravité des pièces. `samples` positions régulières de `from` à `to`.
 */
export function computeMechanism(
  assembly: Assembly,
  study: MechanismStudy,
  meshOf: (partId: Id) => MeshData | null | undefined,
  massOf: MassOf,
  options: SolveOptions = {},
  samples = 73,
): MechanismResult | null {
  const driven = drivableJoints(assembly).find((d) => d.joint.id === study.jointId);
  if (!driven) return null;
  const { joint, kind } = driven;
  // Pas de dérivation : 0,25° ou 0,1 mm ; positions en unités SI (rad, m).
  const h = kind === 'angle' ? 0.25 : 0.1;
  const toSi = kind === 'angle' ? Math.PI / 180 : 1 / 1000;
  /** Centres de gravité placés (m) et masses, à la position `q` ; null si l'assemblage ne se place pas. */
  const pose = (q: number): { m: number; p: Vec3 }[] | null => {
    const a = withValue(assembly, joint.id, kind, q);
    const placement = solveAssembly(a, meshOf, { ...options, driver: joint.id });
    if ([...placement.issues.keys()].length > 0 && placement.issues.has(joint.id)) return null;
    const leaves = flattenAssembly(a, placement, meshOf, options);
    return leaves.flatMap((leaf) => {
      const mass = massOf(leaf.partId);
      if (!mass || mass.mass <= 0) return [];
      const w = transformPoint4(leaf.matrix, mass.centroid);
      return [{ m: mass.mass, p: { x: w.x / 1000, y: w.y / 1000, z: w.z / 1000 } }];
    });
  };
  let movingMass = 0;
  const out: MechanismSample[] = [];
  let failed = 0;
  const from = Math.min(study.from, study.to);
  const to = Math.max(study.from, study.to);
  for (let i = 0; i < samples; i++) {
    const q = samples === 1 ? from : from + ((to - from) * i) / (samples - 1);
    const before = pose(q - h);
    const after = pose(q + h);
    if (!before || !after || before.length !== after.length) {
      failed++;
      out.push({ at: q, gravity: null, total: null });
      continue;
    }
    const dq = 2 * h * toSi;
    let dU = 0;
    let inertia = 0;
    let moving = 0;
    before.forEach((b, k) => {
      const a = after[k]!;
      dU += b.m * G * (a.p.z - b.p.z);
      const v2 = ((a.p.x - b.p.x) ** 2 + (a.p.y - b.p.y) ** 2 + (a.p.z - b.p.z) ** 2) / dq ** 2;
      inertia += b.m * v2;
      if (v2 > 1e-12) moving += b.m;
    });
    movingMass = Math.max(movingMass, moving);
    const gravity = dU / dq;
    // L'accélération demande du couple dans le sens du mouvement, qu'importe le signe du poids.
    const total = gravity + Math.sign(gravity || 1) * inertia * Math.abs(study.acceleration);
    out.push({ at: q, gravity, total });
  }
  const valid = out.filter((s): s is MechanismSample & { total: number } => s.total !== null);
  const peakSample = valid.reduce<(typeof valid)[number] | null>((best, s) => (!best || Math.abs(s.total) > Math.abs(best.total) ? s : best), null);
  const peak = peakSample ? { value: peakSample.total, at: peakSample.at } : null;
  return {
    joint: { id: joint.id, name: joint.name, kind },
    unit: kind === 'angle' ? 'N·m' : 'N',
    samples: out,
    peak,
    required: peak ? (Math.abs(peak.value) + Math.abs(study.friction)) * Math.max(1, study.safety) : null,
    movingMass,
    failed,
  };
}
