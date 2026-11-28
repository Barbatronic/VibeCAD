/**
 * Booléens 2D exacts sur des contours faits de segments et d'arcs (calcul pur) : union, différence,
 * intersection de formes, et coins arrondis d'un polygone. Le résultat garde de vrais segments et de
 * vrais arcs (pas de polygone approché), prêts à être posés dans une esquisse.
 *
 * Méthode : chaque courbe est coupée à ses intersections avec les courbes des autres formes ; un
 * morceau appartient au contour du résultat si la matière du résultat est d'un seul côté de lui
 * (test juste à gauche et juste à droite de son milieu). Cette règle traite aussi les bords communs
 * à deux formes (gardés une fois, ou retirés s'ils séparent deux morceaux de matière).
 */
import type { Vec2 } from '../math/vec';

const TAU = 2 * Math.PI;
/** Tolérance de position (mm). */
export const BOOL_TOL = 1e-6;

/**
 * Segment de `a` à `b`, ou arc de centre `c`, rayon `r`, de l'angle `a0` à `a0 + sweep` (sens
 * trigonométrique). `rev` (résultat d'un booléen) : la matière est à droite du sens de parcours.
 */
export type Prim = ({ kind: 'line'; a: Vec2; b: Vec2 } | { kind: 'arc'; c: Vec2; r: number; a0: number; sweep: number }) & { rev?: boolean };

/** Forme utilisable dans un booléen : son contour (courbes dans n'importe quel ordre) et sa matière. */
export interface Operand {
  prims: Prim[];
  inside: (p: Vec2) => boolean;
}

export type BoolOp = 'union' | 'difference' | 'intersection';

const norm = (a: number) => ((a % TAU) + TAU) % TAU;
export const arcPoint = (p: Extract<Prim, { kind: 'arc' }>, angle: number): Vec2 => ({ x: p.c.x + p.r * Math.cos(angle), y: p.c.y + p.r * Math.sin(angle) });
const isFull = (p: Extract<Prim, { kind: 'arc' }>) => p.sweep >= TAU - 1e-12;

/** Cercle complet. */
export function circlePrim(c: Vec2, r: number): Prim {
  return { kind: 'arc', c, r, a0: 0, sweep: TAU };
}

/** Arc de `from` à `to` autour de `c`, dans le sens trigonométrique. */
export function arcPrim(c: Vec2, r: number, from: number, to: number): Prim {
  const a0 = norm(from);
  let sweep = norm(to) - a0;
  if (sweep <= 1e-12) sweep += TAU;
  return { kind: 'arc', c, r, a0, sweep };
}

// ---------------------------------------------------------------------------
// Matière d'une forme simple : règle pair-impair (rayon horizontal vers +x)

function crossings(prims: readonly Prim[], p: Vec2): number {
  let n = 0;
  for (const q of prims) {
    if (q.kind === 'line') {
      const { a, b } = q;
      if (a.y > p.y !== b.y > p.y) {
        const x = a.x + ((p.y - a.y) * (b.x - a.x)) / (b.y - a.y);
        if (x > p.x) n++;
      }
    } else {
      const dy = p.y - q.c.y;
      if (Math.abs(dy) >= q.r) continue;
      const dx = Math.sqrt(q.r * q.r - dy * dy);
      for (const x of [q.c.x - dx, q.c.x + dx]) {
        if (x <= p.x) continue;
        if (isFull(q) || norm(Math.atan2(dy, x - q.c.x) - q.a0) < q.sweep) n++;
      }
    }
  }
  return n;
}

/** Forme simple (un ou plusieurs contours fermés, règle pair-impair). */
export function simpleOperand(prims: Prim[]): Operand {
  return { prims, inside: (p) => crossings(prims, p) % 2 === 1 };
}

// ---------------------------------------------------------------------------
// Intersections et découpe

