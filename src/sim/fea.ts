/**
 * Calcul de déformation (élasticité linéaire, petits déplacements) sur une grille de voxels :
 * chaque cube plein est un élément hexaédrique à 8 nœuds. Comme tous les cubes sont identiques,
 * la matrice de raideur élémentaire (24 × 24) est calculée une seule fois, avec des « modes
 * incompatibles » (Wilson-Taylor) condensés : sans eux, ces cubes seraient bien trop raides en
 * flexion. Le système est résolu sans matrice globale (gradient conjugué préconditionné par la
 * diagonale) : mémoire et temps restent proportionnels au nombre de cubes.
 */

import { solveElasticity } from './multigrid';

export interface VoxelGrid {
  /** Nombre de cubes selon x, y, z. */
  nx: number;
  ny: number;
  nz: number;
  /** Arête d'un cube (mm). */
  h: number;
  /** Coin (x, y, z minimaux) de la grille (mm). */
  origin: { x: number; y: number; z: number };
  /** 1 : cube plein ; rangés i + nx · (j + ny · k). */
  solid: Uint8Array;
}

export interface Material {
  /** Module d'Young (MPa = N/mm²). */
  E: number;
  /** Coefficient de Poisson. */
  nu: number;
}

export interface FeaProblem {
  grid: VoxelGrid;
  material: Material;
  /** Nœuds bloqués (les trois déplacements). */
  fixedNodes: Iterable<number>;
  /** Forces nodales (N), par nœud. */
  forces: Map<number, { x: number; y: number; z: number }>;
}

export interface FeaResult {
  /** Déplacement de chaque nœud (mm), rangé 3 · nœud + composante. */
  displacement: Float64Array;
  /** Contrainte de von Mises au centre de chaque cube (MPa) ; 0 pour un cube vide. */
  vonMises: Float32Array;
  maxDisplacement: number;
  maxVonMises: number;
  iterations: number;
  converged: boolean;
}

/** Rang d'un nœud de la grille (sommets des cubes : (nx + 1) × (ny + 1) × (nz + 1)). */
export function nodeIndex(g: Pick<VoxelGrid, 'nx' | 'ny'>, i: number, j: number, k: number): number {
  return i + (g.nx + 1) * (j + (g.ny + 1) * k);
}

/** Coins du cube de référence, dans l'ordre des nœuds de l'élément. */
const CORNERS: [number, number, number][] = [
  [-1, -1, -1],
  [1, -1, -1],
  [1, 1, -1],
  [-1, 1, -1],
  [-1, -1, 1],
  [1, -1, 1],
  [1, 1, 1],
  [-1, 1, 1],
];

/** Matrice d'élasticité isotrope (ordre de Voigt : xx, yy, zz, yz, xz, xy ; cisaillements de l'ingénieur). */
function elasticity(E: number, nu: number): number[][] {
  const l = (E * nu) / ((1 + nu) * (1 - 2 * nu));
  const m = E / (2 * (1 + nu));
  return [
    [l + 2 * m, l, l, 0, 0, 0],
    [l, l + 2 * m, l, 0, 0, 0],
    [l, l, l + 2 * m, 0, 0, 0],
    [0, 0, 0, m, 0, 0],
    [0, 0, 0, 0, m, 0],
    [0, 0, 0, 0, 0, m],
  ];
}

/** Lignes de B pour une fonction de forme de dérivées (bx, by, bz), colonnes u, v, w. */
function bBlock(bx: number, by: number, bz: number): number[][] {
  return [
    [bx, 0, 0],
    [0, by, 0],
    [0, 0, bz],
    [0, bz, by],
    [bz, 0, bx],
    [by, bx, 0],
  ];
}

/**
 * Matrices B (compatible, 6 × 24) et des modes incompatibles (6 × 9) au point (ξ, η, ζ), pavé
 * d'arêtes (ax, ay, az) (cube d'arête 1 par défaut).
 */
