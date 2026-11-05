/**
 * Texte de l'esquisse (calcul pur) : contours des lettres placés au point d'ancrage, à la hauteur
 * et à l'inclinaison demandées.
 *
 * Les lettres viennent de font-data.ts (courbes quadratiques de la police). Chaque courbe
 * quadratique est écrite exactement comme une Bézier cubique : le noyau construit donc la même
 * forme que celle affichée. Chaque morceau reçoit un identifiant stable
 * « <texte>:<lettre>.<contour>.<morceau> » qui nomme la face latérale qu'il engendre.
 */
import type { SketchParams, SketchText } from '../domain/model';
import type { Vec2 } from '../math/vec';
import type { Bezier } from './curves';
import { FONT_CAP_HEIGHT, FONT_GLYPHS } from './font-data';
import { pointPosition } from './model';

/** Morceau d'un contour de lettre, dans le sens de la police. */
export type TextPiece = { kind: 'line'; id: string; start: Vec2; end: Vec2 } | { kind: 'bezier'; id: string; bezier: Bezier };

/** Contour fermé d'une lettre. */
export interface TextContour {
  pieces: TextPiece[];
}

/** Caractères disponibles (les autres sont remplacés par « ? »). */
export function isSupportedChar(ch: string): boolean {
  return ch in FONT_GLYPHS;
}

/** Caractères du texte qui ne sont pas dans la police (sans doublons). */
export function unsupportedChars(text: string): string[] {
  return [...new Set([...text].filter((ch) => !isSupportedChar(ch)))];
}

type Path = { advance: number; contours: { start: Vec2; cmds: ({ kind: 'L'; to: Vec2 } | { kind: 'Q'; c: Vec2; to: Vec2 })[] }[] };
const parsed = new Map<string, Path>();

function glyph(ch: string): Path {
  const key = isSupportedChar(ch) ? ch : '?';
  const hit = parsed.get(key);
  if (hit) return hit;
  const [advance, ...contours] = FONT_GLYPHS[key]!;
  const out: Path = { advance, contours: [] };
  for (const d of contours) {
    const nums = d.match(/[MLQ]|-?\d+/g)!;
    let i = 0;
    const pt = (): Vec2 => ({ x: Number(nums[i++]), y: Number(nums[i++]) });
    let start: Vec2 = { x: 0, y: 0 };
    const cmds: Path['contours'][number]['cmds'] = [];
    while (i < nums.length) {
      const op = nums[i++];
      if (op === 'M') start = pt();
      else if (op === 'L') cmds.push({ kind: 'L', to: pt() });
      else {
        const c = pt();
        cmds.push({ kind: 'Q', c, to: pt() });
      }
    }
    out.contours.push({ start, cmds });
  }
  parsed.set(key, out);
  return out;
}

/** Longueur de la ligne de texte (mm) pour une hauteur de majuscules `height`. */
export function textWidth(text: string, height: number): number {
  const k = height / FONT_CAP_HEIGHT;
  return [...text].reduce((w, ch) => w + glyph(ch).advance * k, 0);
}

/** Contours d'un texte posé en `anchor` (mm, repère de l'esquisse). */
export function layoutText(text: string, anchor: Vec2, height: number, angleDeg = 0, idPrefix = 't'): TextContour[] {
  const k = height / FONT_CAP_HEIGHT;
  const a = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const out: TextContour[] = [];
  let pen = 0;
  [...text].forEach((ch, gi) => {
    const g = glyph(ch);
    const place = (q: Vec2): Vec2 => {
      const x = (pen + q.x) * k;
      const y = q.y * k;
      return { x: anchor.x + x * cos - y * sin, y: anchor.y + x * sin + y * cos };
    };
    g.contours.forEach((c, ci) => {
      let from = place(c.start);
      const pieces: TextPiece[] = [];
      c.cmds.forEach((cmd, si) => {
        const id = `${idPrefix}:${gi}.${ci}.${si}`;
        const to = place(cmd.to);
        if (cmd.kind === 'L') pieces.push({ kind: 'line', id, start: from, end: to });
        else {
          // Quadratique → cubique exacte : contrôles aux deux tiers vers le point de contrôle.
          const q = place(cmd.c);
          const c1 = { x: from.x + (2 / 3) * (q.x - from.x), y: from.y + (2 / 3) * (q.y - from.y) };
          const c2 = { x: to.x + (2 / 3) * (q.x - to.x), y: to.y + (2 / 3) * (q.y - to.y) };
          pieces.push({ kind: 'bezier', id, bezier: [from, c1, c2, to] });
        }
        from = to;
      });
      // Fermeture implicite du contour par un trait droit.
      const first = place(c.start);
      if (Math.hypot(from.x - first.x, from.y - first.y) > 1e-9) pieces.push({ kind: 'line', id: `${idPrefix}:${gi}.${ci}.${c.cmds.length}`, start: from, end: first });
      if (pieces.length > 0) out.push({ pieces });
    });
    pen += g.advance;
  });
  return out;
}

/** Contours d'un texte de l'esquisse ; vide si son ancrage manque. */
export function textContours(sketch: SketchParams, e: SketchText): TextContour[] {
  const anchor = pointPosition(sketch, e.anchor);
  if (!anchor || !(e.height > 0)) return [];
  return layoutText(e.text, anchor, e.height, e.angle ?? 0, e.id);
}

/** Quatre coins du cadre du texte (ligne de base → hauteur des majuscules), dans l'ordre trigonométrique. */
export function textFrame(sketch: SketchParams, e: SketchText): Vec2[] | undefined {
  const anchor = pointPosition(sketch, e.anchor);
  if (!anchor) return undefined;
  const w = Math.max(textWidth(e.text, e.height), e.height * 0.5);
  const a = ((e.angle ?? 0) * Math.PI) / 180;
  const u = { x: Math.cos(a), y: Math.sin(a) };
  const v = { x: -u.y, y: u.x };
  const at = (x: number, y: number): Vec2 => ({ x: anchor.x + u.x * x + v.x * y, y: anchor.y + u.y * x + v.y * y });
  // Les jambages (p, g) descendent sous la ligne de base : le cadre en tient compte.
  const low = -0.3 * e.height;
  const high = 1.05 * e.height;
  return [at(0, low), at(w, low), at(w, high), at(0, high)];
}

/** Polyligne fine d'un contour (pour l'affichage et les tests de position). */
export function contourPolyline(c: TextContour, perBezier = 6): Vec2[] {
  const out: Vec2[] = [];
  for (const p of c.pieces) {
    if (p.kind === 'line') out.push(p.start);
    else {
      const [p0, p1, p2, p3] = p.bezier;
      for (let i = 0; i < perBezier; i++) {
        const t = i / perBezier;
        const u = 1 - t;
        out.push({
          x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
          y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
        });
      }
    }
  }
  return out;
}
