/**
 * Contour d'une pièce plate allégée : la forme obtenue par l'optimisation topologique étant la
 * même dans toute l'épaisseur, son contour plan suffit à la redessiner (esquisse extrudée,
 * découpable au laser, modifiable comme une autre pièce).
 *
 * Courbes de niveau (« marching squares ») des densités aux centres des cubes, au seuil choisi :
 * le contour suit les densités (biais lisses) au lieu des marches des cubes ; les cubes écartés
 * (morceaux qui ne tiennent à rien) et gardés (appuis) sont respectés. Les contours sont ensuite
 * simplifiés (Douglas-Peucker) ; les tout petits trous et îlots sont ignorés. Fonctions pures.
 */
import { closeThinContacts, keepHeldPieces, type TopologyOutput } from './topology';

export type OutlinePlane = 'XY' | 'XZ' | 'YZ';

export interface TopologyOutline {
  /** Plan d'origine de l'esquisse et position du contour le long de sa normale (repère du plan). */
  plane: OutlinePlane;
  /** Coordonnées, le long de l'axe de l'épaisseur, des deux faces de la plaque (start < end). */
  start: number;
  end: number;
  /** Contours fermés (coordonnées u, v du plan, mm), sans répéter le premier point. */
  loops: { x: number; y: number }[][];
}

/** Axes (u, v) du plan d'esquisse pour chaque axe d'épaisseur (mêmes conventions que les plans d'origine). */
const PLANE_OF: Record<0 | 1 | 2, { plane: OutlinePlane; u: 0 | 1 | 2; v: 0 | 1 | 2 }> = {
  0: { plane: 'YZ', u: 1, v: 2 },
  1: { plane: 'XZ', u: 0, v: 2 },
  2: { plane: 'XY', u: 0, v: 1 },
};

