/**
 * Point où une spline touche une autre courbe : c'est là que se pose une tangence avec elle.
 * Utilisé par le solveur et par l'outil Tangence (aucune dépendance au reste de l'esquisse).
 */
import type { SketchConstraint, SketchParams } from '../domain/model';

export interface SplineContact {
  /** Point de passage de la spline au contact. */
  point: string;
  /** Pour deux splines : point de passage de l'autre spline au contact. */
  otherPoint?: string;
}

/** Représentant du groupe de points confondus (coïncidences) de chaque point. */
export function coincidenceRoots(constraints: readonly SketchConstraint[]): (id: string) => string {
  const parent = new Map<string, string>();
  const root = (x: string): string => {
    let r = x;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  for (const c of constraints) {
    if (c.type !== 'coincident') continue;
    const ra = root(c.a);
    const rb = root(c.b);
    if (ra !== rb) parent.set(ra, rb);
  }
  return root;
}

/**
 * Contact de la spline `splineId` avec la courbe `otherId` : un point de passage confondu avec
 * une extrémité de l'autre courbe (ou un point de l'autre spline), ou posé sur elle.
 */
export function splineContact(sketch: SketchParams, constraints: readonly SketchConstraint[], splineId: string, otherId: string, root = coincidenceRoots(constraints)): SplineContact | null {
  const spline = sketch.entities.find((e) => e.id === splineId);
  const other = sketch.entities.find((e) => e.id === otherId);
  if (spline?.type !== 'spline' || !other || other.id === spline.id) return null;
  const ends = other.type === 'line' ? [other.a, other.b] : other.type === 'arc' ? [other.start, other.end] : other.type === 'spline' ? other.points : [];
  // Les extrémités d'une spline ouverte d'abord : c'est là que se raccordent les courbes.
  const order = spline.closed ? spline.points : [spline.points[0]!, spline.points[spline.points.length - 1]!, ...spline.points.slice(1, -1)];
  for (const p of order) {
    const shared = ends.find((e) => root(e) === root(p));
    if (shared) return other.type === 'spline' ? { point: p, otherPoint: shared } : { point: p };
    if (other.type !== 'spline' && constraints.some((k) => k.type === 'pointOn' && k.curve === otherId && root(k.point) === root(p))) return { point: p };
  }
  return null;
}
