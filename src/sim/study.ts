/**
 * Étude de déformation d'une pièce, à partir de son maillage d'affichage : découpe en cubes (taille
 * choisie pour viser un nombre de cubes), nœuds bloqués (faces fixées) et chargés (faces qui
 * reçoivent la force), calcul, puis report des déplacements et des contraintes sur chaque sommet
 * du maillage pour l'affichage. Fonctions pures : elles tournent dans un worker dédié.
 */
import { solveFea, type Material, type VoxelGrid } from './fea';
import { nodePosition, nodesNearTriangles, voxelize } from './voxelize';

export interface StudyInput {
  positions: Float32Array;
  indices: Uint32Array;
  /** Triangles (9 nombres chacun) des faces fixées et des faces chargées. */
  fixed: Float32Array;
  loaded: Float32Array;
  /** Triangles des faces gardées pleines par l'allègement (optimisation topologique). */
  keep?: Float32Array;
  /** Force totale (N), répartie sur les nœuds des faces chargées. */
  force: { x: number; y: number; z: number };
  material: Material;
  /** Nombre de cubes visé (précision). */
  targetCells: number;
  /** Assemblage : un solide fermé par plage d'indices (voir `voxelize`). */
  parts?: { start: number; count: number }[];
}

export interface StudyOutput {
  /** Maillage du résultat : celui de la pièce, subdivisé pour que les couleurs soient fines. */
  positions: Float32Array;
  indices: Uint32Array;
  /** Déplacement de chaque sommet de ce maillage (mm), rangé 3 · sommet + composante. */
  displacement: Float32Array;
  /** Contrainte de von Mises à chaque sommet (MPa). */
  stress: Float32Array;
  maxDisplacement: number;
  maxStress: number;
  cells: number;
  /** Cubes écartés : morceaux qui ne touchent aucune face fixée (ils flotteraient). */
  ignoredCells: number;
  cellSize: number;
  iterations: number;
  converged: boolean;
  durationMs: number;
}

export type StudyErrorCode = 'NO_FIXED' | 'NO_LOAD' | 'EMPTY' | 'LOAD_FLOATING';

export class StudyError extends Error {
  constructor(readonly code: StudyErrorCode) {
    super(code);
    this.name = 'StudyError';
  }
}

/** Volume (mm³) enfermé par un maillage fermé (somme des tétraèdres depuis l'origine). */
export function meshVolume(positions: ArrayLike<number>, indices: ArrayLike<number>): number {
  let v = 0;
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const a = 3 * indices[t]!;
    const b = 3 * indices[t + 1]!;
    const c = 3 * indices[t + 2]!;
    const [ax, ay, az] = [positions[a]!, positions[a + 1]!, positions[a + 2]!];
    const [bx, by, bz] = [positions[b]!, positions[b + 1]!, positions[b + 2]!];
    const [cx, cy, cz] = [positions[c]!, positions[c + 1]!, positions[c + 2]!];
    v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return Math.abs(v) / 6;
}

const solidCount = (g: VoxelGrid) => g.solid.reduce((s, v) => s + v, 0);

/**
 * Grille dont le nombre de cubes pleins approche `target` (une pièce fine resserre la grille). La
 * plus petite dimension de la pièce (son épaisseur, souvent) compte un nombre entier de cubes :
 * sinon la grille l'épaissirait d'un demi-cube et la pièce paraîtrait trop raide.
 */
export function gridFor(positions: Float32Array, indices: Uint32Array, target: number, parts?: { start: number; count: number }[]): VoxelGrid {
  const volume = meshVolume(positions, indices);
  let h = Math.cbrt(Math.max(volume, 1e-6) / target);
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) {
    lo[i % 3] = Math.min(lo[i % 3]!, positions[i]!);
    hi[i % 3] = Math.max(hi[i % 3]!, positions[i]!);
  }
  const thin = Math.min(hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!);
  const snap = (x: number) => (thin > 0 ? thin / Math.max(1, Math.round(thin / x)) : x);
  h = snap(h);
  let grid = voxelize({ positions, indices }, h, parts);
  for (let i = 0; i < 4 && solidCount(grid) < target / 3; i++) {
    h = snap(h / 1.5);
    grid = voxelize({ positions, indices }, h, parts);
  }
  return grid;
}

/** Nœuds de la surface des cubes : touchant au moins un cube vide (ou le bord de la grille). */
export function surfaceNodes(g: VoxelGrid): number[] {
  const solid = (i: number, j: number, k: number) => i >= 0 && j >= 0 && k >= 0 && i < g.nx && j < g.ny && k < g.nz && g.solid[i + g.nx * (j + g.ny * k)] === 1;
  const out: number[] = [];
  for (let k = 0; k <= g.nz; k++)
    for (let j = 0; j <= g.ny; j++)
      for (let i = 0; i <= g.nx; i++) {
        let full = 0;
        for (let c = 0; c < 8; c++) if (solid(i - (c & 1), j - ((c >> 1) & 1), k - ((c >> 2) & 1))) full++;
        if (full > 0 && full < 8) out.push(i + (g.nx + 1) * (j + (g.ny + 1) * k));
      }
  return out;
}