function bMatrices(xi: number, eta: number, zeta: number, ax = 1, ay = 1, az = 1): { B: number[][]; Ba: number[][] } {
  // dξ/dx, dη/dy, dζ/dz.
  const sx = 2 / ax;
  const sy = 2 / ay;
  const sz = 2 / az;
  const B = Array.from({ length: 6 }, () => new Array<number>(24).fill(0));
  CORNERS.forEach(([a, b, c], n) => {
    const dx = (a * (1 + b * eta) * (1 + c * zeta)) / 8;
    const dy = ((1 + a * xi) * b * (1 + c * zeta)) / 8;
    const dz = ((1 + a * xi) * (1 + b * eta) * c) / 8;
    const blk = bBlock(dx * sx, dy * sy, dz * sz);
    for (let r = 0; r < 6; r++) for (let q = 0; q < 3; q++) B[r]![3 * n + q] = blk[r]![q]!;
  });
  // Modes incompatibles 1 − ξ², 1 − η², 1 − ζ² (trois composantes chacun).
  const Ba = Array.from({ length: 6 }, () => new Array<number>(9).fill(0));
  const derivs: [number, number, number][] = [
    [-2 * xi * sx, 0, 0],
    [0, -2 * eta * sy, 0],
    [0, 0, -2 * zeta * sz],
  ];
  derivs.forEach(([dx, dy, dz], m) => {
    const blk = bBlock(dx, dy, dz);
    for (let r = 0; r < 6; r++) for (let q = 0; q < 3; q++) Ba[r]![3 * m + q] = blk[r]![q]!;
  });
  return { B, Ba };
}

function btdb(A: number[][], D: number[][], C: number[][], w: number, out: number[][]): void {
  const ra = A[0]!.length;
  const rc = C[0]!.length;
  for (let p = 0; p < ra; p++) {
    for (let q = 0; q < rc; q++) {
      let sum = 0;
      for (let i = 0; i < 6; i++) {
        if (A[i]![p] === 0) continue;
        let dc = 0;
        for (let j = 0; j < 6; j++) dc += D[i]![j]! * C[j]![q]!;
        sum += A[i]![p]! * dc;
      }
      out[p]![q] = out[p]![q]! + w * sum;
    }
  }
}

/** Inverse d'une petite matrice symétrique définie positive (Gauss-Jordan). */
function invert(M: number[][]): number[][] {
  const n = M.length;
  const A = M.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r]![c]!) > Math.abs(A[p]![c]!)) p = r;
    [A[c], A[p]] = [A[p]!, A[c]!];
    const d = A[c]![c]!;
    for (let k = 0; k < 2 * n; k++) A[c]![k] = A[c]![k]! / d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = A[r]![c]!;
      if (f === 0) continue;
      for (let k = 0; k < 2 * n; k++) A[r]![k] = A[r]![k]! - f * A[c]![k]!;
    }
  }
  return A.map((row) => row.slice(n));
}

/**
 * Raideur élémentaire (24 × 24) d'un cube d'arête 1 et de module 1 : à multiplier par E · h.
 * Intégration de Gauss 2 × 2 × 2, modes incompatibles condensés statiquement.
 */
export function unitCubeStiffness(nu: number): Float64Array {
  return boxStiffness(nu, 1, 1, 1);
}

/**
 * Raideur élémentaire (24 × 24) d'un pavé d'arêtes (ax, ay, az) (en unités de h) et de module 1 :
 * à multiplier par E · h. Sert aux grilles grossières du multigrille (pavés 2h × 2h × h…).
 */
export function boxStiffness(nu: number, ax: number, ay: number, az: number): Float64Array {
  const D = elasticity(1, nu);
  const g = 1 / Math.sqrt(3);
  const w = (ax * ay * az) / 8; // poids 1 × jacobien
  const Kuu = Array.from({ length: 24 }, () => new Array<number>(24).fill(0));
  const Kua = Array.from({ length: 24 }, () => new Array<number>(9).fill(0));
  const Kaa = Array.from({ length: 9 }, () => new Array<number>(9).fill(0));
  for (const xi of [-g, g])
    for (const eta of [-g, g])
      for (const zeta of [-g, g]) {
        const { B, Ba } = bMatrices(xi, eta, zeta, ax, ay, az);
        btdb(B, D, B, w, Kuu);
        btdb(B, D, Ba, w, Kua);
        btdb(Ba, D, Ba, w, Kaa);
      }
  const inv = invert(Kaa);
  const K = new Float64Array(24 * 24);
  for (let p = 0; p < 24; p++)
    for (let q = 0; q < 24; q++) {
      let corr = 0;
      for (let a = 0; a < 9; a++) for (let b = 0; b < 9; b++) corr += Kua[p]![a]! * inv[a]![b]! * Kua[q]![b]!;
      K[p * 24 + q] = Kuu[p]![q]! - corr;
    }
  return K;
}

