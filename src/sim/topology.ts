/**
 * Optimisation topologique : où la matière de la pièce est-elle vraiment utile ? À partir des faces
 * fixées et de la charge de l'étude, on cherche la répartition de matière la plus raide qui ne
 * garde qu'une part donnée du volume. Méthode SIMP sur la grille de cubes de l'étude :
 *
 * - chaque cube de la pièce reçoit une densité ρ entre 0 (vide) et 1 (plein), de raideur
 *   E · (Emin + (1 − Emin) ρ³) : la pénalisation (exposant 3) rend les densités moyennes peu
 *   rentables, le résultat tend vers du plein ou du vide ;
 * - à chaque itération : calcul de la déformation (solveur multigrille, en repartant de la
 *   solution précédente), sensibilité de la souplesse (énergie de chaque cube), filtre de densité
 *   (rayon 1,5 cube : pas de damier, pas de détails plus fins que la grille), puis mise à jour par
 *   critère d'optimalité (pas limité à 0,2) en respectant le volume visé ;
 * - les cubes qui touchent une face fixée ou chargée restent pleins (la pièce doit garder ses
 *   appuis et l'endroit où l'on appuie).
 *
 * Références : Bendsøe et Sigmund, « Topology Optimization » (2003) ; Andreassen et al., « Efficient
 * topology optimization in MATLAB using 88 lines of code » (2011). Fonctions pures : elles tournent
 * dans le worker de simulation.
 */
import { boxStiffness, unitCubeStiffness, type VoxelGrid } from './fea';
import { solveElasticity } from './multigrid';
import { prepareStudy, type StudyInput } from './study';

export interface TopologyInput extends StudyInput {
  /** Part du volume de la pièce à garder (0,05 à 0,95). */
  volumeFraction: number;
  /** Nombre maximal d'itérations (défaut 60). */
  maxIterations?: number;
  /**
   * Même forme sur toute l'épaisseur selon cet axe (0 : x, 1 : y, 2 : z), ou `null` : forme libre.
   * Par défaut : l'axe de l'épaisseur d'une pièce plate (voir `flatAxis`), sinon forme libre.
   */
  extrusion?: 0 | 1 | 2 | null;
}

export interface TopologyGrid {
  nx: number;
  ny: number;
  nz: number;
  h: number;
  origin: { x: number; y: number; z: number };
}

export interface TopologyOutput {
  grid: TopologyGrid;
  /** Densité de chaque cube (0 → 1) ; −1 hors de la pièce. Rangés i + nx · (j + ny · k). */
  density: Float32Array;
  /** 1 : cube gardé plein (il touche une face fixée ou chargée). */
  passive: Uint8Array;
  /** Nœuds bloqués (pour écarter les morceaux qui ne tiennent à rien). */
  fixedNodes: Int32Array;
  /** Part du volume gardée (densités comprises). */
  volumeFraction: number;
  /** Souplesse (travail de la charge, N·mm) de la pièce pleine et de la pièce optimisée. */
  complianceFull: number;
  compliance: number;
  /** Souplesse à chaque itération. */
  history: number[];
  iterations: number;
  converged: boolean;
  cells: number;
  /** Les cubes gardés pleins (faces fixées et chargées) font déjà la part de matière visée. */
  saturated: boolean;
  /** Axe de l'épaisseur quand la forme est la même sur toute l'épaisseur (pièce plate), sinon null. */
  extrusion: 0 | 1 | 2 | null;
  ignoredCells: number;
  durationMs: number;
}

const PENAL = 3;
const EMIN = 1e-3;
const MOVE = 0.2;
const RADIUS = 1.5;
/** Arrêt quand plus aucune densité ne bouge de plus de 1 %. */
const CHANGE_TOLERANCE = 0.01;
const STALL = 0.002;
/**
 * Précision du calcul de déformation à chaque itération : il repart de la solution précédente, et la
 * souplesse finale est la même (4 chiffres) qu'avec 10⁻⁴, en 30 % de temps en moins (plaque et
 * bloc de 8 000 cubes).
 */
const SOLVE_TOLERANCE = 3e-3;

/**
 * Pièce plate : axe de son épaisseur, quand celle-ci vaut au plus 35 % de la dimension moyenne
 * (étendue des cubes pleins). Optimiser une plaque en 3D l'amincirait par l'intérieur, ce qui ne
 * se fabrique pas ; à forme constante dans l'épaisseur, on obtient des trous traversants.
 */
