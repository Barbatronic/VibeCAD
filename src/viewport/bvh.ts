/**
 * Arbre de boîtes englobantes (BVH) sur les triangles d'un maillage : le lancer de rayon de la
 * sélection n'examine que les triangles des boîtes traversées, au lieu de tous ceux de la pièce.
 * Construit une fois par maillage, à la première sélection qui le touche.
 */

export interface TriangleBvh {
  /** Boîte de chaque nœud : min x, y, z puis max x, y, z. */
  boxes: Float32Array;
  /** Nœud interne : rang de son fils gauche (le droit suit) ; feuille : −1. */
  left: Int32Array;
  right: Int32Array;
  /** Feuille : plage de `order`. */
  start: Int32Array;
  count: Int32Array;
  /** Triangles rangés par feuille. */
  order: Uint32Array;
}

const LEAF = 8;

export function buildBvh(positions: ArrayLike<number>, index: ArrayLike<number>): TriangleBvh {
  const n = Math.floor(index.length / 3);
  const order = new Uint32Array(n);
  const centroid = new Float32Array(3 * n);
  const tmin = new Float32Array(3 * n);
  const tmax = new Float32Array(3 * n);
  for (let t = 0; t < n; t++) {
    order[t] = t;
    for (let k = 0; k < 3; k++) {
      const a = positions[3 * index[3 * t]! + k]!;
      const b = positions[3 * index[3 * t + 1]! + k]!;
      const c = positions[3 * index[3 * t + 2]! + k]!;
      tmin[3 * t + k] = Math.min(a, b, c);
      tmax[3 * t + k] = Math.max(a, b, c);
      centroid[3 * t + k] = (a + b + c) / 3;
    }
  }
  const capacity = Math.max(1, 2 * Math.ceil(n / 1) + 1);
  const boxes = new Float32Array(6 * capacity);
  const left = new Int32Array(capacity).fill(-1);
  const right = new Int32Array(capacity).fill(-1);
  const start = new Int32Array(capacity);
  const count = new Int32Array(capacity);
  let nodes = 1;
  start[0] = 0;
  count[0] = n;
  const stack = [0];
  while (stack.length) {
    const node = stack.pop()!;
    const s = start[node]!;
    const c = count[node]!;
    // Boîte du nœud, et étendue des centres (pour choisir l'axe de coupe).
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    const clo = [Infinity, Infinity, Infinity];
    const chi = [-Infinity, -Infinity, -Infinity];
    for (let i = s; i < s + c; i++) {
      const t = order[i]!;
      for (let k = 0; k < 3; k++) {
        if (tmin[3 * t + k]! < lo[k]!) lo[k] = tmin[3 * t + k]!;
        if (tmax[3 * t + k]! > hi[k]!) hi[k] = tmax[3 * t + k]!;
        const m = centroid[3 * t + k]!;
        if (m < clo[k]!) clo[k] = m;
        if (m > chi[k]!) chi[k] = m;
      }
    }
    boxes.set([lo[0]!, lo[1]!, lo[2]!, hi[0]!, hi[1]!, hi[2]!], 6 * node);
    if (c <= LEAF) continue;
    const ext = [chi[0]! - clo[0]!, chi[1]! - clo[1]!, chi[2]! - clo[2]!];
    const axis = ext[0]! >= ext[1]! && ext[0]! >= ext[2]! ? 0 : ext[1]! >= ext[2]! ? 1 : 2;
    if (!(ext[axis]! > 0)) continue;
    // Coupe au milieu de l'étendue des centres (partition sur place).
    const mid = (clo[axis]! + chi[axis]!) / 2;
    let i = s;
    let j = s + c - 1;
    while (i <= j) {
      if (centroid[3 * order[i]! + axis]! < mid) i++;
      else {
        const tmp = order[i]!;
        order[i] = order[j]!;
        order[j] = tmp;
        j--;
      }
    }
    const nl = i - s;
    if (nl === 0 || nl === c) continue;
    const l = nodes++;
    const r = nodes++;
    left[node] = l;
    right[node] = r;
    start[l] = s;
    count[l] = nl;
    start[r] = i;
    count[r] = c - nl;
    stack.push(l, r);
  }
  return { boxes, left, right, start, count, order };
}

