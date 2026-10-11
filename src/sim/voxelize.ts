/**
 * Découpe d'une pièce en cubes : un cube est plein si son centre est dans la pièce. Chaque ligne
 * de cubes (parallèle à x) est traversée par un rayon ; les traversées du maillage fermé de la
 * pièce alternent entrée et sortie (parité).
 */
import type { VoxelGrid } from './fea';
import { nodeIndex } from './fea';

export interface TriangleMesh {
  positions: ArrayLike<number>;
  indices: ArrayLike<number>;
}

/** Grille de cubes d'arête `h` couvrant la boîte du maillage. */
export function voxelize(mesh: TriangleMesh, h: number): VoxelGrid {
  const pos = mesh.positions;
  const idx = mesh.indices;
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (let i = 0; i < pos.length; i += 3) {
    min.x = Math.min(min.x, pos[i]!);
    min.y = Math.min(min.y, pos[i + 1]!);
    min.z = Math.min(min.z, pos[i + 2]!);
    max.x = Math.max(max.x, pos[i]!);
    max.y = Math.max(max.y, pos[i + 1]!);
    max.z = Math.max(max.z, pos[i + 2]!);
  }
  const n = (lo: number, hi: number) => Math.max(1, Math.ceil((hi - lo) / h - 1e-9));
  const nx = n(min.x, max.x);
  const ny = n(min.y, max.y);
  const nz = n(min.z, max.z);
  const grid: VoxelGrid = { nx, ny, nz, h, origin: { ...min }, solid: new Uint8Array(nx * ny * nz) };
  // Triangles rangés par lignes (j, k) que couvre leur ombre dans le plan YZ.
  const rows: number[][] = Array.from({ length: ny * nz }, () => []);
  for (let t = 0; t + 2 < idx.length; t += 3) {
    let y0 = Infinity;
    let y1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (let v = 0; v < 3; v++) {
      const p = 3 * idx[t + v]!;
      y0 = Math.min(y0, pos[p + 1]!);
      y1 = Math.max(y1, pos[p + 1]!);
      z0 = Math.min(z0, pos[p + 2]!);
      z1 = Math.max(z1, pos[p + 2]!);
    }
    const j0 = Math.max(0, Math.floor((y0 - min.y) / h - 0.5));
    const j1 = Math.min(ny - 1, Math.ceil((y1 - min.y) / h - 0.5));
    const k0 = Math.max(0, Math.floor((z0 - min.z) / h - 0.5));
    const k1 = Math.min(nz - 1, Math.ceil((z1 - min.z) / h - 0.5));
    for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) rows[j + ny * k]!.push(t);
  }
  // Léger décalage du rayon : il ne passe jamais exactement par une arête ou un sommet.
  const dy = h * 1.2345e-4;
  const dz = h * 2.3456e-4;
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      const yc = min.y + (j + 0.5) * h + dy;
      const zc = min.z + (k + 0.5) * h + dz;
      const hits: number[] = [];
      for (const t of rows[j + ny * k]!) {
        const a = 3 * idx[t]!;
        const b = 3 * idx[t + 1]!;
        const c = 3 * idx[t + 2]!;
        // Coordonnées barycentriques du point (yc, zc) dans le triangle projeté sur YZ.
        const ay = pos[a + 1]!, az = pos[a + 2]!;
        const by = pos[b + 1]!, bz = pos[b + 2]!;
        const cy = pos[c + 1]!, cz = pos[c + 2]!;
        const det = (by - ay) * (cz - az) - (cy - ay) * (bz - az);
        if (Math.abs(det) < 1e-18) continue;
        const u = ((yc - ay) * (cz - az) - (cy - ay) * (zc - az)) / det;
        const v = ((by - ay) * (zc - az) - (yc - ay) * (bz - az)) / det;
        if (u < 0 || v < 0 || u + v > 1) continue;
        hits.push(pos[a]! + u * (pos[b]! - pos[a]!) + v * (pos[c]! - pos[a]!));
      }
      hits.sort((p, q) => p - q);
      for (let m = 0; m + 1 < hits.length; m += 2) {
        const i0 = Math.max(0, Math.ceil((hits[m]! - min.x) / h - 0.5));
        const i1 = Math.min(nx - 1, Math.floor((hits[m + 1]! - min.x) / h - 0.5));
        for (let i = i0; i <= i1; i++) grid.solid[i + nx * (j + ny * k)] = 1;
      }
    }
  }
  return grid;
}

