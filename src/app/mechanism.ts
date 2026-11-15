/**
 * Étude « Mécanisme » : couple (pivot) ou force (glissière) nécessaire sur une liaison motrice
 * pour faire bouger l'assemblage, sur toute sa plage de mouvement. Voir docs/mecanisme.md.
 *
 * Méthode des travaux virtuels, par différences finies sur le solveur d'assemblage (boucles
 * fermées, engrenages et crémaillères compris) :
 * - poids : couple statique = dU/dq, U = Σ m g z (énergie potentielle, centre de gravité de
 *   chaque pièce placée) ; positif, il faut pousser la liaison dans le sens +q ;
 * - accélération voulue α : + J(q) α, inertie équivalente J = Σ (m |dp/dq|² + ωᵀ I ω), avec ω la
 *   vitesse de rotation propre de chaque pièce par unité de q et I sa matrice d'inertie ;
 * - masses portées (`loads`) : ajoutées au centre de gravité de la pièce qui les porte ;
 * - frottement : couple (ou force) constant, toujours contre le mouvement.
 */
import type { Assembly, AssemblyJoint, CadDocument, Id, MechanismStudy, MotionDof, MotionScenario } from '../domain/model';
import type { MeshData } from '../geometry/kernel';
import { transformPoint4 } from '../math/mat4';
import type { Vec3 } from '../math/vec';
import { flattenAssembly, jointFreedoms, solveAssembly, type AssemblyPlacement, type SolveOptions } from './assembly';

/** Clé de l'étude « Mécanisme » dans le choix de l'objet étudié (atelier Simulation). */
export const MECHANISM_STUDY = '@mechanism';

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

/**
 * Masse (kg), centre de gravité (mm, repère de la pièce) et, si connue, matrice d'inertie autour du
 * centre de gravité (kg·m², par lignes, repère de la pièce) d'une pièce.
 */
export type MassOf = (partId: Id) => { mass: number; centroid: Vec3; inertia?: number[] | null } | null;

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

/** Étude du projet si sa liaison mène encore, sinon l'étude par défaut de la première liaison. */
export function mechanismStudyOf(doc: CadDocument): { study: MechanismStudy; kind: 'angle' | 'offset' } | null {
  const drivable = drivableJoints(doc.assembly);
  const saved = doc.simulation?.mechanism;
  const found = saved && drivable.find((d) => d.joint.id === saved.jointId);
  if (saved && found) return { study: saved, kind: found.kind };
  return drivable[0] ? { study: defaultMechanismStudy(drivable[0].joint, drivable[0].kind), kind: drivable[0].kind } : null;
}

