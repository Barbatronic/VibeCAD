/**
 * Résolution du système d'élasticité sur la grille de cubes. Le gradient conjugué seul demande
 * beaucoup d'itérations sur une pièce fine (plaque de 3 mm : plus de 1 000) : l'erreur lisse, qui
 * s'étend sur toute la pièce, se corrige très lentement. Le préconditionneur multigrille la corrige
 * sur des grilles de plus en plus grossières (cubes 2 h, 4 h…) : quelques dizaines d'itérations
 * suffisent alors.
 *
 * - Grille grossière : un cube regroupe 2 × 2 × 2 cubes ; sa raideur est proportionnelle à la part
 *   de matière qu'il contient.
 * - Passage d'une grille à l'autre : interpolation trilinéaire (et sa transposée).
 * - Lissage : Jacobi amorti (amortissement tiré de la plus grande valeur propre de D⁻¹A) ; grille
 *   la plus grossière : résolution directe (Cholesky), ou gradient conjugué si elle est trop grande.
 * - Cycle en V utilisé comme préconditionneur d'un gradient conjugué « flexible »
 *   (Polak-Ribière), qui tolère un préconditionneur légèrement variable.
 * Le résultat est celui du système d'origine : seule la vitesse change.
 */

/**
 * Réglages mesurés (poutre, plaque de 3 mm, bloc ; voir docs/simulation.md) : grille la plus
 * grossière vers 400 cubes (résolue directement), un lissage avant et après la correction.
 */
const COARSEST = 400;
const SWEEPS = 1;
/** Secours si la grille la plus grossière est trop grande pour la résolution directe. */
const COARSE_ITERATIONS = 500;
const COARSE_TOLERANCE = 1e-4;

interface Level {
  nx: number;
  ny: number;
  nz: number;
  /** Nombre de nœuds. */
  N: number;
  /** Raideur de chaque cube (E · h · part de matière) ; 0 : vide. Rangés i + nx · (j + ny · k). */
  cellScale: Float64Array;
  /** Nœud de base et raideur des cubes pleins. */
  elems: Int32Array;
  scale: Float64Array;
  offsets: Int32Array;
  /** Degrés de liberté libres (3 par nœud). */
  free: Uint8Array;
  diag: Float64Array;
  /** Nœuds bloqués. */
  fixed: Uint8Array;
  /** Arêtes d'un cube de cette grille (en unités de h) et sa raideur élémentaire (module 1). */
  dims: [number, number, number];
  Ke: Float64Array;
}

export interface LinearSolveOptions {
  tolerance: number;
  maxIterations: number;
  onProgress?: (f: number) => void;
  /** Point de départ (solution d'un problème voisin : optimisation topologique). */
  initial?: Float64Array;
}

export interface LinearSolveResult {
  x: Float64Array;
  iterations: number;
  converged: boolean;
}

function makeLevel(nx: number, ny: number, nz: number, cellScale: Float64Array, fixed: Uint8Array, dims: [number, number, number], Ke: Float64Array): Level {
  const N = (nx + 1) * (ny + 1) * (nz + 1);
  const sy = nx + 1;
  const sz = (nx + 1) * (ny + 1);
  const offsets = Int32Array.from([0, 1, 1 + sy, sy, sz, 1 + sz, 1 + sy + sz, sy + sz]);
  const elems: number[] = [];
  const scales: number[] = [];
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const s = cellScale[i + nx * (j + ny * k)]!;
        if (s > 0) {
          elems.push(i + sy * j + sz * k);
          scales.push(s);
        }
      }
  const free = new Uint8Array(3 * N);
  const diag = new Float64Array(3 * N);
  elems.forEach((base, e) => {
    for (let a = 0; a < 8; a++) {
      const n = base + offsets[a]!;
      for (let c = 0; c < 3; c++) {
        free[3 * n + c] = 1;
        diag[3 * n + c] = diag[3 * n + c]! + scales[e]! * Ke[(3 * a + c) * 25]!;
      }
    }
  });
  for (let n = 0; n < N; n++) if (fixed[n]) free[3 * n] = free[3 * n + 1] = free[3 * n + 2] = 0;
  return { nx, ny, nz, N, cellScale, elems: Int32Array.from(elems), scale: Float64Array.from(scales), offsets, free, diag, fixed, dims, Ke };
}