/** Paramètre d'un point sur une courbe : t ∈ [0, 1] le long d'un segment, angle depuis a0 sur un arc. */
function paramOf(p: Prim, q: Vec2): number {
  if (p.kind === 'line') {
    const dx = p.b.x - p.a.x;
    const dy = p.b.y - p.a.y;
    return ((q.x - p.a.x) * dx + (q.y - p.a.y) * dy) / (dx * dx + dy * dy);
  }
  return norm(Math.atan2(q.y - p.c.y, q.x - p.c.x) - p.a0);
}

function onPrim(p: Prim, q: Vec2): boolean {
  if (p.kind === 'line') {
    const t = paramOf(p, q);
    const len = Math.hypot(p.b.x - p.a.x, p.b.y - p.a.y);
    return t >= -BOOL_TOL / len && t <= 1 + BOOL_TOL / len;
  }
  if (isFull(p)) return true;
  const d = paramOf(p, q);
  const tolA = BOOL_TOL / p.r;
  return d <= p.sweep + tolA || d >= TAU - tolA;
}

/** Points communs de deux courbes (cercles et droites portés, filtrés à leurs étendues). */
function meet(p: Prim, q: Prim): Vec2[] {
  const raw: Vec2[] = [];
  if (p.kind === 'line' && q.kind === 'line') {
    const d1 = { x: p.b.x - p.a.x, y: p.b.y - p.a.y };
    const d2 = { x: q.b.x - q.a.x, y: q.b.y - q.a.y };
    const den = d1.x * d2.y - d1.y * d2.x;
    if (Math.abs(den) > 1e-12 * Math.hypot(d1.x, d1.y) * Math.hypot(d2.x, d2.y)) {
      const t = ((q.a.x - p.a.x) * d2.y - (q.a.y - p.a.y) * d2.x) / den;
      raw.push({ x: p.a.x + d1.x * t, y: p.a.y + d1.y * t });
    } else {
      // Segments alignés : les extrémités de l'un posées sur l'autre.
      raw.push(q.a, q.b, p.a, p.b);
    }
  } else if (p.kind === 'line' || q.kind === 'line') {
    const s = (p.kind === 'line' ? p : q) as Extract<Prim, { kind: 'line' }>;
    const c = (p.kind === 'line' ? q : p) as Extract<Prim, { kind: 'arc' }>;
    const d = { x: s.b.x - s.a.x, y: s.b.y - s.a.y };
    const f = { x: s.a.x - c.c.x, y: s.a.y - c.c.y };
    const A = d.x * d.x + d.y * d.y;
    const B = 2 * (f.x * d.x + f.y * d.y);
    const C = f.x * f.x + f.y * f.y - c.r * c.r;
    let disc = B * B - 4 * A * C;
    if (disc > -1e-9 * A * c.r * c.r) {
      disc = Math.max(0, disc);
      for (const sg of disc === 0 ? [1] : [-1, 1]) {
        const t = (-B + sg * Math.sqrt(disc)) / (2 * A);
        raw.push({ x: s.a.x + d.x * t, y: s.a.y + d.y * t });
      }
    }
  } else {
    const a = p as Extract<Prim, { kind: 'arc' }>;
    const b = q as Extract<Prim, { kind: 'arc' }>;
    const dx = b.c.x - a.c.x;
    const dy = b.c.y - a.c.y;
    const d = Math.hypot(dx, dy);
    if (d < BOOL_TOL) {
      // Arcs concentriques de même rayon : extrémités de l'un sur l'autre.
      if (Math.abs(a.r - b.r) < BOOL_TOL) {
        for (const arc of [a, b]) if (!isFull(arc)) raw.push(arcPoint(arc, arc.a0), arcPoint(arc, arc.a0 + arc.sweep));
      }
    } else if (d <= a.r + b.r + BOOL_TOL && d >= Math.abs(a.r - b.r) - BOOL_TOL) {
      const l = (a.r * a.r - b.r * b.r + d * d) / (2 * d);
      const h = Math.sqrt(Math.max(0, a.r * a.r - l * l));
      const mx = a.c.x + (dx * l) / d;
      const my = a.c.y + (dy * l) / d;
      raw.push({ x: mx + (dy * h) / d, y: my - (dx * h) / d });
      if (h > BOOL_TOL) raw.push({ x: mx - (dy * h) / d, y: my + (dx * h) / d });
    }
  }
  return raw.filter((x) => onPrim(p, x) && onPrim(q, x));
}