/** Assemblage avec la liaison motrice réglée sur `value`. */
export function withValue(assembly: Assembly, jointId: Id, kind: 'angle' | 'offset', value: number): Assembly {
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
  // Masses portées (charges posées sur une pièce, à son centre de gravité).
  const carried = new Map<string, number>();
  for (const l of study.loads ?? []) if (l.mass > 0) carried.set(l.instanceKey, (carried.get(l.instanceKey) ?? 0) + l.mass);
  /**
   * Pièces placées à la position `q` : masse (avec la charge portée), centre de gravité (m),
   * orientation et inertie propre ; null si l'assemblage ne se place pas.
   */
  const pose = (q: number): { m: number; p: Vec3; R: number[]; I: number[] | null }[] | null => {
    const a = withValue(assembly, joint.id, kind, q);
    const placement = solveAssembly(a, meshOf, { ...options, driver: joint.id });
    if ([...placement.issues.keys()].length > 0 && placement.issues.has(joint.id)) return null;
    const leaves = flattenAssembly(a, placement, meshOf, options);
    return leaves.flatMap((leaf) => {
      const mass = massOf(leaf.partId);
      if (!mass) return [];
      const m = mass.mass + (carried.get(leaf.key) ?? 0);
      if (m <= 0) return [];
      const w = transformPoint4(leaf.matrix, mass.centroid);
      const M = leaf.matrix;
      // Rotation (par lignes) extraite de la matrice de placement (par colonnes).
      const R = [M[0]!, M[4]!, M[8]!, M[1]!, M[5]!, M[9]!, M[2]!, M[6]!, M[10]!];
      return [{ m, p: { x: w.x / 1000, y: w.y / 1000, z: w.z / 1000 }, R, I: mass.inertia ?? null }];
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
      // Rotation propre : ω (par unité de q) d'après les deux orientations, inertie autour du centre.
      const w = rotationRate(b.R, a.R, dq);
      if (b.I) {
        const body = mulT(b.R, w);
        inertia += dot(body, mul(b.I, body));
      }
      if (v2 > 1e-12 || dot(w, w) > 1e-12) moving += b.m;
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

/** Produit matrice 3 × 3 (par lignes) × vecteur. */
function mul(m: number[], v: number[]): number[] {
  return [0, 1, 2].map((r) => m[3 * r]! * v[0]! + m[3 * r + 1]! * v[1]! + m[3 * r + 2]! * v[2]!);
}
/** Produit transposée × vecteur (repère du monde → repère de la pièce). */
function mulT(m: number[], v: number[]): number[] {
  return [0, 1, 2].map((c) => m[c]! * v[0]! + m[3 + c]! * v[1]! + m[6 + c]! * v[2]!);
}
const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;

/**
 * Vitesse de rotation (rad par unité de q, repère du monde) entre deux orientations séparées de
 * `dq` : vecteur rotation de Rb · Raᵀ.
 */
function rotationRate(Ra: number[], Rb: number[], dq: number): number[] {
  // D = Rb Raᵀ
  const D = [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => Rb[3 * r]! * Ra[3 * c]! + Rb[3 * r + 1]! * Ra[3 * c + 1]! + Rb[3 * r + 2]! * Ra[3 * c + 2]!));
  const cos = Math.min(1, Math.max(-1, (D[0]! + D[4]! + D[8]! - 1) / 2));
  const angle = Math.acos(cos);
  if (angle < 1e-12) return [0, 0, 0];
  const axis = [D[7]! - D[5]!, D[2]! - D[6]!, D[3]! - D[1]!];
  const n = Math.hypot(axis[0]!, axis[1]!, axis[2]!) || 1;
  return axis.map((v) => (v / n) * (angle / dq));
}

// ---------------------------------------------------------------------------
// Mouvement (cinématique) : la liaison motrice parcourt sa course en un temps donné.

/** Durée d'une course sans élan demandé (accélération nulle) : vitesse constante. */
export const DEFAULT_COURSE_SECONDS = 2;

/** Course en unités SI (rad ou m). */
const travelSi = (study: MechanismStudy, kind: 'angle' | 'offset') => Math.abs(study.to - study.from) * (kind === 'angle' ? Math.PI / 180 : 1 / 1000);

/**
 * Durée de la course (s). Avec une accélération : départ et arrivée arrêtés, on accélère sur la
 * première moitié et on freine sur la seconde (durée = √(4 · course / accélération)). Sans : la
 * durée par défaut, à vitesse constante.
 */
export function courseDuration(study: MechanismStudy, kind: 'angle' | 'offset'): number {
  const d = travelSi(study, kind);
  return study.acceleration > 0 && d > 0 ? Math.sqrt((4 * d) / study.acceleration) : DEFAULT_COURSE_SECONDS;
}

/** Position de la liaison motrice (degrés ou mm) à l'instant `t` de la course. */
export function coursePosition(study: MechanismStudy, kind: 'angle' | 'offset', t: number): number {
  const u = Math.min(1, Math.max(0, t / courseDuration(study, kind)));
  const f = study.acceleration > 0 ? (u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u)) : u;
  return study.from + (study.to - study.from) * f;
}

export interface MotionSample {
  /** Instant (s) et position de la liaison motrice (degrés ou mm). */
  t: number;
  at: number;
  /** Centre de gravité de la pièce suivie (mm, repère de l'assemblage) ; null si rien n'est suivi ou si l'assemblage ne se place pas. */
  point: Vec3 | null;
  /** Vitesse de ce point (mm/s). */
  speed: number | null;
}

export interface MotionResult {
  duration: number;
  samples: MotionSample[];
  /** Vitesse maximale du point suivi (mm/s) et longueur de sa trajectoire (mm). */
  maxSpeed: number;
  distance: number;
  /** Instants où l'assemblage ne se place pas. */
  failed: number;
}

/**
 * Mouvement de l'assemblage quand la liaison motrice parcourt sa course : position de la liaison
 * et trajectoire du centre de gravité de la pièce suivie, à `samples` instants réguliers.
 */
export function computeMotion(
  assembly: Assembly,
  study: MechanismStudy,
  meshOf: (partId: Id) => MeshData | null | undefined,
  centroidOf: (partId: Id) => Vec3 | null,
  options: SolveOptions = {},
  samples = 97,
): MotionResult | null {
  const driven = drivableJoints(assembly).find((d) => d.joint.id === study.jointId);
  if (!driven) return null;
  const { joint, kind } = driven;
  const duration = courseDuration(study, kind);
  const out: MotionSample[] = [];
  let failed = 0;
  for (let i = 0; i < samples; i++) {
    const t = (duration * i) / (samples - 1);
    const at = coursePosition(study, kind, t);
    let point: Vec3 | null = null;
    const a = withValue(assembly, joint.id, kind, at);
    const placement = solveAssembly(a, meshOf, { ...options, driver: joint.id });
    if (placement.issues.has(joint.id)) failed++;
    else if (study.tracked) {
      const leaf = flattenAssembly(a, placement, meshOf, options).find((l) => l.key === study.tracked);
      if (leaf) point = transformPoint4(leaf.matrix, centroidOf(leaf.partId) ?? { x: 0, y: 0, z: 0 });
    }
    out.push({ t, at, point, speed: null });
  }
  // Vitesse : différence centrée entre les instants voisins.
  let maxSpeed = 0;
  let distance = 0;
  out.forEach((s, i) => {
    const before = out[Math.max(0, i - 1)]!;
    const after = out[Math.min(out.length - 1, i + 1)]!;
    if (s.point && before.point && after.point && after.t > before.t) {
      s.speed = Math.hypot(after.point.x - before.point.x, after.point.y - before.point.y, after.point.z - before.point.z) / (after.t - before.t);
      maxSpeed = Math.max(maxSpeed, s.speed);
    }
    if (i > 0 && s.point && before.point) distance += Math.hypot(s.point.x - before.point.x, s.point.y - before.point.y, s.point.z - before.point.z);
  });
  return { duration, samples: out, maxSpeed, distance, failed };
}

// ---------------------------------------------------------------------------
// Scénarios de mouvement : liaisons pilotantes (curseurs) et pilotées (capteurs).

/** Clé de l'étude « Scénarios » dans le choix de l'objet étudié (atelier Simulation). */
export const SCENARIO_STUDY = '@scenarios';

/** Mouvements d'une liaison qu'un scénario peut piloter ou relever. */
export function jointDofs(joint: AssemblyJoint): MotionDof[] {
  if (joint.kind === 'spherical') return [];
  const f = jointFreedoms(joint.kind);
  return [...(f.angle ? (['angle'] as const) : []), ...(f.offset ? (['offset'] as const) : [])];
}

/** Plage du curseur d'une pilotante : les butées de la liaison, sinon un tour (±180°) ou ±100 mm. */
export function dofRange(joint: AssemblyJoint, dof: MotionDof): [number, number] {
  const limits = dof === 'angle' ? joint.angleLimits : joint.offsetLimits;
  return limits ? [Math.min(...limits), Math.max(...limits)] : dof === 'angle' ? [-180, 180] : [-100, 100];
}

/** Assemblage aux réglages des pilotantes du scénario (`live` : valeurs en cours de glissement). */
export function scenarioAssembly(assembly: Assembly, scenario: MotionScenario, live: Record<string, number> = {}): Assembly {
  const values = new Map(scenario.drivers.map((d) => [`${d.jointId}:${d.dof}`, live[`${d.jointId}:${d.dof}`] ?? d.value]));
  return {
    ...assembly,
    joints: assembly.joints.map((j) => {
      const angle = values.get(`${j.id}:angle`);
      const offset = values.get(`${j.id}:offset`);
      return angle === undefined && offset === undefined ? j : { ...j, ...(angle !== undefined ? { angle } : {}), ...(offset !== undefined ? { offset } : {}) };
    }),
  };
}

export interface ScenarioReading {
  jointId: Id;
  dof: MotionDof;
  /** Position relevée (degrés ou mm) ; null si l'assemblage ne se place pas. */
  value: number | null;
}

/**
 * Place l'assemblage avec les pilotantes tenues à leur réglage ; les autres liaisons suivent. Le
 * relevé d'une pilotée est son réglage recalculé ; pour une liaison qui referme une boucle (son
 * réglage n'est pas une inconnue du calcul), il est mesuré entre ses deux repères.
 */
export function solveScenario(
  assembly: Assembly,
  scenario: MotionScenario,
  meshOf: (partId: Id) => MeshData | null | undefined,
  options: SolveOptions = {},
  live: Record<string, number> = {},
): { assembly: Assembly; placement: AssemblyPlacement; readings: ScenarioReading[]; blocked: boolean } {
  const a = scenarioAssembly(assembly, scenario, live);
  const drivers = [...new Set(scenario.drivers.map((d) => d.jointId))];
  const placement = solveAssembly(a, meshOf, { ...options, drivers });
  const blocked = [...placement.issues.values()].some((i) => i === 'LOOP_UNSOLVED');
  const readings = scenario.sensors.map((s): ScenarioReading => {
    const joint = a.joints.find((j) => j.id === s.jointId);
    if (!joint || blocked) return { ...s, value: null };
    if (placement.closingJoints.has(joint.id)) {
      const f = placement.jointFrames.get(joint.id);
      if (!f) return { ...s, value: null };
      const { base: b, moving: m } = f;
      if (s.dof === 'offset') return { ...s, value: (m.origin.x - b.origin.x) * b.normal.x + (m.origin.y - b.origin.y) * b.normal.y + (m.origin.z - b.origin.z) * b.normal.z };
      const cross = { x: b.xAxis.y * m.xAxis.z - b.xAxis.z * m.xAxis.y, y: b.xAxis.z * m.xAxis.x - b.xAxis.x * m.xAxis.z, z: b.xAxis.x * m.xAxis.y - b.xAxis.y * m.xAxis.x };
      const sin = cross.x * b.normal.x + cross.y * b.normal.y + cross.z * b.normal.z;
      const cos = b.xAxis.x * m.xAxis.x + b.xAxis.y * m.xAxis.y + b.xAxis.z * m.xAxis.z;
      return { ...s, value: (Math.atan2(sin, cos) * 180) / Math.PI };
    }
    const solved = placement.solvedValues.get(joint.id);
    return { ...s, value: solved ? solved[s.dof] : joint[s.dof] };
  });
  return { assembly: a, placement, readings, blocked };
}