export function flatAxis(g: VoxelGrid, cells: number[]): 0 | 1 | 2 | null {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const c of cells) {
    const p = [c % g.nx, Math.floor(c / g.nx) % g.ny, Math.floor(c / (g.nx * g.ny))];
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a]!, p[a]!);
      hi[a] = Math.max(hi[a]!, p[a]! + 1);
    }
  }
  const size = [0, 1, 2].map((a) => Math.max(0, hi[a]! - lo[a]!));
  const order = [0, 1, 2].sort((a, b) => size[a]! - size[b]!) as (0 | 1 | 2)[];
  const thin = size[order[0]!]!;
  const mid = size[order[1]!]!;
  return thin > 0 && thin <= 0.35 * mid ? order[0]! : null;
}

/** Lance l'optimisation ; `onProgress` reçoit l'avancement (0 → 1). */
export function runTopology(input: TopologyInput, onProgress?: (f: number) => void): TopologyOutput {
  const t0 = performance.now();
  const vf = Math.min(0.95, Math.max(0.05, input.volumeFraction));
  const maxIterations = input.maxIterations ?? 60;
  const { g, fixed, loaded, forces, ignoredCells } = prepareStudy(input);
  const { nx, ny, nz } = g;
  const nc = nx * ny * nz;
  const N = (nx + 1) * (ny + 1) * (nz + 1);
  const sy = nx + 1;
  const sz = (nx + 1) * (ny + 1);
  // Même ordre de coins que la raideur élémentaire (voir fea.ts).
  const offsets = [0, 1, 1 + sy, sy, sz, 1 + sz, 1 + sy + sz, sy + sz];
  const design: number[] = [];
  for (let c = 0; c < nc; c++) if (g.solid[c]) design.push(c);
  const m = design.length;
  const base = new Int32Array(m);
  const slot = new Int32Array(nc).fill(-1);
  design.forEach((c, e) => {
    const i = c % nx;
    const j = Math.floor(c / nx) % ny;
    const k = Math.floor(c / (nx * ny));
    base[e] = i + sy * j + sz * k;
    slot[c] = e;
  });
  // Cubes gardés pleins : ceux qui touchent un nœud bloqué ou chargé.
  const held = new Uint8Array(N);
  for (const n of fixed) held[n] = 1;
  for (const n of loaded) held[n] = 1;
  const passive = new Uint8Array(m);
  for (let e = 0; e < m; e++) if (offsets.some((o) => held[base[e]! + o])) passive[e] = 1;
  // Variables de conception : une par cube ; pièce plate, une par colonne de cubes dans
  // l'épaisseur (même forme sur toute l'épaisseur : des trous qui traversent, comme à la découpe).
  const axis = input.extrusion === undefined ? flatAxis(g, design) : input.extrusion;
  const keyOf = (i: number, j: number, k: number) => (axis === 0 ? 0 : i) + nx * ((axis === 1 ? 0 : j) + ny * (axis === 2 ? 0 : k));
  const varSlot = new Int32Array(nc).fill(-1);
  const varOf = new Int32Array(m);
  const vI: number[] = [];
  const vJ: number[] = [];
  const vK: number[] = [];
  for (let e = 0; e < m; e++) {
    const c = design[e]!;
    const i = c % nx;
    const j = Math.floor(c / nx) % ny;
    const k = Math.floor(c / (nx * ny));
    const key = keyOf(i, j, k);
    let v = varSlot[key]!;
    if (v < 0) {
      v = varSlot[key] = vI.length;
      vI.push(axis === 0 ? 0 : i);
      vJ.push(axis === 1 ? 0 : j);
      vK.push(axis === 2 ? 0 : k);
    }
    varOf[e] = v;
  }
  const nv = vI.length;
  const count = new Float64Array(nv);
  const fixedVar = new Uint8Array(nv);
  for (let e = 0; e < m; e++) {
    count[varOf[e]!] = count[varOf[e]!]! + 1;
    if (passive[e]) fixedVar[varOf[e]!] = 1;
  }
  let passiveCount = 0;
  for (let v = 0; v < nv; v++) if (fixedVar[v]) passiveCount += count[v]!;
  // Filtre de densité : voisins à moins de RADIUS cubes, poids RADIUS − distance.
  const fStart = new Int32Array(nv + 1);
  const fIdx: number[] = [];
  const fW: number[] = [];
  const Hs = new Float64Array(nv);
  const reach = Math.ceil(RADIUS) - 1;
  for (let v = 0; v < nv; v++) {
    const i = vI[v]!;
    const j = vJ[v]!;
    const k = vK[v]!;
    for (let dk = axis === 2 ? 0 : -reach; dk <= (axis === 2 ? 0 : reach); dk++)
      for (let dj = axis === 1 ? 0 : -reach; dj <= (axis === 1 ? 0 : reach); dj++)
        for (let di = axis === 0 ? 0 : -reach; di <= (axis === 0 ? 0 : reach); di++) {
          const a = i + di, b = j + dj, d = k + dk;
          if (a < 0 || b < 0 || d < 0 || a >= nx || b >= ny || d >= nz) continue;
          const w2 = varSlot[a + nx * (b + ny * d)]!;
          if (w2 < 0) continue;
          const w = RADIUS - Math.sqrt(di * di + dj * dj + dk * dk);
          if (w <= 0) continue;
          fIdx.push(w2);
          fW.push(w);
          Hs[v] = Hs[v]! + w;
        }
    fStart[v + 1] = fIdx.length;
  }
  const filter = (x: Float64Array, out: Float64Array) => {
    for (let v = 0; v < nv; v++) {
      if (fixedVar[v]) {
        out[v] = 1;
        continue;
      }
      let s = 0;
      for (let p = fStart[v]!; p < fStart[v + 1]!; p++) s += fW[p]! * x[fIdx[p]!]!;
      out[v] = s / Hs[v]!;
    }
  };
  // Forces et nœuds bloqués.
  const f = new Float64Array(3 * N);
  for (const [n, v] of forces) {
    f[3 * n] = f[3 * n]! + v.x;
    f[3 * n + 1] = f[3 * n + 1]! + v.y;
    f[3 * n + 2] = f[3 * n + 2]! + v.z;
  }
  const fixedMask = new Uint8Array(N);
  for (const n of fixed) fixedMask[n] = 1;
  for (let n = 0; n < N; n++) if (fixedMask[n]) f[3 * n] = f[3 * n + 1] = f[3 * n + 2] = 0;
  const Ke = unitCubeStiffness(input.material.nu);
  const scale = input.material.E * g.h;
  const cellScale = new Float64Array(nc);
  const stiffnessCache = new Map<string, Float64Array>();
  const stiffness = (ax: number, ay: number, az: number) => {
    const key = `${ax},${ay},${az}`;
    let K = stiffnessCache.get(key);
    if (!K) stiffnessCache.set(key, (K = ax === 1 && ay === 1 && az === 1 ? Ke : boxStiffness(input.material.nu, ax, ay, az)));
    return K;
  };
  let u: Float64Array | undefined;
  const ce = new Float64Array(m);
  const ue = new Float64Array(24);
  /** Déformation pour les raideurs `cellScale` ; énergie de chaque cube (raideur unité) dans `ce`. */
  const solve = () => {
    const res = solveElasticity(nx, ny, nz, cellScale, fixedMask, stiffness, f, { tolerance: u ? SOLVE_TOLERANCE : 1e-6, maxIterations: 1500, ...(u ? { initial: u } : {}) });
    u = res.x;
    for (let e = 0; e < m; e++) {
      for (let a = 0; a < 8; a++) {
        const n = 3 * (base[e]! + offsets[a]!);
        ue[3 * a] = u[n]!;
        ue[3 * a + 1] = u[n + 1]!;
        ue[3 * a + 2] = u[n + 2]!;
      }
      let s = 0;
      for (let p = 0; p < 24; p++) {
        let row = 0;
        for (let q = 0; q < 24; q++) row += Ke[p * 24 + q]! * ue[q]!;
        s += ue[p]! * row;
      }
      ce[e] = s;
    }
    let c = 0;
    for (let d = 0; d < f.length; d++) c += f[d]! * u[d]!;
    return c;
  };
  // Référence : la pièce pleine.
  for (const c of design) cellScale[c] = scale;
  const complianceFull = solve();
  // Départ : densité uniforme qui respecte le volume visé (cubes gardés pleins compris).
  const free = m - passiveCount;
  const start = free > 0 ? Math.min(1, Math.max(0, (vf * m - passiveCount) / free)) : 1;
  const x = new Float64Array(nv);
  for (let v = 0; v < nv; v++) x[v] = fixedVar[v] ? 1 : start;
  const xPhys = new Float64Array(nv);
  const xNew = new Float64Array(nv);
  const xTry = new Float64Array(nv);
  const dc = new Float64Array(nv);
  const dcx = new Float64Array(nv);
  const dvx = new Float64Array(nv);
  const history: number[] = [];
  const target = Math.max(passiveCount, vf * m);
  let converged = false;
  let iterations = 0;
  let compliance = complianceFull;
  filter(x, xPhys);
  for (let it = 0; it < maxIterations; it++) {
    for (let e = 0; e < m; e++) cellScale[design[e]!] = scale * (EMIN + (1 - EMIN) * xPhys[varOf[e]!]! ** PENAL);
    compliance = solve();
    history.push(compliance);
    iterations = it + 1;
    dc.fill(0);
    for (let e = 0; e < m; e++) {
      const v = varOf[e]!;
      dc[v] = dc[v]! - PENAL * (1 - EMIN) * xPhys[v]! ** (PENAL - 1) * scale * ce[e]!;
    }
    // Sensibilités par rapport aux variables (transposée du filtre) ; volume : nombre de cubes.
    dcx.fill(0);
    dvx.fill(0);
    for (let v = 0; v < nv; v++) {
      if (fixedVar[v]) continue;
      for (let p = fStart[v]!; p < fStart[v + 1]!; p++) {
        const n = fIdx[p]!;
        const w = fW[p]! / Hs[v]!;
        dcx[n] = dcx[n]! + w * dc[v]!;
        dvx[n] = dvx[n]! + w * count[v]!;
      }
    }
    // Critère d'optimalité : multiplicateur de Lagrange du volume par dichotomie.
    let l1 = 0;
    let l2 = 1e9;
    while ((l2 - l1) / (l1 + l2) > 1e-4) {
      const lmid = 0.5 * (l1 + l2);
      for (let v = 0; v < nv; v++) {
        if (fixedVar[v]) {
          xNew[v] = 1;
          continue;
        }
        const val = x[v]! * Math.sqrt(Math.max(0, -dcx[v]!) / (Math.max(dvx[v]!, 1e-12) * lmid));
        xNew[v] = Math.max(0, Math.max(x[v]! - MOVE, Math.min(1, Math.min(x[v]! + MOVE, val))));
      }
      filter(xNew, xTry);
      let vol = 0;
      for (let v = 0; v < nv; v++) vol += count[v]! * xTry[v]!;
      if (vol > target) l1 = lmid;
      else l2 = lmid;
    }
    let change = 0;
    for (let v = 0; v < nv; v++) change = Math.max(change, Math.abs(xNew[v]! - x[v]!));
    x.set(xNew);
    filter(x, xPhys);
    onProgress?.(Math.min(0.99, iterations / maxIterations));
    // Arrêt : plus rien ne bouge, ou la souplesse ne gagne plus 0,2 % en 5 itérations.
    const stalled = history.length > 10 && Math.abs(history[history.length - 6]! - compliance) < STALL * compliance;
    if (change < CHANGE_TOLERANCE || stalled) {
      converged = true;
      break;
    }
  }
  const density = new Float32Array(nc).fill(-1);
  const passiveCells = new Uint8Array(nc);
  let kept = 0;
  for (let e = 0; e < m; e++) {
    const v = varOf[e]!;
    density[design[e]!] = xPhys[v]!;
    passiveCells[design[e]!] = fixedVar[v]!;
    kept += xPhys[v]!;
  }
  onProgress?.(1);
  return {
    grid: { nx, ny, nz, h: g.h, origin: g.origin },
    density,
    passive: passiveCells,
    fixedNodes: Int32Array.from(fixed),
    volumeFraction: m ? kept / m : 0,
    complianceFull,
    compliance,
    history,
    iterations,
    converged,
    cells: m,
    saturated: passiveCount >= vf * m,
    extrusion: axis,
    ignoredCells,
    durationMs: performance.now() - t0,
  };
}

