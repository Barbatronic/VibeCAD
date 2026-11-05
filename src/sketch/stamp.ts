/**
 * Tampon de l'esquisse (calcul pur) : une forme vectorielle posée en un seul élément, comme un
 * texte. Son contour est enregistré dans l'esquisse (le projet reste complet sans la galerie).
 *
 * Contour normalisé : texte « M x y L x y C x y x y x y Z », y vers le haut, centré sur (0, 0), le
 * plus grand côté de sa boîte englobante valant 1. C'est aussi un tracé SVG valide (vignettes).
 * Chaque morceau reçoit un identifiant stable « <tampon>:0.<contour>.<morceau> » qui nomme la face
 * latérale qu'il engendre.
 */
import type { SketchParams, SketchStamp, SketchText } from '../domain/model';
import type { Vec2 } from '../math/vec';
import { pointPosition } from './model';
import { textContours, textFrame, type TextContour, type TextPiece } from './text';

/** Forme d'un tampon : son nom lisible et son contour normalisé. */
export interface StampShape {
  name: string;
  outline: string;
}

type OutlineCmd = { kind: 'L'; to: Vec2 } | { kind: 'C'; c1: Vec2; c2: Vec2; to: Vec2 };
interface OutlineContour {
  start: Vec2;
  cmds: OutlineCmd[];
}
interface ParsedOutline {
  contours: OutlineContour[];
  box: { lo: Vec2; hi: Vec2 };
}

const parsed = new Map<string, ParsedOutline | null>();

function readOutline(outline: string): ParsedOutline | null {
  const tokens = outline.trim().split(/\s+/);
  const contours: OutlineContour[] = [];
  let i = 0;
  const pt = (): Vec2 | null => {
    const x = Number(tokens[i++]);
    const y = Number(tokens[i++]);
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
  };
  let current: OutlineContour | null = null;
  while (i < tokens.length) {
    const op = tokens[i++];
    if (op === 'M') {
      const start = pt();
      if (!start) return null;
      current = { start, cmds: [] };
      contours.push(current);
    } else if (op === 'Z' && current) {
      current = null;
    } else if (op === 'L' && current) {
      const to = pt();
      if (!to) return null;
      current.cmds.push({ kind: 'L', to });
    } else if (op === 'C' && current) {
      const c1 = pt();
      const c2 = pt();
      const to = pt();
      if (!c1 || !c2 || !to) return null;
      current.cmds.push({ kind: 'C', c1, c2, to });
    } else return null;
  }
  if (current || contours.length === 0 || contours.some((c) => c.cmds.length === 0)) return null;
  const all = contours.flatMap((c) => [c.start, ...c.cmds.flatMap((m) => (m.kind === 'L' ? [m.to] : [m.c1, m.c2, m.to]))]);
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y);
  return { contours, box: { lo: { x: Math.min(...xs), y: Math.min(...ys) }, hi: { x: Math.max(...xs), y: Math.max(...ys) } } };
}

function parseOutline(outline: string): ParsedOutline | null {
  if (!parsed.has(outline)) parsed.set(outline, readOutline(outline));
  return parsed.get(outline)!;
}

/** Le texte est-il un contour de tampon lisible ? */
export const isValidOutline = (outline: string) => parseOutline(outline) !== null;

/** Contours d'un tampon de taille `size` (mm) centré sur `anchor` et tourné de `angleDeg`. */
export function layoutStamp(outline: string, anchor: Vec2, size: number, angleDeg = 0, idPrefix = 'st'): TextContour[] {
  const shape = parseOutline(outline);
  if (!shape) return [];
  const a = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const place = (q: Vec2): Vec2 => ({ x: anchor.x + size * (q.x * cos - q.y * sin), y: anchor.y + size * (q.x * sin + q.y * cos) });
  return shape.contours.map((c, ci) => {
    let from = place(c.start);
    const first = from;
    const pieces: TextPiece[] = c.cmds.map((cmd, si) => {
      const id = `${idPrefix}:0.${ci}.${si}`;
      const to = place(cmd.to);
      const piece: TextPiece = cmd.kind === 'L' ? { kind: 'line', id, start: from, end: to } : { kind: 'bezier', id, bezier: [from, place(cmd.c1), place(cmd.c2), to] };
      from = to;
      return piece;
    });
    if (Math.hypot(from.x - first.x, from.y - first.y) > 1e-9) pieces.push({ kind: 'line', id: `${idPrefix}:0.${ci}.${c.cmds.length}`, start: from, end: first });
    return { pieces };
  });
}

/** Contours d'un élément à contours calculés (texte ou tampon) ; vide si son ancrage manque. */
export function outlineContours(sketch: SketchParams, e: SketchText | SketchStamp): TextContour[] {
  if (e.type === 'text') return textContours(sketch, e);
  const anchor = pointPosition(sketch, e.anchor);
  if (!anchor || !(e.size > 0)) return [];
  return layoutStamp(e.outline, anchor, e.size, e.angle ?? 0, e.id);
}

/** Quatre coins du cadre d'un texte ou d'un tampon, dans l'ordre trigonométrique. */
export function outlineFrame(sketch: SketchParams, e: SketchText | SketchStamp): Vec2[] | undefined {
  if (e.type === 'text') return textFrame(sketch, e);
  const anchor = pointPosition(sketch, e.anchor);
  const shape = parseOutline(e.outline);
  if (!anchor || !shape) return undefined;
  const a = ((e.angle ?? 0) * Math.PI) / 180;
  const u = { x: Math.cos(a) * e.size, y: Math.sin(a) * e.size };
  const v = { x: -u.y, y: u.x };
  const at = (x: number, y: number): Vec2 => ({ x: anchor.x + u.x * x + v.x * y, y: anchor.y + u.y * x + v.y * y });
  const { lo, hi } = shape.box;
  return [at(lo.x, lo.y), at(hi.x, lo.y), at(hi.x, hi.y), at(lo.x, hi.y)];
}