/** y = A x (sans matrice globale ; nul sur les degrés de liberté bloqués). */
function multiply(L: Level, x: Float64Array, y: Float64Array, ue: Float64Array): void {
  y.fill(0);
  const { elems, scale, offsets, Ke } = L;
  for (let e = 0; e < elems.length; e++) {
    const base = elems[e]!;
    const s = scale[e]!;
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
        let sum = 0;
        for (let q = 0; q < 24; q++) sum += Ke[row + q]! * ue[q]!;
        y[n + c] = y[n + c]! + s * sum;
      }
    }
  }
  for (let d = 0; d < y.length; d++) if (!L.free[d]) y[d] = 0;
}

/** Pour chaque nœud fin le long d'un axe : nœuds grossiers et poids (axe grossi d'un facteur 2, ou pas). */
function axisWeights(nFine: number, factor: 1 | 2): { c: number[]; w: number[] }[] {
  const out: { c: number[]; w: number[] }[] = [];
  for (let i = 0; i <= nFine; i++) {
    if (factor === 1) out.push({ c: [i], w: [1] });
    else out.push(i % 2 === 0 ? { c: [i / 2], w: [1] } : { c: [(i - 1) / 2, (i + 1) / 2], w: [0.5, 0.5] });
  }
  return out;
}

interface Transfer {
  /** Pour chaque nœud fin : nœuds grossiers et poids (au plus 8). */
  start: Int32Array;
  coarse: Int32Array;
  weight: Float64Array;
}

function transfer(fine: Level, coarse: Level, f: [1 | 2, 1 | 2, 1 | 2]): Transfer {
  const ax = axisWeights(fine.nx, f[0]);
  const ay = axisWeights(fine.ny, f[1]);
  const az = axisWeights(fine.nz, f[2]);
  const start = new Int32Array(fine.N + 1);
  const cs: number[] = [];
  const ws: number[] = [];
  const csx = coarse.nx + 1;
  const csxy = csx * (coarse.ny + 1);
  let n = 0;
  for (let k = 0; k <= fine.nz; k++)
    for (let j = 0; j <= fine.ny; j++)
      for (let i = 0; i <= fine.nx; i++) {
        start[n] = cs.length;
        const X = ax[i]!, Y = ay[j]!, Z = az[k]!;
        for (let c = 0; c < Z.c.length; c++)
          for (let b = 0; b < Y.c.length; b++)
            for (let a = 0; a < X.c.length; a++) {
              cs.push(X.c[a]! + csx * Y.c[b]! + csxy * Z.c[c]!);
              ws.push(X.w[a]! * Y.w[b]! * Z.w[c]!);
            }
        n++;
      }
  start[fine.N] = cs.length;
  return { start, coarse: Int32Array.from(cs), weight: Float64Array.from(ws) };
}

/**
 * Grille deux fois plus grossière dans les trois directions (cubes 2h). Essai mesuré : ne pas
 * grossir l'épaisseur d'une plaque (pavés allongés) rend le lissage de Jacobi inefficace et
 * multiplie les itérations par six ; le grossissement complet est retenu. Null quand la grille
 * est trop petite pour être grossie.
 */
