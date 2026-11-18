/**
 * Accrochages pendant le dessin : origine, points existants, milieux de segments, courbes
 * (segments, cercles, arcs), axes de l'esquisse, alignement
 * horizontal/vertical par rapport au point de départ, grille. Chaque accrochage porte un libellé lisible : l'aide
 * visuelle ne repose pas uniquement sur la couleur.
 */
import { AXIS_X_ID, AXIS_Y_ID, ORIGIN_POINT_ID, type SketchParams } from '../domain/model';
import { TOLERANCES } from '../domain/tolerances';
import { add2, distance2, dot2, midpoint2, scale2, sub2, type Vec2 } from '../math/vec';
import { arcContainsAngle, arcGeometry, ownedPoints, ownerOfPoint, pointPosition } from './model';

export type SnapKind = 'origin' | 'point' | 'center' | 'midpoint' | 'curve' | 'axis' | 'horizontal' | 'vertical' | 'grid' | 'free';

export interface SnapResult {
  point: Vec2;
  kind: SnapKind;
  /** Point existant visé (crée une coïncidence) : identifiant de point ou `origin`. */
  pointId?: string;
  /** Axe de l'esquisse sur lequel le point est posé (crée une contrainte « point sur »). */
  axisId?: string;
  /** Segment, cercle ou arc sur lequel le point est posé (contrainte « point sur »). */
  curveId?: string;
  /** Segment dont le point est le milieu (contrainte « milieu »). */
  midpointOf?: string;
  label: string;
}

export const SNAP_LABELS: Record<SnapKind, string> = {
  origin: 'Origine',
  point: 'Extrémité',
  center: 'Centre',
  midpoint: 'Milieu',
  curve: 'Sur la courbe',
  axis: 'Axe',
  horizontal: 'Horizontal',
  vertical: 'Vertical',
  grid: 'Grille',
  free: '',
};

export interface SnapOptions {
  /** Tolérance d'accrochage en mm (≈ 10 pixels à l'écran). */
  tolerance: number;
  gridStep: number;
  snapToGrid: boolean;
  /** Point de départ du tracé en cours (pour l'alignement horizontal / vertical). */
  reference?: Vec2;
  /** Points à ignorer (ex. ceux du segment en cours de déplacement). */
  exclude?: ReadonlySet<string>;
  /** Désactive tous les accrochages (touche Alt maintenue). */
  disabled?: boolean;
  /** Accrochage aux objets (points, milieux, courbes, axes) ; vrai par défaut. */
  objects?: boolean;
}

const roundTo = (v: number, step: number) => Math.round(v / step) * step;
const cleanZero = (v: number) => (Math.abs(v) < 1e-12 ? 0 : v);
const originSnap = (): SnapResult => ({ point: { x: 0, y: 0 }, kind: 'origin', pointId: ORIGIN_POINT_ID, label: SNAP_LABELS.origin });

/** Le point `p` est-il sur l'axe `axisId` ? */
const isOnAxis = (p: Vec2, axisId: string) => Math.abs(axisId === AXIS_X_ID ? p.y : p.x) < 1e-9;

/** Axe que rejoint le point : celui visé par le curseur, sinon celui où l'alignement ou la grille l'ont amené. */
function targetAxis(p: Vec2, cursor: Vec2, tol: number): string | undefined {
  const toX = Math.abs(cursor.y);
  const toY = Math.abs(cursor.x);
  if (toX <= tol && (toY > tol || toX <= toY)) return AXIS_X_ID;
  if (toY <= tol) return AXIS_Y_ID;
  if (isOnAxis(p, AXIS_X_ID)) return AXIS_X_ID;
  return isOnAxis(p, AXIS_Y_ID) ? AXIS_Y_ID : undefined;
}

export function snapPoint(sketch: SketchParams, cursor: Vec2, options: SnapOptions): SnapResult {
  if (options.disabled) return { point: cursor, kind: 'free', label: '' };
  const tol = options.tolerance;
  const objects = options.objects !== false;

  // 1. Objets du dessin.
  if (objects) {
    const hit = objectSnap(sketch, cursor, options);
    if (hit) return hit;
  }

  // 2. Alignement horizontal / vertical avec le point de départ.
  const ref = options.reference;
  let p = { ...cursor };
  let kind: SnapKind = 'free';
  if (ref) {
    const dx = cursor.x - ref.x;
    const dy = cursor.y - ref.y;
    const len = Math.hypot(dx, dy);
    if (len > tol) {
      const angle = (Math.atan2(Math.abs(dy), Math.abs(dx)) * 180) / Math.PI;
      if (angle < TOLERANCES.inferenceAngleDeg) {
        p = { x: cursor.x, y: ref.y };
        kind = 'horizontal';
      } else if (angle > 90 - TOLERANCES.inferenceAngleDeg) {
        p = { x: ref.x, y: cursor.y };
        kind = 'vertical';
      }
    }
  }

  // 3. Grille (sur l'axe libre seulement si un alignement est actif).
  if (options.snapToGrid && options.gridStep > 0) {
    const g = options.gridStep;
    if (kind === 'horizontal') p = { x: cleanZero(roundTo(p.x, g)), y: p.y };
    else if (kind === 'vertical') p = { x: p.x, y: cleanZero(roundTo(p.y, g)) };
    else {
      p = { x: cleanZero(roundTo(p.x, g)), y: cleanZero(roundTo(p.y, g)) };
      kind = 'grid';
    }
  }

  // 4. Axes de l'esquisse : le point s'y pose sur le lieu de l'alignement ou de la grille.
  const axisId = objects ? targetAxis(p, cursor, tol) : undefined;
  if (!axisId) return { point: p, kind, label: SNAP_LABELS[kind] };
  const onX = axisId === AXIS_X_ID;
  const point = onX ? { x: cleanZero(p.x), y: 0 } : { x: 0, y: cleanZero(p.y) };
  if (point.x === 0 && point.y === 0 && !options.exclude?.has(ORIGIN_POINT_ID)) return originSnap();
  // Départ déjà sur cet axe : le tracé le suit, l'alignement suffit à y rester.
  const along: SnapKind = onX ? 'horizontal' : 'vertical';
  if (ref && isOnAxis(ref, axisId)) return { point, kind: along, label: SNAP_LABELS[along] };
  const axisLabel = `${SNAP_LABELS.axis} ${onX ? 'X' : 'Y'}`;
  // Un alignement perpendiculaire à l'axe reste valable ; parallèle, l'axe le remplace.
  if (kind === (onX ? 'vertical' : 'horizontal')) return { point, kind, axisId, label: `${SNAP_LABELS[kind]} · ${axisLabel}` };
  return { point, kind: 'axis', axisId, label: axisLabel };
}