/** Coupe une courbe aux paramètres donnés (intérieurs à son étendue). */
function split(p: Prim, cuts: number[]): Prim[] {
  if (p.kind === 'line') {
    const len = Math.hypot(p.b.x - p.a.x, p.b.y - p.a.y);
    const ts = [...new Set(cuts.filter((t) => t * len > BOOL_TOL && (1 - t) * len > BOOL_TOL))].sort((a, b) => a - b);
    const at = (t: number): Vec2 => ({ x: p.a.x + (p.b.x - p.a.x) * t, y: p.a.y + (p.b.y - p.a.y) * t });
    const pts = [p.a, ...ts.map(at), p.b];
    const out: Prim[] = [];
    for (let i = 0; i + 1 < pts.length; i++) if (Math.hypot(pts[i + 1]!.x - pts[i]!.x, pts[i + 1]!.y - pts[i]!.y) > BOOL_TOL) out.push({ kind: 'line', a: pts[i]!, b: pts[i + 1]! });
    return out;
  }
  const tolA = BOOL_TOL / p.r;
  const full = isFull(p);
  let ds = cuts.filter((d) => (full ? true : d > tolA && d < p.sweep - tolA)).sort((a, b) => a - b);
  ds = ds.filter((d, i) => i === 0 || d - ds[i - 1]! > tolA);
  if (full) {
    if (ds.length === 0) return [p];
    if (ds.length === 1) return [{ ...p, a0: p.a0 + ds[0]!, sweep: TAU }];
    return ds.map((d, i) => {
      const next = i + 1 < ds.length ? ds[i + 1]! : ds[0]! + TAU;
      return { kind: 'arc', c: p.c, r: p.r, a0: norm(p.a0 + d), sweep: next - d };
    });
  }
  const bounds = [0, ...ds, p.sweep];
  const out: Prim[] = [];
  for (let i = 0; i + 1 < bounds.length; i++) out.push({ kind: 'arc', c: p.c, r: p.r, a0: norm(p.a0 + bounds[i]!), sweep: bounds[i + 1]! - bounds[i]! });
  return out;
}

/** Milieu d'un morceau et sa normale unitaire, vers la gauche du sens de parcours. */
function midAndNormal(p: Prim): { m: Vec2; n: Vec2 } {
  if (p.kind === 'line') {
    const dx = p.b.x - p.a.x;
    const dy = p.b.y - p.a.y;
    const l = Math.hypot(dx, dy);
    return { m: { x: (p.a.x + p.b.x) / 2, y: (p.a.y + p.b.y) / 2 }, n: { x: -dy / l, y: dx / l } };
  }
  const t = p.a0 + p.sweep / 2;
  return { m: arcPoint(p, t), n: { x: -Math.cos(t), y: -Math.sin(t) } };
}

function samePiece(p: Prim, q: Prim): boolean {
  const near = (u: Vec2, v: Vec2) => Math.hypot(u.x - v.x, u.y - v.y) < 1e3 * BOOL_TOL;
  if (p.kind === 'line' && q.kind === 'line') return (near(p.a, q.a) && near(p.b, q.b)) || (near(p.a, q.b) && near(p.b, q.a));
  if (p.kind === 'arc' && q.kind === 'arc') {
    return near(p.c, q.c) && Math.abs(p.r - q.r) < 1e3 * BOOL_TOL && near(midAndNormal(p).m, midAndNormal(q).m);
  }
  return false;
}