/** Position d'un nœud de la grille. */
export function nodePosition(g: VoxelGrid, n: number): { x: number; y: number; z: number } {
  const sx = g.nx + 1;
  const sxy = sx * (g.ny + 1);
  const k = Math.floor(n / sxy);
  const j = Math.floor((n - k * sxy) / sx);
  const i = n - k * sxy - j * sx;
  return { x: g.origin.x + i * g.h, y: g.origin.y + j * g.h, z: g.origin.z + k * g.h };
}

/** Nœuds des cubes pleins. */
export function activeNodes(g: VoxelGrid): number[] {
  const seen = new Uint8Array((g.nx + 1) * (g.ny + 1) * (g.nz + 1));
  for (let k = 0; k < g.nz; k++)
    for (let j = 0; j < g.ny; j++)
      for (let i = 0; i < g.nx; i++) {
        if (!g.solid[i + g.nx * (j + g.ny * k)]) continue;
        for (let c = 0; c < 8; c++) seen[nodeIndex(g, i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1))] = 1;
      }
  const out: number[] = [];
  seen.forEach((v, n) => v && out.push(n));
  return out;
}

/** Distance d'un point à un triangle. */
function pointTriangle(p: number[], a: number[], b: number[], c: number[]): number {
  // Projection sur le plan du triangle, puis bornes (méthode d'Ericson, « closest point »).
  const sub = (u: number[], v: number[]) => [u[0]! - v[0]!, u[1]! - v[1]!, u[2]! - v[2]!];
  const dot = (u: number[], v: number[]) => u[0]! * v[0]! + u[1]! * v[1]! + u[2]! * v[2]!;
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  const at = (q: number[]) => Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!, p[2]! - q[2]!);
  const lerp = (u: number[], v: number[], t: number) => [u[0]! + t * (v[0]! - u[0]!), u[1]! + t * (v[1]! - u[1]!), u[2]! + t * (v[2]! - u[2]!)];
  if (d1 <= 0 && d2 <= 0) return at(a);
  const bp = sub(p, b);
  const d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return at(b);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return at(lerp(a, b, d1 / (d1 - d3)));
  const cp = sub(p, c);
  const d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return at(c);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return at(lerp(a, c, d2 / (d2 - d6)));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return at(lerp(b, c, (d4 - d3) / (d4 - d3 + (d5 - d6))));
  const denom = 1 / (va + vb + vc);
  const v = vb * denom, w = vc * denom;
  return at([a[0]! + ab[0]! * v + ac[0]! * w, a[1]! + ab[1]! * v + ac[1]! * w, a[2]! + ab[2]! * v + ac[2]! * w]);
}

/**
 * Nœuds des cubes pleins à moins de `tolerance` (mm) de l'un des triangles donnés (une face) ;
 * `candidates` restreint la recherche (par exemple aux nœuds de surface).
 */
export function nodesNearTriangles(g: VoxelGrid, triangles: ArrayLike<number>, tolerance: number, candidates?: readonly number[]): number[] {
  const tris: number[][][] = [];
  for (let t = 0; t + 8 < triangles.length; t += 9) tris.push([0, 1, 2].map((v) => [triangles[t + 3 * v]!, triangles[t + 3 * v + 1]!, triangles[t + 3 * v + 2]!]));
  const out: number[] = [];
  for (const n of candidates ?? activeNodes(g)) {
    const p = nodePosition(g, n);
    const q = [p.x, p.y, p.z];
    for (const [a, b, c] of tris) {
      // Rejet rapide par la boîte du triangle.
      if (q[0]! < Math.min(a![0]!, b![0]!, c![0]!) - tolerance || q[0]! > Math.max(a![0]!, b![0]!, c![0]!) + tolerance) continue;
      if (q[1]! < Math.min(a![1]!, b![1]!, c![1]!) - tolerance || q[1]! > Math.max(a![1]!, b![1]!, c![1]!) + tolerance) continue;
      if (q[2]! < Math.min(a![2]!, b![2]!, c![2]!) - tolerance || q[2]! > Math.max(a![2]!, b![2]!, c![2]!) + tolerance) continue;
      if (pointTriangle(q, a!, b!, c!) <= tolerance) {
        out.push(n);
        break;
      }
    }
  }
  return out;
}
