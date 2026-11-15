/**
 * Lecture d'un fichier DXF (texte) en forme de tampon, à l'échelle : lignes, cercles, arcs,
 * polylignes (avec leurs arrondis), ellipses et splines de la section ENTITIES. Les éléments qui
 * se suivent bout à bout sont réunis en contours : un contour refermé donne une surface.
 *
 * Le dessin est d'abord réécrit en SVG, puis lu par le lecteur de SVG : mêmes contrôles (formes
 * qui se chevauchent, tracés ouverts, trop de détails) et même contour normalisé.
 */
import type { Vec2 } from '../math/vec';
import { importSvgShape, type SvgImportResult } from './svg-import';

type Segment = { a: Vec2; b: Vec2; arc?: { r: number; large: boolean; ccw: boolean } };
type Pair = [number, string];

/** Unités du fichier ($INSUNITS) en millimètres ; inconnue ou absente : le millimètre. */
const UNIT_MM: Record<number, number> = { 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000 };

/** Écart (dans l'unité du fichier) sous lequel deux extrémités sont le même point. */
const JOIN = 1e-3;

export type DxfImportResult = SvgImportResult & { /** Plus grand côté du dessin (mm), pour le poser à l'échelle. */ size?: number };

function pairs(text: string): Pair[] {
  const lines = text.split(/\r\n|\r|\n/);
  const out: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i]!.trim());
    if (Number.isInteger(code)) out.push([code, lines[i + 1]!.trim()]);
  }
  return out;
}

const polar = (c: Vec2, r: number, deg: number): Vec2 => ({ x: c.x + r * Math.cos((deg * Math.PI) / 180), y: c.y + r * Math.sin((deg * Math.PI) / 180) });

/** Arc d'un sommet de polyligne au suivant : `bulge` = tan(angle / 4), positif dans le sens trigonométrique. */
function bulged(a: Vec2, b: Vec2, bulge: number): Segment {
  if (Math.abs(bulge) < 1e-9) return { a, b };
  const angle = 4 * Math.atan(Math.abs(bulge));
  const chord = Math.hypot(b.x - a.x, b.y - a.y);
  return { a, b, arc: { r: chord / (2 * Math.sin(angle / 2)), large: angle > Math.PI, ccw: bulge > 0 } };
}

/** Courbe B-spline (algorithme de De Boor) échantillonnée en ligne brisée. */
function splinePoints(degree: number, knots: number[], control: Vec2[]): Vec2[] {
  const n = control.length;
  if (n < 2) return [];
  if (knots.length !== n + degree + 1 || degree < 1) return control;
  const lo = knots[degree]!;
  const hi = knots[n]!;
  const samples = Math.max(16, 8 * n);
  const out: Vec2[] = [];
  for (let s = 0; s <= samples; s++) {
    const t = Math.min(hi - 1e-9 * Math.abs(hi - lo), lo + ((hi - lo) * s) / samples);
    let k = degree;
    while (k < n - 1 && knots[k + 1]! <= t) k++;
    const d = Array.from({ length: degree + 1 }, (_, j) => ({ ...control[j + k - degree]! }));
    for (let r = 1; r <= degree; r++) {
      for (let j = degree; j >= r; j--) {
        const i = j + k - degree;
        const span = knots[i + degree - r + 1]! - knots[i]!;
        const alpha = span > 0 ? (t - knots[i]!) / span : 0;
        d[j] = { x: (1 - alpha) * d[j - 1]!.x + alpha * d[j]!.x, y: (1 - alpha) * d[j - 1]!.y + alpha * d[j]!.y };
      }
    }
    out.push(d[degree]!);
  }
  out[out.length - 1] = { ...control[n - 1]! };
  return out;
}

