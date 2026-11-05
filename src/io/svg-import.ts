/**
 * Lecture d'un fichier SVG en forme de tampon (calcul pur, sans DOM : le contenu du fichier n'est
 * jamais injecté dans la page, seul le contour normalisé en ressort).
 *
 * Pris en charge : <path> (toutes les commandes), <rect>, <circle>, <ellipse>, <polygon>,
 * <polyline>, transformations, styles hérités et classes CSS simples. Les traits d'un SVG ne
 * sont pas épaissis : un tracé compte par sa ligne médiane, fermée s'il est rempli.
 */
import type { Vec2 } from '../math/vec';
import { addStamp, emptySketch } from '../sketch/model';
import { extractProfiles } from '../sketch/profiles';
import { layoutStamp, type StampShape } from '../sketch/stamp';
import { contourPolyline } from '../sketch/text';

/** Morceaux au-delà desquels un dessin ralentirait l'esquisse. */
export const MAX_STAMP_PIECES = 1000;

export type SvgImportResult = { ok: true; shape: StampShape; warnings: string[] } | { ok: false; error: string };

type Matrix = [number, number, number, number, number, number];
type Cmd = { kind: 'L'; to: Vec2 } | { kind: 'C'; c1: Vec2; c2: Vec2; to: Vec2 };
interface Subpath {
  start: Vec2;
  cmds: Cmd[];
  closed: boolean;
}

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const mul = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m: Matrix, p: Vec2): Vec2 => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });

const NUMBER = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;

function parseTransform(text: string): Matrix {
  let m = IDENTITY;
  for (const [, name, body] of text.matchAll(/([a-zA-Z]+)\s*\(([^)]*)\)/g)) {
    const v = (body!.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g) ?? []).map(Number);
    const rad = ((v[0] ?? 0) * Math.PI) / 180;
    if (name === 'matrix' && v.length === 6) m = mul(m, v as Matrix);
    else if (name === 'translate') m = mul(m, [1, 0, 0, 1, v[0] ?? 0, v[1] ?? 0]);
    else if (name === 'scale') m = mul(m, [v[0] ?? 1, 0, 0, v[1] ?? v[0] ?? 1, 0, 0]);
    else if (name === 'rotate') {
      const [cx, cy] = [v[1] ?? 0, v[2] ?? 0];
      m = mul(mul(mul(m, [1, 0, 0, 1, cx, cy]), [Math.cos(rad), Math.sin(rad), -Math.sin(rad), Math.cos(rad), 0, 0]), [1, 0, 0, 1, -cx, -cy]);
    } else if (name === 'skewX') m = mul(m, [1, 0, Math.tan(rad), 1, 0, 0]);
    else if (name === 'skewY') m = mul(m, [1, Math.tan(rad), 0, 1, 0, 0]);
  }
  return m;
}

/** Arc elliptique SVG (forme par extrémités) en courbes de Bézier cubiques d'au plus 90°. */
function arcToCubics(from: Vec2, rx0: number, ry0: number, rotDeg: number, large: boolean, sweep: boolean, to: Vec2): Cmd[] {
  if (from.x === to.x && from.y === to.y) return [];
  let rx = Math.abs(rx0);
  let ry = Math.abs(ry0);
  if (rx === 0 || ry === 0) return [{ kind: 'L', to }];
  const phi = (rotDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (from.x - to.x) / 2;
  const dy = (from.y - to.y) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  const grow = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (grow > 1) {
    rx *= Math.sqrt(grow);
    ry *= Math.sqrt(grow);
  }
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, (rx * rx * ry * ry - den) / den));
  const cx1 = (k * rx * y1) / ry;
  const cy1 = (-k * ry * x1) / rx;
  const cx = cos * cx1 - sin * cy1 + (from.x + to.x) / 2;
  const cy = sin * cx1 + cos * cy1 + (from.y + to.y) / 2;
  const start = Math.atan2((y1 - cy1) / ry, (x1 - cx1) / rx);
  let delta = Math.atan2((-y1 - cy1) / ry, (-x1 - cx1) / rx) - start;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2) - 1e-9));
  const step = delta / n;
  const t = (4 / 3) * Math.tan(step / 4);
  const point = (a: number, ox: number, oy: number): Vec2 => {
    const x = rx * (Math.cos(a) + ox);
    const y = ry * (Math.sin(a) + oy);
    return { x: cx + cos * x - sin * y, y: cy + sin * x + cos * y };
  };
  const out: Cmd[] = [];
  for (let i = 0; i < n; i++) {
    const a = start + i * step;
    const b = a + step;
    out.push({
      kind: 'C',
      c1: point(a, -t * Math.sin(a), t * Math.cos(a)),
      c2: point(b, t * Math.sin(b), -t * Math.cos(b)),
      to: i === n - 1 ? to : point(b, 0, 0),
    });
  }
  return out;
}