/**
 * Subdivise les triangles dont une arête dépasse `maxEdge` : à chaque passe, l'arête la plus
 * longue de chaque grand triangle est coupée en son milieu, et chaque triangle est redécoupé selon
 * ses arêtes coupées (1, 2 ou 3). Une arête est coupée pour tous les triangles qui la partagent
 * (repérée par la position de ses extrémités) : le maillage reste sans fente.
 */
export function refineMesh(positionsIn: ArrayLike<number>, indicesIn: ArrayLike<number>, maxEdge: number, maxTriangles = 300_000): { positions: Float32Array; indices: Uint32Array } {
  const pos: number[] = Array.from(positionsIn);
  let tris: number[] = Array.from(indicesIn);
  const len2 = (a: number, b: number) => (pos[3 * a]! - pos[3 * b]!) ** 2 + (pos[3 * a + 1]! - pos[3 * b + 1]!) ** 2 + (pos[3 * a + 2]! - pos[3 * b + 2]!) ** 2;
  const q = (v: number) => Math.round(v * 1e4);
  const pkey = (a: number) => `${q(pos[3 * a]!)},${q(pos[3 * a + 1]!)},${q(pos[3 * a + 2]!)}`;
  const ekey = (a: number, b: number) => {
    const ka = pkey(a);
    const kb = pkey(b);
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
  };
  const max2 = maxEdge * maxEdge;
  for (let pass = 0; pass < 16; pass++) {
    const marked = new Set<string>();
    for (let t = 0; t < tris.length; t += 3) {
      const v = [tris[t]!, tris[t + 1]!, tris[t + 2]!];
      let best = -1;
      let bestL = max2;
      for (let e = 0; e < 3; e++) {
        const l = len2(v[e]!, v[(e + 1) % 3]!);
        if (l > bestL) {
          bestL = l;
          best = e;
        }
      }
      if (best >= 0) marked.add(ekey(v[best]!, v[(best + 1) % 3]!));
    }
    if (marked.size === 0 || tris.length / 3 + 3 * marked.size > maxTriangles) break;
    // Milieux des arêtes coupées (un sommet par paire d'indices : les faces gardent leurs sommets).
    const mids = new Map<string, number>();
    const mid = (a: number, b: number) => {
      const k = a < b ? `${a}:${b}` : `${b}:${a}`;
      let m = mids.get(k);
      if (m === undefined) {
        m = pos.length / 3;
        pos.push((pos[3 * a]! + pos[3 * b]!) / 2, (pos[3 * a + 1]! + pos[3 * b + 1]!) / 2, (pos[3 * a + 2]! + pos[3 * b + 2]!) / 2);
        mids.set(k, m);
      }
      return m;
    };
    const next: number[] = [];
    for (let t = 0; t < tris.length; t += 3) {
      const [a, b, c] = [tris[t]!, tris[t + 1]!, tris[t + 2]!];
      const cut = [marked.has(ekey(a, b)), marked.has(ekey(b, c)), marked.has(ekey(c, a))];
      const n = cut.filter(Boolean).length;
      if (n === 0) {
        next.push(a, b, c);
        continue;
      }
      if (n === 3) {
        const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
        next.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
        continue;
      }
      // Rotation pour que la première arête coupée soit (p0, p1).
      let r = cut.indexOf(true);
      if (n === 2 && !cut[(r + 1) % 3]) r = (r + 2) % 3;
      const p = [a, b, c];
      const p0 = p[r]!, p1 = p[(r + 1) % 3]!, p2 = p[(r + 2) % 3]!;
      const m01 = mid(p0, p1);
      if (n === 1) {
        next.push(p0, m01, p2, m01, p1, p2);
      } else {
        // Arêtes (p0, p1) et (p1, p2) coupées.
        const m12 = mid(p1, p2);
        next.push(m01, p1, m12, p0, m01, m12, p0, m12, p2);
      }
    }
    tris = next;
  }
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(tris) };
}

/**
 * Retire les morceaux de matière qui ne touchent aucun nœud bloqué (cubes reliés dès qu'ils
 * partagent un nœud) : sans appui, ils flotteraient et le calcul n'aurait pas de solution.
 * Renvoie le nombre de cubes retirés.
 */