/** Résout le problème ; `onProgress` reçoit l'avancement (0 → 1) toutes les quelques itérations. */
export function solveFea(
  problem: FeaProblem,
  options: { tolerance?: number; maxIterations?: number; onProgress?: (f: number) => void; /** Préconditionneur multigrille (défaut : à partir de 1 000 cubes). */ multigrid?: boolean } = {},
): FeaResult {
  const { grid: g, material } = problem;
  const N = (g.nx + 1) * (g.ny + 1) * (g.nz + 1);
  const n3 = 3 * N;
  const Ke = unitCubeStiffness(material.nu);
  const scale = material.E * g.h;
  // Éléments pleins et décalages de leurs 8 nœuds.
  const sx = 1;
  const sy = g.nx + 1;
  const sz = (g.nx + 1) * (g.ny + 1);
  const offsets = CORNERS.map(([a, b, c]) => (a > 0 ? sx : 0) + (b > 0 ? sy : 0) + (c > 0 ? sz : 0));
  const elements: number[] = [];
  for (let k = 0; k < g.nz; k++) for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) if (g.solid[i + g.nx * (j + g.ny * k)]) elements.push(nodeIndex(g, i, j, k));
  // Degrés de liberté libres : nœuds d'au moins un cube plein, non bloqués.
  const active = new Uint8Array(N);
  for (const base of elements) for (const o of offsets) active[base + o] = 1;
  const free = new Uint8Array(n3);
  for (let n = 0; n < N; n++) if (active[n]) free[3 * n] = free[3 * n + 1] = free[3 * n + 2] = 1;
  for (const n of problem.fixedNodes) free[3 * n] = free[3 * n + 1] = free[3 * n + 2] = 0;
  // Diagonale (préconditionneur).
  const diag = new Float64Array(n3);
  for (const base of elements)
    for (let a = 0; a < 8; a++)
      for (let c = 0; c < 3; c++) {
        const d = 3 * (base + offsets[a]!) + c;
        diag[d] = diag[d]! + scale * Ke[(3 * a + c) * 25]!;
      }
  const f = new Float64Array(n3);
  for (const [n, v] of problem.forces) {
    f[3 * n] = f[3 * n]! + v.x;
    f[3 * n + 1] = f[3 * n + 1]! + v.y;
    f[3 * n + 2] = f[3 * n + 2]! + v.z;
  }
  for (let d = 0; d < n3; d++) if (!free[d]) f[d] = 0;
  const ue = new Float64Array(24);
  const multiply = (x: Float64Array, y: Float64Array) => {
    y.fill(0);
    for (const base of elements) {
      for (let a = 0; a < 8; a++) {
        const n = 3 * (base + offsets[a]!);
        ue[3 * a] = x[n]!;
        ue[3 * a + 1] = x[n + 1]!;
        ue[3 * a + 2] = x[n + 2]!;
      }
      for (let a = 0; a < 8; a++) {
        const n = 3 * (base + offsets[a]!);
        for (let c = 0; c < 3; c++) {
          const row = (3 * a + c) * 24;
          let s = 0;
          for (let q = 0; q < 24; q++) s += Ke[row + q]! * ue[q]!;
          y[n + c] = y[n + c]! + scale * s;
        }
      }
    }
    for (let d = 0; d < n3; d++) if (!free[d]) y[d] = 0;
  };
  // Grand problème : gradient conjugué préconditionné par multigrille (voir multigrid.ts).
  if (options.multigrid ?? elements.length >= 1000) {
    const cellScale = new Float64Array(g.nx * g.ny * g.nz);
    for (let c = 0; c < cellScale.length; c++) if (g.solid[c]) cellScale[c] = scale;
    const fixedMask = new Uint8Array(N);
    for (const n of problem.fixedNodes) fixedMask[n] = 1;
    const cache = new Map<string, Float64Array>();
    const stiffness = (ax: number, ay: number, az: number) => {
      const key = `${ax},${ay},${az}`;
      let K = cache.get(key);
      if (!K) cache.set(key, (K = ax === 1 && ay === 1 && az === 1 ? Ke : boxStiffness(material.nu, ax, ay, az)));
      return K;
    };
    const solved = solveElasticity(g.nx, g.ny, g.nz, cellScale, fixedMask, stiffness, f, {
      tolerance: options.tolerance ?? 1e-8,
      maxIterations: options.maxIterations ?? 2000,
      ...(options.onProgress ? { onProgress: options.onProgress } : {}),
    });
    return finish(solved.x, solved.iterations, solved.converged);
  }
  // Gradient conjugué préconditionné.
  const x = new Float64Array(n3);
  const r = Float64Array.from(f);
  const z = new Float64Array(n3);
  const p = new Float64Array(n3);
  const q = new Float64Array(n3);
  const precond = () => {
    for (let d = 0; d < n3; d++) z[d] = free[d] && diag[d]! > 0 ? r[d]! / diag[d]! : 0;
  };
  const norm = (v: Float64Array) => Math.sqrt(v.reduce((s, e) => s + e * e, 0));
  const fn = norm(f) || 1;
  const tol = options.tolerance ?? 1e-8;
  const maxIt = options.maxIterations ?? 20000;
  precond();
  p.set(z);
  let rz = r.reduce((s, e, d) => s + e * z[d]!, 0);
  let it = 0;
  let converged = norm(r) / fn < tol;
  while (!converged && it < maxIt) {
    multiply(p, q);
    const pq = p.reduce((s, e, d) => s + e * q[d]!, 0);
    if (!(pq > 0)) break;
    const alpha = rz / pq;
    for (let d = 0; d < n3; d++) {
      x[d] = x[d]! + alpha * p[d]!;
      r[d] = r[d]! - alpha * q[d]!;
    }
    it++;
    const rel = norm(r) / fn;
    if (rel < tol) {
      converged = true;
      break;
    }
    if (options.onProgress && it % 20 === 0) options.onProgress(Math.min(0.99, Math.log(rel) / Math.log(tol)));
    precond();
    const rz2 = r.reduce((s, e, d) => s + e * z[d]!, 0);
    const beta = rz2 / rz;
    rz = rz2;
    for (let d = 0; d < n3; d++) p[d] = z[d]! + beta * p[d]!;
  }
  return finish(x, it, converged);

  /** Contraintes et maxima, une fois les déplacements connus. */
  function finish(x: Float64Array, it: number, converged: boolean): FeaResult {
  // Contraintes au centre de chaque cube (B compatible au centre).
  const D = elasticity(material.E, material.nu);
  const { B } = bMatrices(0, 0, 0);
  const vonMises = new Float32Array(g.nx * g.ny * g.nz);
  let maxVonMises = 0;
  for (let k = 0; k < g.nz; k++)
    for (let j = 0; j < g.ny; j++)
      for (let i = 0; i < g.nx; i++) {
        const e = i + g.nx * (j + g.ny * k);
        if (!g.solid[e]) continue;
        const base = nodeIndex(g, i, j, k);
        for (let a = 0; a < 8; a++) for (let c = 0; c < 3; c++) ue[3 * a + c] = x[3 * (base + offsets[a]!) + c]!;
        const eps = B.map((row) => row.reduce((s, b, qq) => s + b * ue[qq]!, 0) / g.h);
        const sig = D.map((row) => row.reduce((s, d, qq) => s + d * eps[qq]!, 0));
        const [sx2, sy2, sz2, tyz, txz, txy] = sig as [number, number, number, number, number, number];
        const vm = Math.sqrt(0.5 * ((sx2 - sy2) ** 2 + (sy2 - sz2) ** 2 + (sz2 - sx2) ** 2) + 3 * (tyz ** 2 + txz ** 2 + txy ** 2));
        vonMises[e] = vm;
        if (vm > maxVonMises) maxVonMises = vm;
      }
  let maxDisplacement = 0;
  for (let n = 0; n < N; n++) maxDisplacement = Math.max(maxDisplacement, Math.hypot(x[3 * n]!, x[3 * n + 1]!, x[3 * n + 2]!));
  options.onProgress?.(1);
  return { displacement: x, vonMises, maxDisplacement, maxVonMises, iterations: it, converged };
  }
}