export interface TopologySurface {
  positions: Float32Array;
  indices: Uint32Array;
  /** Cubes gardés au seuil choisi. */
  cells: number;
  /** Volume gardé (mm³). */
  volume: number;
}

/**
 * Forme obtenue : cubes de densité au moins `threshold` (et cubes gardés pleins), sans les morceaux
 * qui ne tiennent à aucune face fixée ; surface des cubes lissée (Taubin : lissage sans
 * rétrécissement) pour un aspect moins « en escalier ». Rapide : se recalcule quand on change le
 * seuil.
 */
export function topologySurface(out: TopologyOutput, threshold: number, smoothing = 6): TopologySurface {
  const { nx, ny, nz, h, origin } = out.grid;
  const nc = nx * ny * nz;
  const keep = new Uint8Array(nc);
  for (let c = 0; c < nc; c++) keep[c] = out.density[c]! >= 0 && (out.passive[c] || out.density[c]! >= threshold) ? 1 : 0;
  closeThinContacts(keep, nx, ny, nz);
  keepHeldPieces(keep, nx, ny, nz, out.fixedNodes);
  const sy = nx + 1;
  const sz = (nx + 1) * (ny + 1);
  const at = (i: number, j: number, k: number) => i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz && keep[i + nx * (j + ny * k)] === 1;
  const vertexOf = new Map<number, number>();
  const pos: number[] = [];
  const tris: number[] = [];
  const vertex = (i: number, j: number, k: number) => {
    const n = i + sy * j + sz * k;
    let v = vertexOf.get(n);
    if (v === undefined) {
      v = pos.length / 3;
      vertexOf.set(n, v);
      pos.push(origin.x + i * h, origin.y + j * h, origin.z + k * h);
    }
    return v;
  };
  // Pour chaque axe, les deux autres dans l'ordre circulaire : la face (0,0), (u), (u+v), (v) a
  // alors sa normale vers +axe.
  const AXES: [number, number, number][] = [
    [0, 1, 2],
    [1, 2, 0],
    [2, 0, 1],
  ];
  let cells = 0;
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        if (!keep[i + nx * (j + ny * k)]) continue;
        cells++;
        const p = [i, j, k];
        for (const [a, u, v] of AXES) {
          for (const side of [0, 1]) {
            const q = [...p];
            q[a] = q[a]! + (side ? 1 : -1);
            if (at(q[0]!, q[1]!, q[2]!)) continue;
            const corner = (du: number, dv: number) => {
              const r = [...p];
              r[a] = r[a]! + side;
              r[u] = r[u]! + du;
              r[v] = r[v]! + dv;
              return vertex(r[0]!, r[1]!, r[2]!);
            };
            const c00 = corner(0, 0), c10 = corner(1, 0), c11 = corner(1, 1), c01 = corner(0, 1);
            if (side) tris.push(c00, c10, c11, c00, c11, c01);
            else tris.push(c00, c11, c10, c00, c01, c11);
          }
        }
      }
  // Lissage de Taubin (λ = 0,5 ; μ = −0,53) sur les voisins par arête.
  const nv = pos.length / 3;
  const neighbours: Set<number>[] = Array.from({ length: nv }, () => new Set<number>());
  for (let t = 0; t < tris.length; t += 3)
    for (let e = 0; e < 3; e++) {
      const a = tris[t + e]!;
      const b = tris[t + ((e + 1) % 3)]!;
      neighbours[a]!.add(b);
      neighbours[b]!.add(a);
    }
  const next = new Float64Array(pos.length);
  for (let s = 0; s < 2 * smoothing; s++) {
    const factor = s % 2 === 0 ? 0.5 : -0.53;
    for (let v = 0; v < nv; v++) {
      const nb = neighbours[v]!;
      let mx = 0, my = 0, mz = 0;
      for (const w of nb) {
        mx += pos[3 * w]!;
        my += pos[3 * w + 1]!;
        mz += pos[3 * w + 2]!;
      }
      const k = nb.size || 1;
      next[3 * v] = pos[3 * v]! + factor * (mx / k - pos[3 * v]!);
      next[3 * v + 1] = pos[3 * v + 1]! + factor * (my / k - pos[3 * v + 1]!);
      next[3 * v + 2] = pos[3 * v + 2]! + factor * (mz / k - pos[3 * v + 2]!);
    }
    for (let d = 0; d < pos.length; d++) pos[d] = next[d]!;
  }
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(tris), cells, volume: cells * h * h * h };
}