/** Sous-tracés de l'attribut `d`. Comme un navigateur, s'arrête à la première erreur. */
function parsePath(d: string): Subpath[] {
  let i = 0;
  const skip = () => {
    while (i < d.length && /[\s,]/.test(d[i]!)) i++;
  };
  const number = (): number | null => {
    skip();
    NUMBER.lastIndex = i;
    const m = NUMBER.exec(d);
    if (!m) return null;
    i = NUMBER.lastIndex;
    return Number(m[0]);
  };
  const flag = (): boolean | null => {
    skip();
    const ch = d[i];
    if (ch !== '0' && ch !== '1') return null;
    i++;
    return ch === '1';
  };
  const out: Subpath[] = [];
  let sub: Subpath | null = null;
  let cur: Vec2 = { x: 0, y: 0 };
  let cmd = '';
  let lastCubic: Vec2 | null = null;
  let lastQuad: Vec2 | null = null;
  const begin = () => {
    if (!sub || sub.closed) {
      sub = { start: cur, cmds: [], closed: false };
      out.push(sub);
    }
    return sub;
  };
  const quad = (c: Vec2, to: Vec2): Cmd => ({
    kind: 'C',
    c1: { x: cur.x + (2 / 3) * (c.x - cur.x), y: cur.y + (2 / 3) * (c.y - cur.y) },
    c2: { x: to.x + (2 / 3) * (c.x - to.x), y: to.y + (2 / 3) * (c.y - to.y) },
    to,
  });
  for (;;) {
    skip();
    if (i >= d.length) break;
    if (/[a-zA-Z]/.test(d[i]!)) cmd = d[i++]!;
    else if (!cmd || cmd === 'Z' || cmd === 'z') break;
    const rel = cmd === cmd.toLowerCase();
    const op = cmd.toUpperCase();
    const base = rel ? cur : { x: 0, y: 0 };
    const xy = (): Vec2 | null => {
      const x = number();
      const y = number();
      return x === null || y === null ? null : { x: base.x + x, y: base.y + y };
    };
    if (op === 'Z') {
      if (sub) {
        (sub as Subpath).closed = true;
        cur = (sub as Subpath).start;
      }
      lastCubic = lastQuad = null;
      continue;
    }
    let keepCubic: Vec2 | null = null;
    let keepQuad: Vec2 | null = null;
    if (op === 'M') {
      const p = xy();
      if (!p) break;
      cur = p;
      sub = null;
      begin();
      cmd = rel ? 'l' : 'L';
    } else if (op === 'L' || op === 'H' || op === 'V') {
      let to: Vec2 | null;
      if (op === 'L') to = xy();
      else {
        const v = number();
        to = v === null ? null : op === 'H' ? { x: base.x + v, y: cur.y } : { x: cur.x, y: base.y + v };
      }
      if (!to) break;
      begin().cmds.push({ kind: 'L', to });
      cur = to;
    } else if (op === 'C' || op === 'S') {
      const c1: Vec2 | null = op === 'C' ? xy() : lastCubic ? { x: 2 * cur.x - lastCubic.x, y: 2 * cur.y - lastCubic.y } : cur;
      const c2 = xy();
      const to = xy();
      if (!c1 || !c2 || !to) break;
      begin().cmds.push({ kind: 'C', c1, c2, to });
      cur = to;
      keepCubic = c2;
    } else if (op === 'Q' || op === 'T') {
      const c: Vec2 | null = op === 'Q' ? xy() : lastQuad ? { x: 2 * cur.x - lastQuad.x, y: 2 * cur.y - lastQuad.y } : cur;
      const to = xy();
      if (!c || !to) break;
      begin().cmds.push(quad(c, to));
      cur = to;
      keepQuad = c;
    } else if (op === 'A') {
      const rx = number();
      const ry = number();
      const rot = number();
      const large = flag();
      const sweep = flag();
      const to = xy();
      if (rx === null || ry === null || rot === null || large === null || sweep === null || !to) break;
      begin().cmds.push(...arcToCubics(cur, rx, ry, rot, large, sweep, to));
      cur = to;
    } else break;
    lastCubic = keepCubic;
    lastQuad = keepQuad;
  }
  return out;
}