/** Contour de la forme au seuil donné ; null si la pièce n'est pas plate ou s'il ne reste rien. */
export function topologyOutline(out: TopologyOutput, threshold: number): TopologyOutline | null {
  const axis = out.extrusion;
  if (axis === null) return null;
  const { nx, ny, nz, h, origin } = out.grid;
  const n = [nx, ny, nz];
  const o = [origin.x, origin.y, origin.z];
  const { plane, u, v } = PLANE_OF[axis];
  // Cubes gardés, comme pour la forme 3D (contacts pincés comblés, morceaux tenus seulement).
  const nc = nx * ny * nz;
  const keep = new Uint8Array(nc);
  for (let c = 0; c < nc; c++) keep[c] = out.density[c]! >= 0 && (out.passive[c] || out.density[c]! >= threshold) ? 1 : 0;
  closeThinContacts(keep, nx, ny, nz);
  keepHeldPieces(keep, nx, ny, nz, out.fixedNodes);
  // Champ plan : une valeur par colonne (forme constante dans l'épaisseur), bordure nulle.
  const nu = n[u]! + 2;
  const nv = n[v]! + 2;
  const field = new Float64Array(nu * nv);
  let any = false;
  let lo = Infinity;
  let hi = -Infinity;
  const idx = [0, 0, 0];
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const c = i + nx * (j + ny * k);
        if (out.density[c]! < 0) continue;
        idx[0] = i;
        idx[1] = j;
        idx[2] = k;
        lo = Math.min(lo, idx[axis]!);
        hi = Math.max(hi, idx[axis]! + 1);
        const d = out.density[c]!;
        // Valeur du même côté du seuil que la décision « gardé / écarté ».
        const value = keep[c] ? Math.min(1, Math.max(out.passive[c] ? 1 : d, threshold + 0.02)) : Math.max(0, Math.min(d, threshold - 0.02));
        const f = idx[u]! + 1 + nu * (idx[v]! + 1);
        if (value > field[f]!) field[f] = value;
        if (keep[c]) any = true;
      }
  if (!any) return null;
  // Points de passage sur les arêtes entre centres voisins, repérés pour chaîner les segments.
  const at = (a: number, b: number) => field[a + nu * b]!;
  const pointOf = new Map<string, { x: number; y: number }>();
  const links = new Map<string, string[]>();
  const cross = (a0: number, b0: number, a1: number, b1: number) => {
    const key = a0 < a1 || (a0 === a1 && b0 < b1) ? `${a0},${b0},${a1},${b1}` : `${a1},${b1},${a0},${b0}`;
    if (!pointOf.has(key)) {
      const f0 = at(a0, b0);
      const f1 = at(a1, b1);
      const t = Math.min(1, Math.max(0, (threshold - f0) / (f1 - f0)));
      // Centre du cube (a, b) de la grille bordée : coordonnée o + (a − 1 + 0,5) · h.
      const x = o[u]! + (a0 + t * (a1 - a0) - 0.5) * h;
      const y = o[v]! + (b0 + t * (b1 - b0) - 0.5) * h;
      pointOf.set(key, { x, y });
    }
    return key;
  };
  const link = (p: string, q: string) => {
    (links.get(p) ?? links.set(p, []).get(p)!).push(q);
    (links.get(q) ?? links.set(q, []).get(q)!).push(p);
  };
  for (let b = 0; b + 1 < nv; b++)
    for (let a = 0; a + 1 < nu; a++) {
      const v0 = at(a, b) >= threshold ? 1 : 0;
      const v1 = at(a + 1, b) >= threshold ? 1 : 0;
      const v2 = at(a + 1, b + 1) >= threshold ? 1 : 0;
      const v3 = at(a, b + 1) >= threshold ? 1 : 0;
      const code = v0 | (v1 << 1) | (v2 << 2) | (v3 << 3);
      if (code === 0 || code === 15) continue;
      const bottom = () => cross(a, b, a + 1, b);
      const right = () => cross(a + 1, b, a + 1, b + 1);
      const top = () => cross(a, b + 1, a + 1, b + 1);
      const left = () => cross(a, b, a, b + 1);
      // Cas à deux coins opposés : le centre du carré décide s'ils sont reliés.
      const centre = (at(a, b) + at(a + 1, b) + at(a + 1, b + 1) + at(a, b + 1)) / 4 >= threshold;
      switch (code) {
        case 1:
        case 14:
          link(left(), bottom());
          break;
        case 2:
        case 13:
          link(bottom(), right());
          break;
        case 3:
        case 12:
          link(left(), right());
          break;
        case 4:
        case 11:
          link(right(), top());
          break;
        case 6:
        case 9:
          link(bottom(), top());
          break;
        case 7:
        case 8:
          link(left(), top());
          break;
        case 5:
          if (centre) {
            link(left(), top());
            link(bottom(), right());
          } else {
            link(left(), bottom());
            link(right(), top());
          }
          break;
        case 10:
          if (centre) {
            link(left(), bottom());
            link(right(), top());
          } else {
            link(bottom(), right());
            link(left(), top());
          }
          break;
      }
    }
  // Chaînage en contours fermés.
  const used = new Set<string>();
  const loops: { x: number; y: number }[][] = [];
  for (const start of links.keys()) {
    if (used.has(start)) continue;
    const loop: string[] = [start];
    used.add(start);
    let prev = start;
    let cur = links.get(start)![0]!;
    while (cur !== start && !used.has(cur)) {
      loop.push(cur);
      used.add(cur);
      const next = links.get(cur)!.find((q) => q !== prev) ?? links.get(cur)![0]!;
      prev = cur;
      cur = next;
    }
    const pts = simplify(loop.map((k) => pointOf.get(k)!), 0.2 * h);
    if (pts.length >= 3 && Math.abs(area(pts)) >= 1.5 * h * h) loops.push(pts);
  }
  if (!loops.length) return null;
  return { plane, start: o[axis]! + lo * h, end: o[axis]! + hi * h, loops };
}

/** Aire signée d'un contour fermé. */
function area(p: { x: number; y: number }[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i]!;
    const b = p[(i + 1) % p.length]!;
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

/** Douglas-Peucker sur un contour fermé (coupé en deux au point le plus éloigné du premier). */
function simplify(p: { x: number; y: number }[], tol: number): { x: number; y: number }[] {
  if (p.length < 4) return p;
  let far = 0;
  let best = -1;
  for (let i = 1; i < p.length; i++) {
    const d = (p[i]!.x - p[0]!.x) ** 2 + (p[i]!.y - p[0]!.y) ** 2;
    if (d > best) {
      best = d;
      far = i;
    }
  }
  const half = (from: number, to: number) => {
    const seq = [];
    for (let i = from; i !== to; i = (i + 1) % p.length) seq.push(p[i]!);
    seq.push(p[to]!);
    return dp(seq, tol);
  };
  const a = half(0, far);
  const b = half(far, 0);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

function dp(p: { x: number; y: number }[], tol: number): { x: number; y: number }[] {
  if (p.length < 3) return p;
  const a = p[0]!;
  const b = p[p.length - 1]!;
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  let worst = 0;
  let at = 0;
  for (let i = 1; i < p.length - 1; i++) {
    const d = Math.abs((b.x - a.x) * (a.y - p[i]!.y) - (a.x - p[i]!.x) * (b.y - a.y)) / len;
    if (d > worst) {
      worst = d;
      at = i;
    }
  }
  if (worst <= tol) return [a, b];
  return [...dp(p.slice(0, at + 1), tol).slice(0, -1), ...dp(p.slice(at), tol)];
}
