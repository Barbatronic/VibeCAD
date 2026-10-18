/**
 * Imbrication des pièces sur les plaques de découpe laser (calculs purs, testables).
 *
 * Une pièce est un contour extérieur et ses trous, centré sur le milieu de sa boîte ; sa
 * position sur une plaque est un placement : plaque, centre (mm) et angle (degrés).
 *
 * « Optimiser » (`nest`) : grille de cases (environ 400 sur le grand côté de la plaque) ; chaque
 * pièce, élargie de la moitié de l'espacement, y est tracée pour 4 orientations ; les pièces, des
 * plus grandes aux plus petites, sont posées au plus bas puis au plus à gauche possible, dans la
 * première plaque où elles tiennent (une petite pièce peut se loger dans le trou d'une grande).
 */
import type { Vec2 } from '../math/vec';

export type Loop = Vec2[];

export interface NestPiece {
  key: string;
  /** Contour extérieur puis trous, centrés sur le milieu de la boîte englobante (mm). */
  loops: Loop[];
}

export interface Placement {
  key: string;
  sheet: number;
  x: number;
  y: number;
  angle: number;
}

/** Contours d'une pièce placée (coordonnées de la plaque). */
export function placeLoops(loops: readonly Loop[], p: Pick<Placement, 'x' | 'y' | 'angle'>): Loop[] {
  const a = (p.angle * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return loops.map((l) => l.map((q) => ({ x: p.x + q.x * c - q.y * s, y: p.y + q.x * s + q.y * c })));
}

export function loopBounds(loops: readonly Loop[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const l of loops)
    for (const q of l) {
      minX = Math.min(minX, q.x);
      minY = Math.min(minY, q.y);
      maxX = Math.max(maxX, q.x);
      maxY = Math.max(maxY, q.y);
    }
  return { minX, minY, maxX, maxY };
}

/** Pièce centrée : contours décalés pour que le milieu de leur boîte soit l'origine. */
export function centered(loops: readonly Loop[]): { loops: Loop[]; center: Vec2 } {
  const b = loopBounds(loops);
  const center = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  return { loops: loops.map((l) => l.map((q) => ({ x: q.x - center.x, y: q.y - center.y }))), center };
}

/** Point dans la matière (règle pair-impair sur tous les contours). */
function inside(loops: readonly Loop[], x: number, y: number): boolean {
  let c = false;
  for (const l of loops)
    for (let i = 0, j = l.length - 1; i < l.length; j = i++) {
      const a = l[i]!;
      const b = l[j]!;
      if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) c = !c;
    }
  return c;
}

/** Distance d'un point au segment. */
function segDist(px: number, py: number, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / l2)) : 0;
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

/**
 * Cases occupées par une pièce (contours déjà tournés), élargie de `grow` mm : une case est prise
 * si son centre est dans la matière ou à moins de `grow` + une demi-case d'un bord.
 */
function rasterize(loops: readonly Loop[], cell: number, grow: number): { w: number; h: number; ox: number; oy: number; cells: Uint8Array; count: number } {
  const b = loopBounds(loops);
  const pad = grow + cell;
  const ox = b.minX - pad;
  const oy = b.minY - pad;
  const w = Math.max(1, Math.ceil((b.maxX - b.minX + 2 * pad) / cell));
  const h = Math.max(1, Math.ceil((b.maxY - b.minY + 2 * pad) / cell));
  const cells = new Uint8Array(w * h);
  const reach = grow + cell * 0.5;
  const edges: [Vec2, Vec2][] = [];
  for (const l of loops) for (let i = 0; i < l.length; i++) edges.push([l[i]!, l[(i + 1) % l.length]!]);
  let count = 0;
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const x = ox + (i + 0.5) * cell;
      const y = oy + (j + 0.5) * cell;
      let on = inside(loops, x, y);
      if (!on) for (const [a, e] of edges) if (segDist(x, y, a, e) <= reach) { on = true; break; }
      if (on) {
        cells[i + w * j] = 1;
        count++;
      }
    }
  return { w, h, ox, oy, cells, count };
}

/**
 * Pose les pièces au plus serré : `fixed` sont déjà posées (gardées), `pieces` sont à poser.
 * Renvoie les placements des pièces à poser (une plaque de plus quand elles ne tiennent plus).
 */