/**
 * Accrochage aux objets du dessin : origine et points (le plus proche), sinon milieu d'un segment,
 * sinon point le plus proche sur un segment, un cercle ou un arc.
 */
function objectSnap(sketch: SketchParams, cursor: Vec2, options: SnapOptions): SnapResult | null {
  const tol = options.tolerance;
  let best: SnapResult | null = null;
  let bestDist = tol;
  if (!options.exclude?.has(ORIGIN_POINT_ID) && distance2(cursor, originSnap().point) <= bestDist) {
    best = originSnap();
    bestDist = distance2(cursor, best.point);
  }
  for (const e of sketch.entities) {
    if (e.type !== 'point' || options.exclude?.has(e.id)) continue;
    const d = distance2(cursor, e);
    if (d < bestDist - 1e-12) {
      const owner = ownerOfPoint(sketch, e.id);
      // Une poignée de tangence n'est pas un point du dessin.
      if (owner?.type === 'spline' && !owner.points.includes(e.id)) continue;
      const kind: SnapKind = owner?.type === 'circle' || ((owner?.type === 'arc' || owner?.type === 'ellipse') && owner.center === e.id) ? 'center' : 'point';
      best = { point: { x: e.x, y: e.y }, kind, pointId: e.id, label: SNAP_LABELS[kind] };
      bestDist = d;
    }
  }
  if (best) return best;

  // Courbes qui bougent avec le point déplacé : pas d'accrochage sur elles-mêmes.
  const usable = sketch.entities.filter((e) => (e.type === 'line' || e.type === 'circle' || e.type === 'arc') && !ownedPoints(e).some((id) => options.exclude?.has(id)));
  for (const e of usable) {
    if (e.type !== 'line') continue;
    const a = pointPosition(sketch, e.a);
    const b = pointPosition(sketch, e.b);
    if (!a || !b) continue;
    const m = midpoint2(a, b);
    const d = distance2(cursor, m);
    if (d < bestDist) {
      best = { point: m, kind: 'midpoint', midpointOf: e.id, label: SNAP_LABELS.midpoint };
      bestDist = d;
    }
  }
  if (best) return best;

  for (const e of usable) {
    let q: Vec2 | undefined;
    if (e.type === 'line') {
      const a = pointPosition(sketch, e.a);
      const b = pointPosition(sketch, e.b);
      if (!a || !b) continue;
      const ab = sub2(b, a);
      const len2 = dot2(ab, ab);
      if (len2 < 1e-18) continue;
      const t = Math.min(1, Math.max(0, dot2(sub2(cursor, a), ab) / len2));
      q = add2(a, scale2(ab, t));
    } else if (e.type === 'circle') {
      const c = pointPosition(sketch, e.center);
      const d = c && distance2(cursor, c);
      if (!c || !d || d < 1e-12) continue;
      q = add2(c, scale2(sub2(cursor, c), e.radius / d));
    } else if (e.type === 'arc') {
      const g = arcGeometry(sketch, e);
      const d = g && distance2(cursor, g.center);
      if (!g || !d || d < 1e-12) continue;
      const on = add2(g.center, scale2(sub2(cursor, g.center), g.radius / d));
      if (!arcContainsAngle(g, on)) continue;
      q = on;
    }
    if (!q) continue;
    const d = distance2(cursor, q);
    if (d < bestDist) {
      best = { point: q, kind: 'curve', curveId: e.id, label: SNAP_LABELS.curve };
      bestDist = d;
    }
  }
  return best;
}

/** Pas de grille adapté au zoom : le plus petit pas qui laisse au moins `minPixels` entre deux lignes. */
export function gridStepFor(pixelSize: number, minPixels = 14): number {
  const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
  for (const s of steps) if (s / pixelSize >= minPixels) return s;
  return steps[steps.length - 1]!;
}
