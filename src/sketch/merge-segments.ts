/**
 * Réunit, dans un contour, les segments alignés qui se suivent et les arcs consécutifs d'un même
 * cercle (même centre, même rayon, même sens) : un côté dessiné en plusieurs traits donne une
 * seule face, sans arête inutile au milieu. Chaque morceau réuni garde la liste des éléments
 * d'esquisse qu'il remplace (les faces portent l'étiquette de chacun).
 */
import type { Vec2 } from '../math/vec';
import type { ProfileSegment } from './profiles';

export interface MergedSegment {
  segment: ProfileSegment;
  /** Éléments d'esquisse réunis dans ce morceau (le premier est celui du segment). */
  entityIds: string[];
}

const EPS = 1e-9;

function sweep(s: Extract<ProfileSegment, { kind: 'arc' }>): number {
  const a0 = Math.atan2(s.start.y - s.center.y, s.start.x - s.center.x);
  const a1 = Math.atan2(s.end.y - s.center.y, s.end.x - s.center.x);
  let d = a1 - a0;
  if (s.clockwise) while (d >= -EPS) d -= Math.PI * 2;
  else while (d <= EPS) d += Math.PI * 2;
  return Math.abs(d);
}

const close = (a: Vec2, b: Vec2, scale: number) => Math.hypot(a.x - b.x, a.y - b.y) <= EPS * Math.max(1, scale);

/** `b` prolonge `a` sans changer de courbe : renvoie le morceau réuni, sinon null. */
function join(a: ProfileSegment, b: ProfileSegment): ProfileSegment | null {
  if (a.kind === 'line' && b.kind === 'line') {
    const u = { x: a.end.x - a.start.x, y: a.end.y - a.start.y };
    const v = { x: b.end.x - b.start.x, y: b.end.y - b.start.y };
    const lu = Math.hypot(u.x, u.y);
    const lv = Math.hypot(v.x, v.y);
    if (lu < EPS || lv < EPS || !close(a.end, b.start, lu + lv)) return null;
    const cross = (u.x * v.y - u.y * v.x) / (lu * lv);
    const dot = (u.x * v.x + u.y * v.y) / (lu * lv);
    return Math.abs(cross) < 1e-9 && dot > 0 ? { ...a, end: b.end } : null;
  }
  if (a.kind === 'arc' && b.kind === 'arc') {
    if (a.clockwise !== b.clockwise || !close(a.center, b.center, a.radius) || Math.abs(a.radius - b.radius) > EPS * Math.max(1, a.radius) || !close(a.end, b.start, a.radius)) return null;
    // Un arc réuni doit rester plus court qu'un tour complet.
    if (sweep(a) + sweep(b) >= Math.PI * 2 - 1e-6) return null;
    return { ...a, end: b.end };
  }
  return null;
}

export function mergeAlignedSegments(segments: readonly ProfileSegment[], closed: boolean): MergedSegment[] {
  const out: MergedSegment[] = [];
  for (const s of segments) {
    const last = out[out.length - 1];
    const joined = last ? join(last.segment, s) : null;
    if (last && joined) {
      last.segment = joined;
      last.entityIds.push(s.entityId);
    } else out.push({ segment: s, entityIds: [s.entityId] });
  }
  // Contour fermé : le dernier morceau peut prolonger le premier.
  if (closed && out.length > 2) {
    const first = out[0]!;
    const last = out[out.length - 1]!;
    const joined = join(last.segment, first.segment);
    if (joined) {
      out.pop();
      out[0] = { segment: joined, entityIds: [...last.entityIds, ...first.entityIds] };
    }
  }
  return out;
}