export function removeFloating(g: VoxelGrid, fixedNodes: ReadonlySet<number>): number {
  const n = g.nx * g.ny * g.nz;
  const label = new Int32Array(n).fill(-1);
  let removed = 0;
  const stack: number[] = [];
  for (let start = 0; start < n; start++) {
    if (!g.solid[start] || label[start]! >= 0) continue;
    // Parcours du morceau, en notant s'il touche un nœud bloqué.
    const members: number[] = [];
    let held = false;
    label[start] = start;
    stack.push(start);
    while (stack.length) {
      const e = stack.pop()!;
      members.push(e);
      const i = e % g.nx;
      const j = Math.floor(e / g.nx) % g.ny;
      const k = Math.floor(e / (g.nx * g.ny));
      if (!held) for (let c = 0; c < 8 && !held; c++) held = fixedNodes.has(i + (c & 1) + (g.nx + 1) * (j + ((c >> 1) & 1) + (g.ny + 1) * (k + ((c >> 2) & 1))));
      for (let dk = -1; dk <= 1; dk++)
        for (let dj = -1; dj <= 1; dj++)
          for (let di = -1; di <= 1; di++) {
            const a = i + di, b = j + dj, c = k + dk;
            if (a < 0 || b < 0 || c < 0 || a >= g.nx || b >= g.ny || c >= g.nz) continue;
            const f = a + g.nx * (b + g.ny * c);
            if (g.solid[f] && label[f]! < 0) {
              label[f] = start;
              stack.push(f);
            }
          }
    }
    if (!held) {
      for (const e of members) g.solid[e] = 0;
      removed += members.length;
    }
  }
  return removed;
}

/** Cube plein le plus proche d'un point (cube qui le contient s'il est plein). */
function nearestSolidCell(g: VoxelGrid, x: number, y: number, z: number): [number, number, number] | null {
  const clamp = (v: number, n: number) => Math.min(n - 1, Math.max(0, Math.floor(v)));
  const ci = clamp((x - g.origin.x) / g.h, g.nx);
  const cj = clamp((y - g.origin.y) / g.h, g.ny);
  const ck = clamp((z - g.origin.z) / g.h, g.nz);
  for (let r = 0; r <= 3; r++) {
    let best: [number, number, number] | null = null;
    let bestD = Infinity;
    for (let k = ck - r; k <= ck + r; k++)
      for (let j = cj - r; j <= cj + r; j++)
        for (let i = ci - r; i <= ci + r; i++) {
          if (i < 0 || j < 0 || k < 0 || i >= g.nx || j >= g.ny || k >= g.nz || !g.solid[i + g.nx * (j + g.ny * k)]) continue;
          const d = (g.origin.x + (i + 0.5) * g.h - x) ** 2 + (g.origin.y + (j + 0.5) * g.h - y) ** 2 + (g.origin.z + (k + 0.5) * g.h - z) ** 2;
          if (d < bestD) {
            bestD = d;
            best = [i, j, k];
          }
        }
    if (best) return best;
  }
  return null;
}

/**
 * Grille de cubes, nœuds bloqués et forces nodales d'une étude (commun au calcul de déformation et
 * à l'optimisation topologique). Les morceaux qui ne touchent aucune face fixée sont retirés.
 */
export function prepareStudy(input: StudyInput): { g: VoxelGrid; fixed: number[]; loaded: number[]; forces: Map<number, { x: number; y: number; z: number }>; ignoredCells: number } {
  const g = gridFor(input.positions, input.indices, input.targetCells, input.parts);
  if (solidCount(g) === 0) throw new StudyError('EMPTY');
  const tol = 0.75 * g.h;
  const fixed = nodesNearTriangles(g, input.fixed, tol, surfaceNodes(g));
  if (fixed.length === 0) throw new StudyError('NO_FIXED');
  const fixedSet = new Set(fixed);
  const loadedBefore = nodesNearTriangles(g, input.loaded, tol, surfaceNodes(g)).filter((n) => !fixedSet.has(n));
  if (loadedBefore.length === 0) throw new StudyError('NO_LOAD');
  const ignoredCells = removeFloating(g, fixedSet);
  const loaded = ignoredCells ? nodesNearTriangles(g, input.loaded, tol, surfaceNodes(g)).filter((n) => !fixedSet.has(n)) : loadedBefore;
  // La charge appuie sur un morceau qui ne touche rien de tenu : il flotterait.
  if (loaded.length === 0) throw new StudyError('LOAD_FLOATING');
  const share = { x: input.force.x / loaded.length, y: input.force.y / loaded.length, z: input.force.z / loaded.length };
  const forces = new Map(loaded.map((n) => [n, share]));
  return { g, fixed, loaded, forces, ignoredCells };
}