export function nest(pieces: readonly NestPiece[], sheet: { w: number; h: number }, spacing: number, fixed: readonly (Placement & { loops: Loop[] })[] = [], maxSheets = 50): Placement[] {
  const cell = Math.max(0.5, Math.max(sheet.w, sheet.h) / 400);
  const gw = Math.max(1, Math.floor(sheet.w / cell));
  const gh = Math.max(1, Math.floor(sheet.h / cell));
  const grids: Uint8Array[] = [];
  const grid = (s: number) => {
    while (grids.length <= s) {
      const g = new Uint8Array(gw * gh);
      // Bordure : avec la demi-marge autour de chaque pièce, l'espacement reste libre au bord.
      const m = Math.ceil(spacing / 2 / cell);
      for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) if (i < m || j < m || i >= gw - m || j >= gh - m) g[i + gw * j] = 1;
      grids.push(g);
    }
    return grids[s]!;
  };
  const stamp = (g: Uint8Array, r: ReturnType<typeof rasterize>, gi: number, gj: number) => {
    for (let j = 0; j < r.h; j++)
      for (let i = 0; i < r.w; i++) {
        if (!r.cells[i + r.w * j]) continue;
        const x = gi + i;
        const y = gj + j;
        if (x >= 0 && y >= 0 && x < gw && y < gh) g[x + gw * y] = 1;
      }
  };
  // Pièces déjà posées (élargies de la moitié de l'espacement).
  for (const f of fixed) {
    const r = rasterize(placeLoops(f.loops, f), cell, spacing / 2);
    stamp(grid(f.sheet), r, Math.round(r.ox / cell), Math.round(r.oy / cell));
  }
  const fits = (g: Uint8Array, r: ReturnType<typeof rasterize>, gi: number, gj: number) => {
    if (gi < 0 || gj < 0 || gi + r.w > gw || gj + r.h > gh) return false;
    for (let j = 0; j < r.h; j++) {
      const row = gw * (gj + j) + gi;
      const prow = r.w * j;
      for (let i = 0; i < r.w; i++) if (r.cells[prow + i] && g[row + i]) return false;
    }
    return true;
  };
  const order = pieces
    .map((p) => ({ p, area: Math.abs(areaOf(p.loops[0] ?? [])) }))
    .sort((a, b) => b.area - a.area)
    .map((x) => x.p);
  const out: Placement[] = [];
  for (const piece of order) {
    const rotations = [0, 90, 180, 270].map((angle) => ({ angle, r: rasterize(placeLoops(piece.loops, { x: 0, y: 0, angle }), cell, spacing / 2) }));
    let placed: Placement | null = null;
    for (let s = 0; s < maxSheets && !placed; s++) {
      const g = grid(s);
      let best: { gi: number; gj: number; angle: number; r: (typeof rotations)[number]['r'] } | null = null;
      // Pour chaque orientation, la première place au plus bas puis au plus à gauche ; on garde
      // l'orientation dont le haut de la pièce est le plus bas (rangées plates), puis la plus à gauche.
      let bestScore = Infinity;
      for (const rot of rotations) {
        search: for (let gj = 0; gj + rot.r.h <= gh; gj++) {
          if (gj + rot.r.h >= bestScore) break;
          for (let gi = 0; gi + rot.r.w <= gw; gi++) {
            if (fits(g, rot.r, gi, gj)) {
              const score = gj + rot.r.h + (gi + rot.r.w) / (gw + 1);
              if (score < bestScore) {
                bestScore = score;
                best = { gi, gj, angle: rot.angle, r: rot.r };
              }
              break search;
            }
          }
        }
      }
      if (best) {
        stamp(g, best.r, best.gi, best.gj);
        // Origine de la pièce tournée (son centre) dans la plaque.
        placed = { key: piece.key, sheet: s, x: best.gi * cell - best.r.ox, y: best.gj * cell - best.r.oy, angle: best.angle };
      }
    }
    if (placed) out.push(placed);
  }
  return out;
}

function areaOf(loop: Loop): number {
  let a = 0;
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i]!;
    const q = loop[(i + 1) % loop.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** Deux segments se coupent-ils (intérieur strict) ? */
function segmentsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const o = (p: Vec2, q: Vec2, r: Vec2) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/**
 * Pièces mal posées : qui en chevauchent une autre (contours qui se croisent, ou l'une dans la
 * matière de l'autre) ou qui dépassent de la plaque. Renvoie les rangs concernés.
 */
export function placementProblems(placed: readonly { sheet: number; loops: Loop[] }[], sheet: { w: number; h: number }): { overlap: Set<number>; outside: Set<number> } {
  const overlap = new Set<number>();
  const outside = new Set<number>();
  const boxes = placed.map((p) => loopBounds(p.loops));
  placed.forEach((_p, i) => {
    const b = boxes[i]!;
    if (b.minX < -1e-6 || b.minY < -1e-6 || b.maxX > sheet.w + 1e-6 || b.maxY > sheet.h + 1e-6) outside.add(i);
  });
  for (let i = 0; i < placed.length; i++)
    for (let j = i + 1; j < placed.length; j++) {
      const A = placed[i]!;
      const B = placed[j]!;
      if (A.sheet !== B.sheet) continue;
      const a = boxes[i]!;
      const b = boxes[j]!;
      if (a.maxX <= b.minX || b.maxX <= a.minX || a.maxY <= b.minY || b.maxY <= a.minY) continue;
      let hit = false;
      const ea = A.loops.flatMap((l) => l.map((p, k) => [p, l[(k + 1) % l.length]!] as const));
      const eb = B.loops.flatMap((l) => l.map((p, k) => [p, l[(k + 1) % l.length]!] as const));
      outer: for (const [p, q] of ea) for (const [r, t] of eb) if (segmentsCross(p, q, r, t)) { hit = true; break outer; }
      // Une pièce entièrement dans la matière de l'autre (pas dans un trou).
      if (!hit) hit = inside(B.loops, A.loops[0]![0]!.x, A.loops[0]![0]!.y) || inside(A.loops, B.loops[0]![0]!.x, B.loops[0]![0]!.y);
      if (hit) {
        overlap.add(i);
        overlap.add(j);
      }
    }
  return { overlap, outside };
}