/** Matière du résultat d'un booléen, en un point. */
function insideOf(op: BoolOp, operands: readonly Operand[]): (p: Vec2) => boolean {
  if (op === 'union') return (p) => operands.some((o) => o.inside(p));
  if (op === 'intersection') return (p) => operands.every((o) => o.inside(p));
  return (p) => operands[0]!.inside(p) && !operands.slice(1).some((o) => o.inside(p));
}

/**
 * Booléen de formes. Différence : la première forme moins toutes les suivantes. Le résultat est
 * lui-même une forme (contour et matière), réutilisable dans un autre booléen.
 */
export function booleanOperand(op: BoolOp, operands: readonly Operand[]): Operand {
  if (operands.length === 0) return { prims: [], inside: () => false };
  const inR = insideOf(op, operands);
  const scale = Math.max(1, ...operands.flatMap((o) => o.prims.map((p) => (p.kind === 'line' ? Math.max(Math.abs(p.a.x), Math.abs(p.a.y)) : Math.abs(p.c.x) + p.r))));
  const h = 1e-5 * scale;
  const kept: Prim[] = [];
  operands.forEach((o, i) => {
    for (const p of o.prims) {
      const cuts: number[] = [];
      operands.forEach((other, j) => {
        for (const q of other.prims) {
          if (j === i && q === p) continue;
          for (const x of meet(p, q)) cuts.push(paramOf(p, x));
        }
      });
      for (const piece of split(p, cuts)) {
        const { m, n } = midAndNormal(piece);
        const left = inR({ x: m.x + n.x * h, y: m.y + n.y * h });
        const right = inR({ x: m.x - n.x * h, y: m.y - n.y * h });
        if (left !== right && !kept.some((k) => samePiece(k, piece))) kept.push({ ...piece, rev: !left });
      }
    }
  });
  return { prims: kept, inside: inR };
}

// ---------------------------------------------------------------------------
// Formes de base

/**
 * Polygone fermé aux coins arrondis : `radius` (un rayon pour tous les coins, ou un par sommet ;
 * 0 = coin vif). Le rayon d'un coin est réduit s'il ne tient pas dans ses deux côtés.
 */
export function roundedPolygon(points: readonly Vec2[], radius: number | readonly number[]): Prim[] {
  const n = points.length;
  const radii = points.map((_, i) => Math.max(0, typeof radius === 'number' ? radius : (radius[i] ?? 0)));
  type Corner = { from: Vec2; to: Vec2; arc?: Prim };
  const corners: Corner[] = points.map((p, i) => {
    const prev = points[(i - 1 + n) % n]!;
    const next = points[(i + 1) % n]!;
    const u = { x: prev.x - p.x, y: prev.y - p.y };
    const v = { x: next.x - p.x, y: next.y - p.y };
    const lu = Math.hypot(u.x, u.y);
    const lv = Math.hypot(v.x, v.y);
    const cos = (u.x * v.x + u.y * v.y) / (lu * lv);
    const half = Math.acos(Math.max(-1, Math.min(1, cos))) / 2;
    if (radii[i]! <= 0 || half < 1e-6 || Math.PI / 2 - half < 1e-6) return { from: p, to: p };
    // Recul du point de tangence, limité à la moitié de chaque côté.
    const back = Math.min(radii[i]! / Math.tan(half), lu / 2, lv / 2);
    const r = back * Math.tan(half);
    const t1 = { x: p.x + (u.x / lu) * back, y: p.y + (u.y / lu) * back };
    const t2 = { x: p.x + (v.x / lv) * back, y: p.y + (v.y / lv) * back };
    const bis = { x: u.x / lu + v.x / lv, y: u.y / lu + v.y / lv };
    const lb = Math.hypot(bis.x, bis.y);
    const dist = r / Math.sin(half);
    const c = { x: p.x + (bis.x / lb) * dist, y: p.y + (bis.y / lb) * dist };
    const a1 = Math.atan2(t1.y - c.y, t1.x - c.x);
    const a2 = Math.atan2(t2.y - c.y, t2.x - c.x);
    // L'arc va de t1 à t2 par le petit côté.
    const ccw = norm(a2 - a1) <= Math.PI;
    return { from: t1, to: t2, arc: ccw ? arcPrim(c, r, a1, a2) : arcPrim(c, r, a2, a1) };
  });
  const out: Prim[] = [];
  corners.forEach((corner, i) => {
    if (corner.arc) out.push(corner.arc);
    const next = corners[(i + 1) % n]!;
    if (Math.hypot(next.from.x - corner.to.x, next.from.y - corner.to.y) > BOOL_TOL) out.push({ kind: 'line', a: corner.to, b: next.from });
  });
  return out;
}