/** Entrée du rayon dans la boîte du nœud (distance), ou Infinity s'il la manque ou la dépasse. */
function boxEntry(boxes: Float32Array, node: number, o: readonly number[], inv: readonly number[], maxT: number): number {
  let t0 = 0;
  let t1 = maxT;
  for (let k = 0; k < 3; k++) {
    let a = (boxes[6 * node + k]! - o[k]!) * inv[k]!;
    let b = (boxes[6 * node + 3 + k]! - o[k]!) * inv[k]!;
    if (a > b) [a, b] = [b, a];
    // Rayon parallèle à la face et hors de la tranche : NaN ou ±Infinity, la boîte est manquée.
    if (Number.isNaN(a) || Number.isNaN(b)) {
      if (o[k]! < boxes[6 * node + k]! || o[k]! > boxes[6 * node + 3 + k]!) return Infinity;
      continue;
    }
    if (a > t0) t0 = a;
    if (b < t1) t1 = b;
    if (t0 > t1) return Infinity;
  }
  return t0;
}

/**
 * Premier triangle touché par le rayon (origine, direction unitaire), des deux côtés, à moins de
 * `maxT`. Renvoie la distance et le rang du triangle, ou null.
 */
export function raycastBvh(bvh: TriangleBvh, positions: ArrayLike<number>, index: ArrayLike<number>, o: readonly [number, number, number], d: readonly [number, number, number], maxT = Infinity): { t: number; triangle: number } | null {
  const inv = [1 / d[0], 1 / d[1], 1 / d[2]];
  let best = maxT;
  let hit = -1;
  const stack: number[] = [0];
  while (stack.length) {
    const node = stack.pop()!;
    if (boxEntry(bvh.boxes, node, o, inv, best) === Infinity) continue;
    const l = bvh.left[node]!;
    if (l >= 0) {
      const r = bvh.right[node]!;
      // Le fils le plus proche d'abord : le second est souvent écarté par la distance trouvée.
      const tl = boxEntry(bvh.boxes, l, o, inv, best);
      const tr = boxEntry(bvh.boxes, r, o, inv, best);
      if (tl <= tr) {
        if (tr !== Infinity) stack.push(r);
        if (tl !== Infinity) stack.push(l);
      } else {
        if (tl !== Infinity) stack.push(l);
        stack.push(r);
      }
      continue;
    }
    const s = bvh.start[node]!;
    const e = s + bvh.count[node]!;
    for (let i = s; i < e; i++) {
      const tri = bvh.order[i]!;
      const a = 3 * index[3 * tri]!;
      const b = 3 * index[3 * tri + 1]!;
      const c = 3 * index[3 * tri + 2]!;
      // Möller–Trumbore.
      const e1x = positions[b]! - positions[a]!, e1y = positions[b + 1]! - positions[a + 1]!, e1z = positions[b + 2]! - positions[a + 2]!;
      const e2x = positions[c]! - positions[a]!, e2y = positions[c + 1]! - positions[a + 1]!, e2z = positions[c + 2]! - positions[a + 2]!;
      const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (det > -1e-12 && det < 1e-12) continue;
      const f = 1 / det;
      const sx = o[0] - positions[a]!, sy = o[1] - positions[a + 1]!, sz = o[2] - positions[a + 2]!;
      const u = f * (sx * px + sy * py + sz * pz);
      if (u < 0 || u > 1) continue;
      const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
      const v = f * (d[0] * qx + d[1] * qy + d[2] * qz);
      if (v < 0 || u + v > 1) continue;
      const t = f * (e2x * qx + e2y * qy + e2z * qz);
      if (t > 1e-9 && t < best) {
        best = t;
        hit = tri;
      }
    }
  }
  return hit >= 0 ? { t: best, triangle: hit } : null;
}