function coarsen(fine: Level, stiffness: (ax: number, ay: number, az: number) => Float64Array): { level: Level; transfer: Transfer } | null {
  if (Math.max(fine.nx, fine.ny, fine.nz) < 4) return null;
  const factors: [1 | 2, 1 | 2, 1 | 2] = [2, 2, 2];
  const [fx, fy, fz] = factors;
  const nx = Math.ceil(fine.nx / fx);
  const ny = Math.ceil(fine.ny / fy);
  const nz = Math.ceil(fine.nz / fz);
  const children = fx * fy * fz;
  const cellScale = new Float64Array(nx * ny * nz);
  for (let k = 0; k < fine.nz; k++)
    for (let j = 0; j < fine.ny; j++)
      for (let i = 0; i < fine.nx; i++) {
        const s = fine.cellScale[i + fine.nx * (j + fine.ny * k)]!;
        // Raideur proportionnelle à la part de matière (la taille du pavé est dans sa raideur élémentaire).
        if (s > 0) {
          const c = Math.floor(i / fx) + nx * (Math.floor(j / fy) + ny * Math.floor(k / fz));
          cellScale[c] = cellScale[c]! + s / children;
        }
      }
  const dims: [number, number, number] = [fine.dims[0] * fx, fine.dims[1] * fy, fine.dims[2] * fz];
  const Ke = stiffness(...dims);
  const N = (nx + 1) * (ny + 1) * (nz + 1);
  const fixed = new Uint8Array(N);
  const probe = makeLevel(nx, ny, nz, cellScale, fixed, dims, Ke);
  const t = transfer(fine, probe, factors);
  // Un nœud grossier est bloqué s'il porte un nœud fin bloqué avec un poids notable.
  for (let n = 0; n < fine.N; n++) {
    if (!fine.fixed[n]) continue;
    for (let p = t.start[n]!; p < t.start[n + 1]!; p++) if (t.weight[p]! >= 0.25) fixed[t.coarse[p]!] = 1;
  }
  return { level: makeLevel(nx, ny, nz, cellScale, fixed, dims, Ke), transfer: t };
}

/** Factorisation de Cholesky de la matrice (degrés de liberté libres) d'une petite grille ; null si trop grande ou singulière. */
function denseCholesky(L: Level): { solve(b: Float64Array, x: Float64Array): void } | null {
  const dofs: number[] = [];
  const index = new Int32Array(3 * L.N).fill(-1);
  for (let d = 0; d < 3 * L.N; d++) if (L.free[d]) index[d] = dofs.push(d) - 1;
  const n = dofs.length;
  if (n === 0 || n > 1500) return null;
  const A = new Float64Array(n * n);
  for (let e = 0; e < L.elems.length; e++) {
    const base = L.elems[e]!;
    const s = L.scale[e]!;
    for (let a = 0; a < 8; a++)
      for (let c = 0; c < 3; c++) {
        const p = index[3 * (base + L.offsets[a]!) + c]!;
        if (p < 0) continue;
        for (let b = 0; b < 8; b++)
          for (let k = 0; k < 3; k++) {
            const q = index[3 * (base + L.offsets[b]!) + k]!;
            if (q >= 0) A[p * n + q] = A[p * n + q]! + s * L.Ke[(3 * a + c) * 24 + 3 * b + k]!;
          }
      }
  }
  // A = Lᵀ L en place (triangle inférieur).
  for (let j = 0; j < n; j++) {
    let d = A[j * n + j]!;
    for (let k = 0; k < j; k++) d -= A[j * n + k]! ** 2;
    if (!(d > 1e-12 * Math.abs(A[j * n + j]! || 1))) return null;
    const ljj = Math.sqrt(d);
    A[j * n + j] = ljj;
    for (let i = j + 1; i < n; i++) {
      let v = A[i * n + j]!;
      for (let k = 0; k < j; k++) v -= A[i * n + k]! * A[j * n + k]!;
      A[i * n + j] = v / ljj;
    }
  }
  const y = new Float64Array(n);
  return {
    solve(b, x) {
      for (let i = 0; i < n; i++) {
        let v = b[dofs[i]!]!;
        for (let k = 0; k < i; k++) v -= A[i * n + k]! * y[k]!;
        y[i] = v / A[i * n + i]!;
      }
      for (let i = n - 1; i >= 0; i--) {
        let v = y[i]!;
        for (let k = i + 1; k < n; k++) v -= A[k * n + i]! * y[k]!;
        y[i] = v / A[i * n + i]!;
      }
      x.fill(0);
      for (let i = 0; i < n; i++) x[dofs[i]!] = y[i]!;
    },
  };
}

const dot = (a: Float64Array, b: Float64Array) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
};