/**
 * Deux cubes qui ne se touchent que par une arête ou un coin donnent une surface « pincée » (non
 * manifold), qu'un logiciel d'impression ou l'import STL coupe en morceaux : on comble le contact
 * en ajoutant un cube voisin (un peu de matière, une pièce d'un seul tenant).
 */
export function closeThinContacts(keep: Uint8Array, nx: number, ny: number, nz: number): void {
  const at = (i: number, j: number, k: number) => keep[i + nx * (j + ny * k)] === 1;
  const set = (i: number, j: number, k: number) => (keep[i + nx * (j + ny * k)] = 1);
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (let k = 0; k < nz; k++)
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) {
          // Contacts par une arête : carrés 2 × 2 dans les trois orientations.
          const squares: [number, number, number][][] = [];
          if (i + 1 < nx && j + 1 < ny) squares.push([[i, j, k], [i + 1, j, k], [i, j + 1, k], [i + 1, j + 1, k]]);
          if (i + 1 < nx && k + 1 < nz) squares.push([[i, j, k], [i + 1, j, k], [i, j, k + 1], [i + 1, j, k + 1]]);
          if (j + 1 < ny && k + 1 < nz) squares.push([[i, j, k], [i, j + 1, k], [i, j, k + 1], [i, j + 1, k + 1]]);
          for (const [a, b, c, d] of squares) {
            const A = at(...a!), B = at(...b!), C = at(...c!), D = at(...d!);
            if (A && D && !B && !C) {
              set(...b!);
              changed = true;
            } else if (B && C && !A && !D) {
              set(...a!);
              changed = true;
            }
          }
          // Contacts par un coin : cube 2 × 2 × 2 dont seuls deux coins opposés sont pleins.
          if (i + 1 < nx && j + 1 < ny && k + 1 < nz) {
            let n = 0;
            for (let c = 0; c < 8; c++) if (at(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1))) n++;
            if (n === 2)
              for (let c = 0; c < 4; c++) {
                const o = 7 - c;
                if (at(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1)) && at(i + (o & 1), j + ((o >> 1) & 1), k + ((o >> 2) & 1))) {
                  // Deux cubes ajoutés : un chemin par faces entre les deux coins.
                  set(i + (o & 1), j + (c & 2 ? 1 : 0), k + (c & 4 ? 1 : 0));
                  set(i + (o & 1), j + ((o >> 1) & 1), k + (c & 4 ? 1 : 0));
                  changed = true;
                }
              }
          }
        }
    if (!changed) break;
  }
}