/** Éléments du dessin, en segments (droites et arcs de cercle), et ce qui a été laissé de côté. */
function readEntities(all: Pair[]): { segments: Segment[]; circles: { c: Vec2; r: number }[]; skipped: Set<string>; unit: number } {
  let unit = 1;
  for (let i = 0; i + 1 < all.length; i++) if (all[i]![0] === 9 && all[i]![1] === '$INSUNITS' && all[i + 1]![0] === 70) unit = UNIT_MM[Number(all[i + 1]![1])] ?? 1;
  const start = all.findIndex((p, i) => p[0] === 2 && p[1] === 'ENTITIES' && all[i - 1]?.[0] === 0 && all[i - 1]?.[1] === 'SECTION');
  const segments: Segment[] = [];
  const circles: { c: Vec2; r: number }[] = [];
  const skipped = new Set<string>();
  if (start < 0) return { segments, circles, skipped, unit };
  // Découpage en entités : chaque code 0 en ouvre une.
  const entities: { type: string; data: Pair[] }[] = [];
  for (let i = start + 1; i < all.length; i++) {
    const [code, value] = all[i]!;
    if (code === 0) {
      if (value === 'ENDSEC') break;
      entities.push({ type: value, data: [] });
    } else entities[entities.length - 1]?.data.push(all[i]!);
  }
  const num = (data: Pair[], code: number, fallback = 0) => {
    const p = data.find((d) => d[0] === code);
    return p ? Number(p[1]) : fallback;
  };
  const chain = (points: Vec2[], bulges: number[], closed: boolean) => {
    for (let i = 0; i + 1 < points.length; i++) segments.push(bulged(points[i]!, points[i + 1]!, bulges[i] ?? 0));
    if (closed && points.length > 2) segments.push(bulged(points[points.length - 1]!, points[0]!, bulges[points.length - 1] ?? 0));
  };
  let poly: { points: Vec2[]; bulges: number[]; closed: boolean } | null = null;
  for (const e of entities) {
    const d = e.data;
    if (e.type === 'VERTEX' && poly) {
      poly.points.push({ x: num(d, 10), y: num(d, 20) });
      poly.bulges.push(num(d, 42));
      continue;
    }
    if (e.type === 'SEQEND' && poly) {
      chain(poly.points, poly.bulges, poly.closed);
      poly = null;
      continue;
    }
    if (e.type === 'LINE') segments.push({ a: { x: num(d, 10), y: num(d, 20) }, b: { x: num(d, 11), y: num(d, 21) } });
    else if (e.type === 'CIRCLE') circles.push({ c: { x: num(d, 10), y: num(d, 20) }, r: num(d, 40) });
    else if (e.type === 'ARC') {
      const c = { x: num(d, 10), y: num(d, 20) };
      const r = num(d, 40);
      const from = num(d, 50);
      let sweep = (num(d, 51) - from) % 360;
      if (sweep <= 0) sweep += 360;
      segments.push({ a: polar(c, r, from), b: polar(c, r, from + sweep), arc: { r, large: sweep > 180, ccw: true } });
    } else if (e.type === 'LWPOLYLINE') {
      const points: Vec2[] = [];
      const bulges: number[] = [];
      for (const [code, value] of d) {
        if (code === 10) {
          points.push({ x: Number(value), y: 0 });
          bulges.push(0);
        } else if (code === 20 && points.length) points[points.length - 1]!.y = Number(value);
        else if (code === 42 && points.length) bulges[bulges.length - 1] = Number(value);
      }
      chain(points, bulges, (num(d, 70) & 1) === 1);
    } else if (e.type === 'POLYLINE') poly = { points: [], bulges: [], closed: (num(d, 70) & 1) === 1 };
    else if (e.type === 'ELLIPSE') {
      const c = { x: num(d, 10), y: num(d, 20) };
      const major = { x: num(d, 11), y: num(d, 21) };
      const ratio = num(d, 40, 1);
      const from = num(d, 41, 0);
      let to = num(d, 42, 2 * Math.PI);
      if (to <= from) to += 2 * Math.PI;
      const steps = Math.max(8, Math.ceil(((to - from) / (2 * Math.PI)) * 72));
      const at = (t: number): Vec2 => ({ x: c.x + major.x * Math.cos(t) - major.y * ratio * Math.sin(t), y: c.y + major.y * Math.cos(t) + major.x * ratio * Math.sin(t) });
      const pts = Array.from({ length: steps + 1 }, (_, i) => at(from + ((to - from) * i) / steps));
      // Ellipse entière : le dernier point est exactement le premier.
      if (Math.abs(to - from - 2 * Math.PI) < 1e-9) pts[pts.length - 1] = { ...pts[0]! };
      chain(pts, [], false);
    } else if (e.type === 'SPLINE') {
      const control: Vec2[] = [];
      const fit: Vec2[] = [];
      const knots: number[] = [];
      for (const [code, value] of d) {
        if (code === 10) control.push({ x: Number(value), y: 0 });
        else if (code === 20 && control.length) control[control.length - 1]!.y = Number(value);
        else if (code === 11) fit.push({ x: Number(value), y: 0 });
        else if (code === 21 && fit.length) fit[fit.length - 1]!.y = Number(value);
        else if (code === 40) knots.push(Number(value));
      }
      const pts = control.length >= 2 ? splinePoints(num(d, 71, 3), knots, control) : fit;
      if ((num(d, 70) & 1) === 1 && pts.length > 2) pts[pts.length - 1] = { ...pts[0]! };
      chain(pts, [], false);
    } else if (!['POINT', 'VIEWPORT', 'ATTDEF', 'ATTRIB'].includes(e.type)) skipped.add(e.type);
  }
  return { segments, circles, skipped, unit };
}