/** Résout A x = f (f déjà nul sur les degrés de liberté bloqués). */
export function solveElasticity(
  nx: number,
  ny: number,
  nz: number,
  cellScale: Float64Array,
  fixedNodes: Uint8Array,
  stiffness: (ax: number, ay: number, az: number) => Float64Array,
  f: Float64Array,
  options: LinearSolveOptions,
): LinearSolveResult {
  const levels: Level[] = [makeLevel(nx, ny, nz, cellScale, fixedNodes, [1, 1, 1], stiffness(1, 1, 1))];
  const transfers: Transfer[] = [];
  // Grilles grossières jusqu'à quelques milliers de nœuds.
  while (levels.length < 8) {
    const last = levels[levels.length - 1]!;
    if (last.elems.length < COARSEST) break;
    const next = coarsen(last, stiffness);
    if (!next) break;
    levels.push(next.level);
    transfers.push(next.transfer);
  }
  const ue = new Float64Array(24);
  const work = levels.map((L) => ({ x: new Float64Array(3 * L.N), b: new Float64Array(3 * L.N), r: new Float64Array(3 * L.N), t: new Float64Array(3 * L.N) }));
  // Amortissement du lissage : 4 / (3 λmax) avec λmax la plus grande valeur propre de D⁻¹A
  // (méthode de la puissance). Une valeur fixe ferait diverger le lissage sur certaines grilles.
  const omegas = levels.map((L, l) => {
    const w = work[l]!;
    const v = w.r;
    for (let d = 0; d < v.length; d++) v[d] = L.free[d] ? Math.sin(d * 12.9898) : 0;
    let lambda = 1;
    for (let k = 0; k < 15; k++) {
      multiply(L, v, w.t, ue);
      let norm = 0;
      for (let d = 0; d < v.length; d++) {
        const y = L.free[d] && L.diag[d]! > 0 ? w.t[d]! / L.diag[d]! : 0;
        v[d] = y;
        norm += y * y;
      }
      norm = Math.sqrt(norm) || 1;
      lambda = norm;
      for (let d = 0; d < v.length; d++) v[d] = v[d]! / norm;
    }
    // Petite marge : la méthode de la puissance sous-estime un peu λmax.
    return 4 / (3 * 1.1 * lambda);
  });

  const smooth = (l: number, sweeps: number) => {
    const L = levels[l]!;
    const w = work[l]!;
    const omega = omegas[l]!;
    for (let s = 0; s < sweeps; s++) {
      multiply(L, w.x, w.t, ue);
      for (let d = 0; d < w.x.length; d++) if (L.free[d] && L.diag[d]! > 0) w.x[d] = w.x[d]! + (omega * (w.b[d]! - w.t[d]!)) / L.diag[d]!;
    }
  };

  // Grille la plus grossière : résolution directe (Cholesky dense, factorisé une fois) si elle est
  // assez petite ; sinon gradient conjugué.
  const coarsest = levels[levels.length - 1]!;
  const direct = denseCholesky(coarsest);

  const coarseSolve = (l: number) => {
    const L = levels[l]!;
    const w = work[l]!;
    if (direct) {
      direct.solve(w.b, w.x);
      return;
    }
    const n3 = w.x.length;
    w.x.fill(0);
    const r = Float64Array.from(w.b);
    const z = new Float64Array(n3);
    const p = new Float64Array(n3);
    const q = w.t;
    const pre = () => {
      for (let d = 0; d < n3; d++) z[d] = L.free[d] && L.diag[d]! > 0 ? r[d]! / L.diag[d]! : 0;
    };
    const b0 = Math.sqrt(dot(r, r)) || 1;
    pre();
    p.set(z);
    let rz = dot(r, z);
    for (let it = 0; it < COARSE_ITERATIONS; it++) {
      multiply(L, p, q, ue);
      const pq = dot(p, q);
      if (!(pq > 0)) break;
      const alpha = rz / pq;
      for (let d = 0; d < n3; d++) {
        w.x[d] = w.x[d]! + alpha * p[d]!;
        r[d] = r[d]! - alpha * q[d]!;
      }
      if (Math.sqrt(dot(r, r)) / b0 < COARSE_TOLERANCE) break;
      pre();
      const rz2 = dot(r, z);
      const beta = rz2 / rz;
      rz = rz2;
      for (let d = 0; d < n3; d++) p[d] = z[d]! + beta * p[d]!;
    }
  };

  /** Cycle en V : approxime A⁻¹ b sur la grille l (résultat dans work[l].x). */
  const vcycle = (l: number) => {
    const L = levels[l]!;
    const w = work[l]!;
    if (l === levels.length - 1) return coarseSolve(l);
    w.x.fill(0);
    smooth(l, SWEEPS);
    multiply(L, w.x, w.t, ue);
    for (let d = 0; d < w.r.length; d++) w.r[d] = L.free[d] ? w.b[d]! - w.t[d]! : 0;
    // Restriction du résidu.
    const T = transfers[l]!;
    const C = levels[l + 1]!;
    const wc = work[l + 1]!;
    wc.b.fill(0);
    for (let n = 0; n < L.N; n++)
      for (let p = T.start[n]!; p < T.start[n + 1]!; p++) {
        const c = 3 * T.coarse[p]!;
        const wt = T.weight[p]!;
        wc.b[c] = wc.b[c]! + wt * w.r[3 * n]!;
        wc.b[c + 1] = wc.b[c + 1]! + wt * w.r[3 * n + 1]!;
        wc.b[c + 2] = wc.b[c + 2]! + wt * w.r[3 * n + 2]!;
      }
    for (let d = 0; d < wc.b.length; d++) if (!C.free[d]) wc.b[d] = 0;
    vcycle(l + 1);
    // Correction interpolée.
    for (let n = 0; n < L.N; n++)
      for (let p = T.start[n]!; p < T.start[n + 1]!; p++) {
        const c = 3 * T.coarse[p]!;
        const wt = T.weight[p]!;
        for (let k = 0; k < 3; k++) if (L.free[3 * n + k]) w.x[3 * n + k] = w.x[3 * n + k]! + wt * wc.x[c + k]!;
      }
    smooth(l, SWEEPS);
  };

  // Gradient conjugué flexible, préconditionné par un cycle en V.
  const L0 = levels[0]!;
  const w0 = work[0]!;
  const n3 = 3 * L0.N;
  const x = new Float64Array(n3);
  const q = new Float64Array(n3);
  const r = Float64Array.from(f);
  for (let d = 0; d < n3; d++) if (!L0.free[d]) r[d] = 0;
  const fn = Math.sqrt(dot(r, r)) || 1;
  if (options.initial) {
    for (let d = 0; d < n3; d++) x[d] = L0.free[d] ? options.initial[d]! : 0;
    multiply(L0, x, q, ue);
    for (let d = 0; d < n3; d++) r[d] = L0.free[d] ? r[d]! - q[d]! : 0;
  }
  const z = new Float64Array(n3);
  const zOld = new Float64Array(n3);
  const p = new Float64Array(n3);
  const precondition = () => {
    w0.b.set(r);
    vcycle(0);
    z.set(w0.x);
  };
  let converged = Math.sqrt(dot(r, r)) / fn < options.tolerance;
  let it = 0;
  if (!converged) {
    precondition();
    p.set(z);
    let rz = dot(r, z);
    while (it < options.maxIterations) {
      multiply(L0, p, q, ue);
      const pq = dot(p, q);
      if (!(pq > 0)) break;
      const alpha = rz / pq;
      for (let d = 0; d < n3; d++) {
        x[d] = x[d]! + alpha * p[d]!;
        r[d] = r[d]! - alpha * q[d]!;
      }
      it++;
      const rel = Math.sqrt(dot(r, r)) / fn;
      if (rel < options.tolerance) {
        converged = true;
        break;
      }
      if (options.onProgress && it % 2 === 0) options.onProgress(Math.min(0.99, Math.log(rel) / Math.log(options.tolerance)));
      zOld.set(z);
      precondition();
      let num = 0;
      for (let d = 0; d < n3; d++) num += r[d]! * (z[d]! - zOld[d]!);
      const beta = Math.max(0, num / rz);
      rz = dot(r, z);
      for (let d = 0; d < n3; d++) p[d] = z[d]! + beta * p[d]!;
    }
  }
  return { x, iterations: it, converged };
}