/** Rectangle (coin bas-gauche `at`), coins arrondis de rayon `radius`. */
export function rectanglePrims(at: Vec2, w: number, h: number, radius = 0): Prim[] {
  return roundedPolygon(
    [at, { x: at.x + w, y: at.y }, { x: at.x + w, y: at.y + h }, { x: at.x, y: at.y + h }],
    Math.min(radius, w / 2, h / 2),
  );
}

/** Oblong (trou oblong, rainure) : de `from` à `to` (centres des bouts arrondis), largeur `width`. */
export function slotPrims(from: Vec2, to: Vec2, width: number): Prim[] {
  const r = width / 2;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const l = Math.hypot(dx, dy);
  if (l < BOOL_TOL) return [circlePrim(from, r)];
  const nx = -dy / l;
  const ny = dx / l;
  const ang = Math.atan2(dy, dx);
  return [
    { kind: 'line', a: { x: from.x - nx * r, y: from.y - ny * r }, b: { x: to.x - nx * r, y: to.y - ny * r } },
    arcPrim(to, r, ang - Math.PI / 2, ang + Math.PI / 2),
    { kind: 'line', a: { x: to.x + nx * r, y: to.y + ny * r }, b: { x: from.x + nx * r, y: from.y + ny * r } },
    arcPrim(from, r, ang + Math.PI / 2, ang + (3 * Math.PI) / 2),
  ];
}

/** Sommets d'un polygone régulier inscrit dans un cercle de rayon `radius` (premier sommet à `angle` degrés). */
export function regularPolygonPoints(center: Vec2, sides: number, radius: number, angleDeg = 90): Vec2[] {
  return Array.from({ length: sides }, (_, i) => {
    const a = (angleDeg * Math.PI) / 180 + (i * TAU) / sides;
    return { x: center.x + radius * Math.cos(a), y: center.y + radius * Math.sin(a) };
  });
}

/** Aire de matière d'un résultat de booléen (contours orientés par `rev`), en mm². */
export function primsArea(prims: readonly Prim[]): number {
  let a = 0;
  for (const p of prims) {
    let term: number;
    if (p.kind === 'line') term = (p.a.x * p.b.y - p.b.x * p.a.y) / 2;
    else {
      const s = arcPoint(p, p.a0);
      const e = arcPoint(p, p.a0 + p.sweep);
      // ½∮(x dy − y dx) : corde (qui porte aussi le terme du centre) plus segment circulaire.
      term = isFull(p) ? Math.PI * p.r * p.r : (s.x * e.y - e.x * s.y) / 2 + ((p.r * p.r) / 2) * (p.sweep - Math.sin(p.sweep));
    }
    a += p.rev ? -term : term;
  }
  return a;
}

/** Extrémités d'une courbe (un cercle complet n'en a pas). */
export function primEnds(p: Prim): [Vec2, Vec2] | null {
  if (p.kind === 'line') return [p.a, p.b];
  if (isFull(p)) return null;
  return [arcPoint(p, p.a0), arcPoint(p, p.a0 + p.sweep)];
}