const KAPPA = 0.5522847498;

function ellipsePath(cx: number, cy: number, rx: number, ry: number): Subpath {
  const k = (x: number, y: number): Vec2 => ({ x: cx + x * rx, y: cy + y * ry });
  return {
    start: k(1, 0),
    closed: true,
    cmds: [
      { kind: 'C', c1: k(1, KAPPA), c2: k(KAPPA, 1), to: k(0, 1) },
      { kind: 'C', c1: k(-KAPPA, 1), c2: k(-1, KAPPA), to: k(-1, 0) },
      { kind: 'C', c1: k(-1, -KAPPA), c2: k(-KAPPA, -1), to: k(0, -1) },
      { kind: 'C', c1: k(KAPPA, -1), c2: k(1, -KAPPA), to: k(1, 0) },
    ],
  };
}

function rectPath(x: number, y: number, w: number, h: number, rx: number, ry: number): Subpath {
  if (rx <= 0 || ry <= 0) {
    return { start: { x, y }, closed: true, cmds: [{ x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }].map((to) => ({ kind: 'L' as const, to })) };
  }
  const [x2, y2] = [x + w, y + h];
  const pts: Vec2[] = [{ x: x + rx, y }, { x: x2 - rx, y }, { x: x2, y: y + ry }, { x: x2, y: y2 - ry }, { x: x2 - rx, y: y2 }, { x: x + rx, y: y2 }, { x, y: y2 - ry }, { x, y: y + ry }];
  const cmds: Cmd[] = [];
  for (let i = 0; i < 8; i += 2) {
    const corner = pts[i + 1]!;
    cmds.push({ kind: 'L', to: corner }, ...arcToCubics(corner, rx, ry, 0, false, true, pts[(i + 2) % 8]!));
  }
  return { start: pts[0]!, cmds, closed: true };
}

function pointsPath(text: string, closed: boolean): Subpath | null {
  const v = (text.match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g) ?? []).map(Number);
  if (v.length < 4) return null;
  const cmds: Cmd[] = [];
  for (let i = 2; i + 1 < v.length; i += 2) cmds.push({ kind: 'L', to: { x: v[i]!, y: v[i + 1]! } });
  return { start: { x: v[0]!, y: v[1]! }, cmds, closed };
}