const reversed = (s: Segment): Segment => ({ a: s.b, b: s.a, ...(s.arc ? { arc: { ...s.arc, ccw: !s.arc.ccw } } : {}) });
const near = (p: Vec2, q: Vec2) => Math.abs(p.x - q.x) <= JOIN && Math.abs(p.y - q.y) <= JOIN;

/** Réunit les segments qui se suivent bout à bout ; une chaîne refermée est marquée. */
function chains(segments: Segment[]): { segments: Segment[]; closed: boolean }[] {
  const left = segments.filter((s) => !near(s.a, s.b) || s.arc);
  const out: { segments: Segment[]; closed: boolean }[] = [];
  while (left.length) {
    const chain = [left.shift()!];
    for (let grown = true; grown; ) {
      grown = false;
      if (near(chain[0]!.a, chain[chain.length - 1]!.b) && chain.length > 1) break;
      const tail = chain[chain.length - 1]!.b;
      let i = left.findIndex((s) => near(s.a, tail) || near(s.b, tail));
      if (i >= 0) {
        const s = left.splice(i, 1)[0]!;
        chain.push(near(s.a, tail) ? s : reversed(s));
        grown = true;
        continue;
      }
      const head = chain[0]!.a;
      i = left.findIndex((s) => near(s.a, head) || near(s.b, head));
      if (i >= 0) {
        const s = left.splice(i, 1)[0]!;
        chain.unshift(near(s.b, head) ? s : reversed(s));
        grown = true;
      }
    }
    out.push({ segments: chain, closed: near(chain[0]!.a, chain[chain.length - 1]!.b) });
  }
  return out;
}

export function importDxfShape(text: string, name: string): DxfImportResult {
  const all = pairs(text);
  if (!all.some((p) => p[0] === 0 && p[1] === 'SECTION')) return { ok: false, error: 'Ce fichier n’est pas un DXF lisible (seul le DXF texte est pris en charge, pas le DXF binaire).' };
  const { segments, circles, skipped, unit } = readEntities(all);
  if (segments.length === 0 && circles.length === 0) {
    return { ok: false, error: skipped.has('INSERT') ? 'Ce DXF ne contient que des blocs insérés : décomposez-les avant l’export (commande « Décomposer »).' : 'Ce DXF ne contient aucun tracé utilisable.' };
  }
  // Y vers le bas en SVG : les ordonnées sont inversées, et un arc trigonométrique tourne alors « à l'envers ».
  const n = (v: number) => String(Math.round(v * 1e6) / 1e6);
  const pt = (p: Vec2) => `${n(p.x)} ${n(-p.y)}`;
  const parts: string[] = [];
  for (const c of chains(segments)) {
    let d = `M ${pt(c.segments[0]!.a)}`;
    c.segments.forEach((s, i) => {
      // Le dernier point d'un contour refermé reprend exactement le premier.
      const to = c.closed && i === c.segments.length - 1 ? c.segments[0]!.a : s.b;
      d += s.arc ? ` A ${n(s.arc.r)} ${n(s.arc.r)} 0 ${s.arc.large ? 1 : 0} ${s.arc.ccw ? 0 : 1} ${pt(to)}` : ` L ${pt(to)}`;
    });
    parts.push(c.closed ? `<path d="${d} Z" fill="black"/>` : `<path d="${d}" fill="none" stroke="black"/>`);
  }
  for (const c of circles) if (c.r > 0) parts.push(`<circle cx="${n(c.c.x)}" cy="${n(-c.c.y)}" r="${n(c.r)}" fill="black"/>`);
  // Contours imbriqués (un trou dans une plaque) : règle pair-impair, comme une découpe.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" fill-rule="evenodd">${parts.join('')}</svg>`;
  const result = importSvgShape(svg, name);
  if (!result.ok) return { ok: false, error: result.error.replace(/Ce SVG|Ce dessin SVG/g, 'Ce DXF').replace(/ \(Inkscape[^)]*\)/g, '') };
  const warnings = [...result.warnings];
  if (skipped.size) warnings.push(`Éléments ignorés : ${[...skipped].join(', ')}.`);
  return { ok: true, shape: result.shape, warnings, ...(result.span ? { size: result.span * unit } : {}) };
}