/** Lance l'étude ; `onProgress` reçoit l'avancement du calcul (0 → 1). */
export function runStudy(input: StudyInput, onProgress?: (f: number) => void): StudyOutput {
  const t0 = performance.now();
  const { g, fixed, forces, ignoredCells } = prepareStudy(input);
  const cells = solidCount(g);
  const result = solveFea({ grid: g, material: input.material, fixedNodes: fixed, forces }, { tolerance: 1e-6, maxIterations: 8000, ...(onProgress ? { onProgress } : {}) });
  // Contrainte aux nœuds : moyenne des cubes pleins voisins (affichage plus doux que cube par cube).
  const N = (g.nx + 1) * (g.ny + 1) * (g.nz + 1);
  const nodeStress = new Float32Array(N);
  const nodeCount = new Uint8Array(N);
  for (let k = 0; k < g.nz; k++)
    for (let j = 0; j < g.ny; j++)
      for (let i = 0; i < g.nx; i++) {
        const e = i + g.nx * (j + g.ny * k);
        if (!g.solid[e]) continue;
        for (let c = 0; c < 8; c++) {
          const n = i + (c & 1) + (g.nx + 1) * (j + ((c >> 1) & 1) + (g.ny + 1) * (k + ((c >> 2) & 1)));
          nodeStress[n] = nodeStress[n]! + result.vonMises[e]!;
          nodeCount[n] = nodeCount[n]! + 1;
        }
      }
  for (let n = 0; n < N; n++) if (nodeCount[n]) nodeStress[n] = nodeStress[n]! / nodeCount[n]!;
  // Report sur les sommets d'un maillage subdivisé : interpolation dans le cube plein le plus proche.
  const mesh = refineMesh(input.positions, input.indices, 1.5 * g.h);
  const nv = mesh.positions.length / 3;
  const displacement = new Float32Array(3 * nv);
  const stress = new Float32Array(nv);
  let maxDisplacement = 0;
  let maxStress = 0;
  const u = result.displacement;
  for (let v = 0; v < nv; v++) {
    const x = mesh.positions[3 * v]!;
    const y = mesh.positions[3 * v + 1]!;
    const z = mesh.positions[3 * v + 2]!;
    const cell = nearestSolidCell(g, x, y, z);
    if (!cell) continue;
    const [i, j, k] = cell;
    const base = nodePosition(g, i + (g.nx + 1) * (j + (g.ny + 1) * k));
    const t = [x - base.x, y - base.y, z - base.z].map((d) => Math.min(1, Math.max(0, d / g.h))) as [number, number, number];
    let dx = 0;
    let dy = 0;
    let dz = 0;
    let s = 0;
    for (let c = 0; c < 8; c++) {
      const a = c & 1;
      const b = (c >> 1) & 1;
      const d = (c >> 2) & 1;
      const w = (a ? t[0] : 1 - t[0]) * (b ? t[1] : 1 - t[1]) * (d ? t[2] : 1 - t[2]);
      const n = i + a + (g.nx + 1) * (j + b + (g.ny + 1) * (k + d));
      dx += w * u[3 * n]!;
      dy += w * u[3 * n + 1]!;
      dz += w * u[3 * n + 2]!;
      s += w * nodeStress[n]!;
    }
    displacement[3 * v] = dx;
    displacement[3 * v + 1] = dy;
    displacement[3 * v + 2] = dz;
    stress[v] = s;
    maxDisplacement = Math.max(maxDisplacement, Math.hypot(dx, dy, dz));
    maxStress = Math.max(maxStress, s);
  }
  return {
    positions: mesh.positions,
    indices: mesh.indices,
    displacement,
    stress,
    maxDisplacement,
    maxStress,
    cells,
    ignoredCells,
    cellSize: g.h,
    iterations: result.iterations,
    converged: result.converged,
    durationMs: performance.now() - t0,
  };
}

/** Échelle d'exagération : le plus grand déplacement affiché vaut environ 8 % de la taille de la pièce. */
export function exaggerationFor(maxDisplacement: number, size: number): number {
  if (!(maxDisplacement > 0)) return 1;
  const target = 0.08 * size;
  return Math.max(1, target / maxDisplacement);
}

/** Couleur (dégradé bleu → vert → jaune → rouge) d'une valeur entre 0 et 1. */
export function heatColor(f: number): [number, number, number] {
  const stops: [number, number, number][] = [
    [0.15, 0.3, 0.85],
    [0.1, 0.75, 0.85],
    [0.2, 0.8, 0.3],
    [0.95, 0.85, 0.15],
    [0.9, 0.2, 0.15],
  ];
  const x = Math.min(1, Math.max(0, f)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const t = x - i;
  const a = stops[i]!;
  const b = stops[i + 1]!;
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])];
}