const TOKEN = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>[]*(?:\[[\s\S]*?\])?\s*>|<\/\s*([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
const ATTR = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
/** Éléments dont le contenu n'est pas dessiné tel quel. */
const HIDDEN_ELEMENTS = new Set(['defs', 'clipPath', 'mask', 'symbol', 'pattern', 'marker', 'title', 'desc', 'metadata', 'style', 'script', 'foreignObject', 'linearGradient', 'radialGradient', 'filter']);

type Attrs = Record<string, string>;

function declarations(text: string): Attrs {
  const out: Attrs = {};
  for (const decl of text.split(';')) {
    const at = decl.indexOf(':');
    if (at > 0) out[decl.slice(0, at).trim()] = decl.slice(at + 1).trim();
  }
  return out;
}

/** Règles `.classe { … }` des feuilles de style du fichier (exports d'Illustrator). */
function classRules(svg: string): Map<string, Attrs> {
  const rules = new Map<string, Attrs>();
  for (const [, sheet] of svg.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
    const css = sheet!.replace(/<!\[CDATA\[|\]\]>/g, '');
    for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      for (const selector of selectors!.split(',')) {
        const name = /^\s*\.([\w-]+)\s*$/.exec(selector)?.[1];
        if (name) rules.set(name, { ...rules.get(name), ...declarations(body!) });
      }
    }
  }
  return rules;
}

const isNone = (paint: string) => paint === 'none' || paint === 'transparent';
const decodeTitle = (t: string) => t.replace(/&amp;/g, '&').replace(/&apos;/g, '’').replace(/&#39;/g, '’').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();

interface Frame {
  name: string;
  matrix: Matrix;
  fill: string;
  stroke: string;
  hidden: boolean;
}

interface Collected {
  subpaths: Subpath[];
  warnings: string[];
  openStrokes: number;
  hasImage: boolean;
}

function collect(svg: string): Collected {
  const rules = classRules(svg);
  const out: Collected = { subpaths: [], warnings: [], openStrokes: 0, hasImage: false };
  const stack: Frame[] = [{ name: '', matrix: IDENTITY, fill: 'black', stroke: 'none', hidden: false }];
  let viewBox: number[] | null = null;
  let ignoredText = false;
  let ignoredUse = false;

  const add = (paths: Subpath[], frame: Frame) => {
    const filled = !isNone(frame.fill);
    for (const p of paths) {
      if (!p.closed && !filled) {
        out.openStrokes++;
        continue;
      }
      const m = frame.matrix;
      out.subpaths.push({
        start: apply(m, p.start),
        closed: true,
        cmds: p.cmds.map((c): Cmd => (c.kind === 'L' ? { kind: 'L', to: apply(m, c.to) } : { kind: 'C', c1: apply(m, c.c1), c2: apply(m, c.c2), to: apply(m, c.to) })),
      });
    }
  };

  for (const m of svg.matchAll(TOKEN)) {
    const closing = m[1];
    if (closing !== undefined) {
      const name = closing.replace(/^.*:/, '');
      const at = stack.findLastIndex((f) => f.name === name);
      if (at > 0) stack.length = at;
      continue;
    }
    if (m[2] === undefined) continue;
    const name = m[2].replace(/^.*:/, '');
    const attrs: Attrs = {};
    for (const a of (m[3] ?? '').matchAll(ATTR)) attrs[a[1]!] = a[2] ?? a[3] ?? '';
    const parent = stack[stack.length - 1]!;
    const fromClass = (attrs.class ?? '').split(/\s+/).reduce<Attrs>((acc, c) => ({ ...acc, ...rules.get(c) }), {});
    const inline = declarations(attrs.style ?? '');
    const prop = (key: string) => inline[key] ?? fromClass[key] ?? attrs[key];
    const paint = (key: string, inherited: string) => {
      const v = prop(key);
      return v === undefined || v === 'inherit' ? inherited : v;
    };
    const frame: Frame = {
      name,
      matrix: attrs.transform ? mul(parent.matrix, parseTransform(attrs.transform)) : parent.matrix,
      fill: paint('fill', parent.fill),
      stroke: paint('stroke', parent.stroke),
      hidden: parent.hidden || HIDDEN_ELEMENTS.has(name) || prop('display') === 'none' || prop('visibility') === 'hidden',
    };
    if (!m[4]) stack.push(frame);
    if (frame.hidden) continue;
    if (name === 'svg' && !viewBox) {
      const v = (attrs.viewBox ?? '').trim().split(/[\s,]+/).map(Number);
      if (v.length === 4 && v.every(Number.isFinite)) viewBox = v;
      else {
        const [w, h] = [parseFloat(attrs.width ?? ''), parseFloat(attrs.height ?? '')];
        if (w > 0 && h > 0) viewBox = [0, 0, w, h];
      }
    }
    if (name === 'image') out.hasImage = true;
    if (name === 'text') ignoredText = true;
    if (name === 'use') ignoredUse = true;
    if (isNone(frame.fill) && isNone(frame.stroke) && name !== 'g' && name !== 'svg') continue;
    const n = (key: string) => {
      const v = parseFloat(attrs[key] ?? '');
      return Number.isFinite(v) ? v : 0;
    };
    if (name === 'path') add(parsePath(attrs.d ?? ''), frame);
    else if (name === 'circle' && n('r') > 0) add([ellipsePath(n('cx'), n('cy'), n('r'), n('r'))], frame);
    else if (name === 'ellipse' && n('rx') > 0 && n('ry') > 0) add([ellipsePath(n('cx'), n('cy'), n('rx'), n('ry'))], frame);
    else if (name === 'polygon' || name === 'polyline') {
      const p = pointsPath(attrs.points ?? '', name === 'polygon');
      if (p) add([p], frame);
    } else if (name === 'line') out.openStrokes++;
    else if (name === 'rect') {
      const whole = (attrs.width ?? '').endsWith('%') && (attrs.height ?? '').endsWith('%');
      const vb = viewBox;
      const covers = whole || (!!vb && n('x') <= vb[0]! && n('y') <= vb[1]! && n('x') + n('width') >= vb[0]! + vb[2]! && n('y') + n('height') >= vb[1]! + vb[3]!);
      if (covers && out.subpaths.length === 0 && !isNone(frame.fill)) {
        out.warnings.push('Le fond du dessin a été ignoré.');
        continue;
      }
      if (n('width') > 0 && n('height') > 0) {
        const rx = attrs.rx !== undefined ? n('rx') : n('ry');
        const ry = attrs.ry !== undefined ? n('ry') : n('rx');
        add([rectPath(n('x'), n('y'), n('width'), n('height'), Math.min(rx, n('width') / 2), Math.min(ry, n('height') / 2))], frame);
      }
    }
  }
  if (ignoredText) out.warnings.push('Les textes du dessin sont ignorés : convertissez-les en tracés dans votre logiciel de dessin.');
  if (ignoredUse) out.warnings.push('Les éléments réutilisés (<use>) sont ignorés.');
  if (out.subpaths.length > 0 && out.openStrokes > 0) out.warnings.push(`${out.openStrokes} trait(s) ouvert(s) ignoré(s) : seul un contour fermé forme un volume.`);
  return out;
}

const bezierAt = (a: Vec2, c: Extract<Cmd, { kind: 'C' }>, t: number): Vec2 => {
  const u = 1 - t;
  const [w0, w1, w2, w3] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return { x: w0 * a.x + w1 * c.c1.x + w2 * c.c2.x + w3 * c.to.x, y: w0 * a.y + w1 * c.c1.y + w2 * c.c2.y + w3 * c.to.y };
};

/** Points fins d'un contour (encombrement réel). */
function polyline(sub: Subpath): Vec2[] {
  const pts = [sub.start];
  for (const c of sub.cmds) {
    const from = pts[pts.length - 1]!;
    if (c.kind === 'L') pts.push(c.to);
    else for (let k = 1; k <= 16; k++) pts.push(bezierAt(from, c, k / 16));
  }
  return pts;
}

/** Somme des aires sans signe autour du premier point : nulle seulement si tout est aligné. */
const spread = (pts: Vec2[]) => pts.reduce((s, p, i) => {
  const q = pts[(i + 1) % pts.length]!;
  return s + Math.abs((p.x - pts[0]!.x) * (q.y - pts[0]!.y) - (q.x - pts[0]!.x) * (p.y - pts[0]!.y));
}, 0) / 2;

/** Contours du fichier en texte normalisé (voir sketch/stamp.ts), ou null s'il n'y a rien à dessiner. */
function normalize(subpaths: Subpath[]): { outline: string; pieces: number } | null {
  const fine = subpaths.map(polyline);
  const all = fine.flat();
  if (all.length === 0) return null;
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y);
  const [lx, hx, ly, hy] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const span = Math.max(hx - lx, hy - ly);
  if (!(span > 0) || !Number.isFinite(span)) return null;
  const [cx, cy] = [(lx + hx) / 2, (ly + hy) / 2];
  // Y vers le haut dans l'esquisse. Toutes les coordonnées passent par le même arrondi : deux
  // points identiques le restent, les contours restent donc exactement fermés.
  const round = (v: number) => {
    const r = Math.round(v * 1e5) / 1e5;
    return r === 0 ? 0 : r;
  };
  const place = (p: Vec2): Vec2 => ({ x: round((p.x - cx) / span), y: round(-(p.y - cy) / span) });
  const same = (a: Vec2, b: Vec2) => a.x === b.x && a.y === b.y;
  const text = (p: Vec2) => `${p.x} ${p.y}`;
  const parts: string[] = [];
  let pieces = 0;
  subpaths.forEach((sub, i) => {
    if (spread(fine[i]!) / (span * span) < 1e-7) return;
    const start = place(sub.start);
    const out = [`M ${text(start)}`];
    let cur = start;
    let count = 0;
    for (const c of sub.cmds) {
      const to = place(c.to);
      if (c.kind === 'L') {
        if (same(cur, to)) continue;
        out.push(`L ${text(to)}`);
      } else {
        const [c1, c2] = [place(c.c1), place(c.c2)];
        if (same(cur, to) && same(cur, c1) && same(cur, c2)) continue;
        out.push(`C ${text(c1)} ${text(c2)} ${text(to)}`);
      }
      cur = to;
      count++;
    }
    if (!same(cur, start)) {
      out.push(`L ${text(start)}`);
      count++;
    }
    if (count < 2) return;
    pieces += count;
    parts.push(`${out.join(' ')} Z`);
  });
  return parts.length > 0 ? { outline: parts.join(' '), pieces } : null;
}

/**
 * Même contour en polylignes très fines : le contrôle courant de l'esquisse échantillonne peu les
 * courbes, et laisserait passer ici un croisement léger que le noyau refuserait à l'extrusion.
 */
function flattened(outline: string, pieces: number): string {
  const perCurve = pieces > 300 ? 6 : 16;
  return layoutStamp(outline, { x: 0, y: 0 }, 1)
    .map((c) => {
      const [first, ...rest] = contourPolyline(c, perCurve);
      return `M ${first!.x} ${first!.y} ${rest.map((p) => `L ${p.x} ${p.y}`).join(' ')} Z`;
    })
    .join(' ');
}

/** Lit le texte d'un fichier SVG et vérifie que la forme obtenue peut former un volume. */
export function importSvgShape(svg: string, fallbackName: string): SvgImportResult {
  if (!/<svg[\s>]/.test(svg)) return { ok: false, error: 'Ce fichier n’est pas un dessin SVG.' };
  const found = collect(svg);
  const shape = normalize(found.subpaths);
  if (!shape) {
    if (found.hasImage) return { ok: false, error: 'Ce SVG contient une photo ou une image en pixels, pas un tracé : il faut d’abord la vectoriser (Inkscape : Chemin > Vectoriser un objet matriciel).' };
    if (found.openStrokes > 0) return { ok: false, error: 'Ce dessin est fait de traits ouverts : aucun contour fermé ne peut former un volume.' };
    return { ok: false, error: 'Ce SVG ne contient aucune forme utilisable.' };
  }
  if (shape.pieces > MAX_STAMP_PIECES) {
    return { ok: false, error: `Ce dessin est trop détaillé (${shape.pieces} morceaux, ${MAX_STAMP_PIECES} au plus) : simplifiez-le (Inkscape : Chemin > Simplifier).` };
  }
  const title = /<title[^>]*>([^<]+)<\/title>/.exec(svg)?.[1];
  const named: StampShape = { name: (title && decodeTitle(title)) || fallbackName, outline: shape.outline };
  const check = extractProfiles(addStamp(emptySketch({ kind: 'plane', plane: 'XY', offset: 0 }), { x: 0, y: 0 }, { ...named, outline: flattened(shape.outline, shape.pieces) }, 100).sketch);
  if (!check.ok) {
    if (check.code === 'PROFILE_OVERLAPPING') return { ok: false, error: 'Des formes de ce dessin se chevauchent : fusionnez-les d’abord (Inkscape : tout sélectionner, puis Chemin > Union).' };
    if (check.code === 'PROFILE_SELF_INTERSECTING') return { ok: false, error: 'Un tracé de ce dessin se croise lui-même : retouchez-le, ou fusionnez ses parties (Inkscape : Chemin > Union).' };
    return { ok: false, error: 'Ce dessin ne forme pas de contour fermé utilisable.' };
  }
  return { ok: true, shape: named, warnings: found.warnings };
}
