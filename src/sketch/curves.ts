/**
 * Ellipses et splines de l'esquisse (calcul pur).
 *
 * - Ellipse : un centre, un point au bout du grand axe (il donne le rayon et l'orientation) et un
 *   petit rayon.
 * - Spline : courbe lisse qui passe par une suite de points (Catmull-Rom uniforme), ouverte ou
 *   fermée. Elle est définie comme une suite de courbes de Bézier cubiques, construites telles
 *   quelles par le noyau : la courbe affichée et celle du volume sont la même.
 */
import { add2, scale2, sub2, type Vec2 } from '../math/vec';

/** Courbe de Bézier cubique : départ, deux points de contrôle, arrivée. */
export type Bezier = [Vec2, Vec2, Vec2, Vec2];

/** Morceaux de Bézier d'une spline passant par `pts` (au moins 2 points). */
export function splineBeziers(pts: readonly Vec2[], closed: boolean): Bezier[] {
  const n = pts.length;
  if (n < 2) return [];
  const at = (i: number): Vec2 => {
    if (closed) return pts[((i % n) + n) % n]!;
    // Extrémités d'une spline ouverte : point fantôme dans le prolongement (tangente naturelle).
    if (i < 0) return sub2(scale2(pts[0]!, 2), pts[1]!);
    if (i >= n) return sub2(scale2(pts[n - 1]!, 2), pts[n - 2]!);
    return pts[i]!;
  };
  const out: Bezier[] = [];
  const count = closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const p0 = at(i);
    const p1 = at(i + 1);
    const c1 = add2(p0, scale2(sub2(p1, at(i - 1)), 1 / 6));
    const c2 = sub2(p1, scale2(sub2(at(i + 2), p0), 1 / 6));
    out.push([p0, c1, c2, p1]);
  }
  return out;
}

export function bezierPoint(b: Bezier, t: number): Vec2 {
  const u = 1 - t;
  const w0 = u * u * u;
  const w1 = 3 * u * u * t;
  const w2 = 3 * u * t * t;
  const w3 = t * t * t;
  return { x: w0 * b[0].x + w1 * b[1].x + w2 * b[2].x + w3 * b[3].x, y: w0 * b[0].y + w1 * b[1].y + w2 * b[2].y + w3 * b[3].y };
}

/** Points le long des morceaux (le tout premier compris si `withStart`). */
export function sampleBeziers(beziers: readonly Bezier[], perSegment = 24, withStart = true): Vec2[] {
  const out: Vec2[] = [];
  beziers.forEach((b, k) => {
    for (let i = k === 0 && withStart ? 0 : 1; i <= perSegment; i++) out.push(bezierPoint(b, i / perSegment));
  });
  return out;
}

export function reverseBeziers(beziers: readonly Bezier[]): Bezier[] {
  return [...beziers].reverse().map((b) => [b[3], b[2], b[1], b[0]] as Bezier);
}

/** Ellipse : centre, demi-axes et angle du grand axe (le « grand » axe peut être le plus court). */
export interface EllipseGeometry {
  center: Vec2;
  /** Demi-axe dirigé vers le point du grand axe. */
  a: number;
  /** Demi-axe perpendiculaire (le petit rayon). */
  b: number;
  angle: number;
}

export function ellipseGeometry(center: Vec2, majorEnd: Vec2, minorRadius: number): EllipseGeometry {
  const d = sub2(majorEnd, center);
  return { center, a: Math.hypot(d.x, d.y), b: minorRadius, angle: Math.atan2(d.y, d.x) };
}

export function ellipsePoint(g: EllipseGeometry, t: number): Vec2 {
  const c = Math.cos(g.angle);
  const s = Math.sin(g.angle);
  const x = g.a * Math.cos(t);
  const y = g.b * Math.sin(t);
  return { x: g.center.x + x * c - y * s, y: g.center.y + x * s + y * c };
}

export function sampleEllipse(g: EllipseGeometry, n = 96): Vec2[] {
  return Array.from({ length: n }, (_, i) => ellipsePoint(g, (2 * Math.PI * i) / n));
}

/** Aire signée d'une polyligne fermée. */
export function polylineArea(pts: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}
