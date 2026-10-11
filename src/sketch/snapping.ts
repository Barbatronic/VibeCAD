/**
 * Accrochages pendant le dessin : origine, points existants, alignement horizontal/vertical
 * par rapport au point de départ, grille. Chaque accrochage porte un libellé lisible : l'aide
 * visuelle ne repose pas uniquement sur la couleur.
 */
import { ORIGIN_POINT_ID, type SketchParams } from '../domain/model';
import { TOLERANCES } from '../domain/tolerances';
import { distance2, type Vec2 } from '../math/vec';
import { ownerOfPoint } from './model';

export type SnapKind = 'origin' | 'point' | 'center' | 'horizontal' | 'vertical' | 'grid' | 'free';

export interface SnapResult {
  point: Vec2;
  kind: SnapKind;
  /** Point existant visé (crée une coïncidence) : identifiant de point ou `origin`. */
  pointId?: string;
  label: string;
}

export const SNAP_LABELS: Record<SnapKind, string> = {
  origin: 'Origine',
  point: 'Extrémité',
  center: 'Centre',
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
}

const roundTo = (v: number, step: number) => Math.round(v / step) * step;
const cleanZero = (v: number) => (Math.abs(v) < 1e-12 ? 0 : v);

export function snapPoint(sketch: SketchParams, cursor: Vec2, options: SnapOptions): SnapResult {
  if (options.disabled) return { point: cursor, kind: 'free', label: '' };
  const tol = options.tolerance;

  // 1. Origine et points existants (le plus proche gagne).
  let best: SnapResult | null = null;
  let bestDist = tol;
  const origin = { x: 0, y: 0 };
  if (!options.exclude?.has(ORIGIN_POINT_ID) && distance2(cursor, origin) <= bestDist) {
    best = { point: origin, kind: 'origin', pointId: ORIGIN_POINT_ID, label: SNAP_LABELS.origin };
    bestDist = distance2(cursor, origin);
  }
  for (const e of sketch.entities) {
    if (e.type !== 'point' || options.exclude?.has(e.id)) continue;
    const d = distance2(cursor, e);
    if (d < bestDist - 1e-12) {
      const owner = ownerOfPoint(sketch, e.id);
      const kind: SnapKind = owner?.type === 'circle' || ((owner?.type === 'arc' || owner?.type === 'ellipse') && owner.center === e.id) ? 'center' : 'point';
      best = { point: { x: e.x, y: e.y }, kind, pointId: e.id, label: SNAP_LABELS[kind] };
      bestDist = d;
    }
  }
  if (best) return best;

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
  return { point: p, kind, label: SNAP_LABELS[kind] };
}

/** Pas de grille adapté au zoom : le plus petit pas qui laisse au moins `minPixels` entre deux lignes. */
export function gridStepFor(pixelSize: number, minPixels = 14): number {
  const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
  for (const s of steps) if (s / pixelSize >= minPixels) return s;
  return steps[steps.length - 1]!;
}