/**
 * Ne garde que les morceaux (cubes reliés par une face) qui touchent un nœud bloqué : les autres
 * ne tiendraient à rien.
 */
export function keepHeldPieces(keep: Uint8Array, nx: number, ny: number, nz: number, fixedNodes: ArrayLike<number>): void {
  const sy = nx + 1;
  const sz = (nx + 1) * (ny + 1);
  const fixed = new Set<number>(Array.from(fixedNodes));
  const seen = new Uint8Array(keep.length);
  const stack: number[] = [];
  for (let start = 0; start < keep.length; start++) {
    if (!keep[start] || seen[start]) continue;
    const members: number[] = [];
    let held = false;
    seen[start] = 1;
    stack.push(start);
    while (stack.length) {
      const c = stack.pop()!;
      members.push(c);
      const i = c % nx;
      const j = Math.floor(c / nx) % ny;
      const k = Math.floor(c / (nx * ny));
      if (!held) for (let q = 0; q < 8 && !held; q++) held = fixed.has(i + (q & 1) + sy * (j + ((q >> 1) & 1)) + sz * (k + ((q >> 2) & 1)));
      const next = [i > 0 ? c - 1 : -1, i + 1 < nx ? c + 1 : -1, j > 0 ? c - nx : -1, j + 1 < ny ? c + nx : -1, k > 0 ? c - nx * ny : -1, k + 1 < nz ? c + nx * ny : -1];
      for (const f of next)
        if (f >= 0 && keep[f] && !seen[f]) {
          seen[f] = 1;
          stack.push(f);
        }
    }
    if (!held) for (const c of members) keep[c] = 0;
  }
}
