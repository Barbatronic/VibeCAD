/**
 * Vectorisation d'un dessin en noir et blanc (calcul pur, sans DOM ni dépendance).
 *
 * Image → masque d'encre (seuil, gomme, épaississement, nettoyage, remplissage) → contours suivis le
 * long des bords de pixels → lissage → courbes. Le résultat est un texte SVG, lu ensuite par
 * `importSvgShape` comme n'importe quel fichier : il passe par les mêmes contrôles.
 *
 * Tiré d'une grille de pixels, chaque contour est une courbe simple, et aucun ne touche un autre :
 * les pixels qui ne se rejoignent que par un coin sont d'abord reliés.
 */
import type { Vec2 } from '../math/vec';
import { MAX_STAMP_PIECES } from './svg-import';

/** Image en niveaux de gris : un octet par pixel, 0 = noir, 255 = blanc. */
export interface GrayImage {
  width: number;
  height: number;
  data: Uint8Array;
}

/** `fill` : formes pleines (l'intérieur des traits fermés est rempli). `lines` : les traits seuls. */
export type TraceMode = 'fill' | 'lines';

export interface TraceOptions {
  /** Niveau de gris (0 → 255) en dessous duquel un pixel est de l'encre. */
  threshold: number;
  /** Le dessin est clair sur fond sombre. */
  invert: boolean;
  mode: TraceMode;
  /** Épaississement des traits (pixels). Referme aussi les petits trous d'un tracé. */
  thicken: number;
  /** Taches et petits trous retirés en dessous de cette surface (pixels). */
  despeckle: number;
  /** Lissage des contours, de 0 à 1. */
  smoothing: number;
  /** Gomme : un octet par pixel, différent de 0 = effacé. */
  erased?: Uint8Array;
}

/** Seuil d'Otsu : celui qui sépare le mieux les deux populations de gris de l'image. */
export function otsuThreshold(image: GrayImage): number {
  const histogram = new Array<number>(256).fill(0);
  for (const v of image.data) histogram[v]!++;
  const total = image.data.length;
  const sum = histogram.reduce((s, n, i) => s + n * i, 0);
  let best = 128;
  let bestScore = -1;
  let countLow = 0;
  let sumLow = 0;
  for (let t = 0; t < 256; t++) {
    countLow += histogram[t]!;
    sumLow += histogram[t]! * t;
    const countHigh = total - countLow;
    if (countLow === 0 || countHigh === 0) continue;
    const gap = sumLow / countLow - (sum - sumLow) / countHigh;
    const score = countLow * countHigh * gap * gap;
    if (score > bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best + 1;
}

/** Masque de travail : une marge d'un pixel vide tout autour, pour que tout contour se ferme. */
interface Mask {
  w: number;
  h: number;
  ink: Uint8Array;
}

function binarize(image: GrayImage, o: TraceOptions): Mask {
  const w = image.width + 2;
  const h = image.height + 2;
  const ink = new Uint8Array(w * h);
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const i = y * image.width + x;
      if (o.erased?.[i]) continue;
      if (image.data[i]! < o.threshold !== o.invert) ink[(y + 1) * w + x + 1] = 1;
    }
  }
  return { w, h, ink };
}

/** Dilatation d'un pixel ; `diagonals` alterne avec les voisins directs pour une forme presque ronde. */
function dilate(m: Mask, diagonals: boolean): void {
  const { w, h } = m;
  const from = m.ink.slice();
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (from[i]) continue;
      const near = from[i - 1] || from[i + 1] || from[i - w] || from[i + w];
      if (near || (diagonals && (from[i - w - 1] || from[i - w + 1] || from[i + w - 1] || from[i + w + 1]))) m.ink[i] = 1;
    }
  }
}

/** Visite la zone de valeur `value` autour de `seed` (voisins directs) ; renvoie ses pixels. */
function floodFill(m: Mask, seed: number, value: number, seen: Uint8Array): number[] {
  const { w, ink } = m;
  const stack = [seed];
  const cells: number[] = [];
  seen[seed] = 1;
  while (stack.length > 0) {
    const i = stack.pop()!;
    cells.push(i);
    for (const j of [i - 1, i + 1, i - w, i + w]) {
      if (j >= 0 && j < ink.length && !seen[j] && ink[j] === value) {
        seen[j] = 1;
        stack.push(j);
      }
    }
  }
  return cells;
}

/** Retire les taches (`value` = 1) ou bouche les petits trous (`value` = 0). */
function removeSmall(m: Mask, value: number, minArea: number): void {
  const seen = new Uint8Array(m.ink.length);
  // Le fond extérieur n'est jamais un « petit trou ».
  floodFill(m, 0, 0, seen);
  for (let i = 0; i < m.ink.length; i++) {
    if (seen[i] || m.ink[i] !== value) continue;
    const cells = floodFill(m, i, value, seen);
    if (cells.length < minArea) for (const c of cells) m.ink[c] = 1 - value;
  }
}

/** Remplit tout ce que le fond extérieur n'atteint pas. */
function fillEnclosed(m: Mask): void {
  const outside = new Uint8Array(m.ink.length);
  floodFill(m, 0, 0, outside);
  for (let i = 0; i < m.ink.length; i++) if (!outside[i]) m.ink[i] = 1;
}

/** Relie les pixels qui ne se touchent que par un coin : sinon deux contours se toucheraient là. */
function joinDiagonals(m: Mask): void {
  const { w, h, ink } = m;
  for (let changed = true; changed; ) {
    changed = false;
    for (let y = 0; y < h - 1; y++) {
      for (let x = 0; x < w - 1; x++) {
        const i = y * w + x;
        const [a, b, c, d] = [ink[i], ink[i + 1], ink[i + w], ink[i + w + 1]];
        if (a === d && b === c && a !== b) {
          ink[a ? i + 1 : i] = 1;
          changed = true;
        }
      }
    }
  }
}

/** Masque final, sans sa marge : ce qui sera vectorisé (pour l'aperçu). */
export function traceMask(image: GrayImage, o: TraceOptions): Uint8Array {
  const m = cleanMask(image, o);
  const out = new Uint8Array(image.width * image.height);
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) out[y * image.width + x] = m.ink[(y + 1) * m.w + x + 1]!;
  }
  return out;
}

function cleanMask(image: GrayImage, o: TraceOptions): Mask {
  const m = binarize(image, o);
  for (let i = 0; i < o.thicken; i++) dilate(m, i % 2 === 1);
  if (o.despeckle > 0) {
    removeSmall(m, 1, o.despeckle);
    removeSmall(m, 0, o.despeckle);
  }
  if (o.mode === 'fill') fillEnclosed(m);
  joinDiagonals(m);
  return m;
}

/** Contours le long des bords de pixels, l'encre toujours du même côté. */
function followEdges(m: Mask): Vec2[][] {
  const { w, h, ink } = m;
  const stride = w + 1;
  const next = new Int32Array(stride * (h + 1)).fill(-1);
  const vertex = (x: number, y: number) => y * stride + x;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!ink[i]) continue;
      if (!ink[i - w]) next[vertex(x, y)] = vertex(x + 1, y);
      if (!ink[i + 1]) next[vertex(x + 1, y)] = vertex(x + 1, y + 1);
      if (!ink[i + w]) next[vertex(x + 1, y + 1)] = vertex(x, y + 1);
      if (!ink[i - 1]) next[vertex(x, y + 1)] = vertex(x, y);
    }
  }
  const loops: Vec2[][] = [];
  for (let start = 0; start < next.length; start++) {
    if (next[start]! < 0) continue;
    const loop: Vec2[] = [];
    for (let v = start; next[v]! >= 0; ) {
      // La marge d'un pixel est retirée : coordonnées de l'image d'origine.
      loop.push({ x: (v % stride) - 1, y: Math.floor(v / stride) - 1 });
      const after = next[v]!;
      next[v] = -1;
      v = after;
    }
    loops.push(loop);
  }
  return loops;
}

/** Lissage sans rétrécissement (Taubin) : un pas vers les voisins, un pas retour un peu plus grand. */
function relax(points: Vec2[], passes: number): Vec2[] {
  let pts = points;
  const n = pts.length;
  const step = (from: Vec2[], k: number) =>
    from.map((p, i) => {
      const a = from[(i + n - 1) % n]!;
      const b = from[(i + 1) % n]!;
      return { x: p.x + k * ((a.x + b.x) / 2 - p.x), y: p.y + k * ((a.y + b.y) / 2 - p.y) };
    });
  for (let i = 0; i < passes; i++) pts = step(step(pts, 0.5), -0.53);
  return pts;
}

/** Douglas-Peucker sur une portion ouverte : indices des points gardés entre `first` et `last`. */
function keepPoints(pts: Vec2[], first: number, last: number, tol: number, keep: Set<number>): void {
  const a = pts[first]!;
  const b = pts[last]!;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  let far = -1;
  let farDist = tol;
  for (let i = first + 1; i < last; i++) {
    const p = pts[i]!;
    const d = Math.abs(dy * (p.x - a.x) - dx * (p.y - a.y)) / len;
    if (d > farDist) {
      farDist = d;
      far = i;
    }
  }
  if (far < 0) return;
  keep.add(far);
  keepPoints(pts, first, far, tol, keep);
  keepPoints(pts, far, last, tol, keep);
}

function simplify(pts: Vec2[], tol: number): Vec2[] {
  const dist = (i: number) => Math.hypot(pts[i]!.x - pts[0]!.x, pts[i]!.y - pts[0]!.y);
  let opposite = 1;
  for (let i = 2; i < pts.length; i++) if (dist(i) > dist(opposite)) opposite = i;
  const keep = new Set([0, opposite]);
  keepPoints(pts, 0, opposite, tol, keep);
  keepPoints([...pts, pts[0]!], opposite, pts.length, tol, keep);
  return [...keep].filter((i) => i < pts.length).sort((a, b) => a - b).map((i) => pts[i]!);
}

const fmt = (v: number) => String(Math.round(v * 100) / 100);
const unit = (x: number, y: number): Vec2 => {
  const len = Math.hypot(x, y) || 1;
  return { x: x / len, y: y / len };
};
/** Au-delà de cet angle entre deux portions, le sommet reste un vrai coin. */
const CORNER_COS = Math.cos((50 * Math.PI) / 180);

/** Contour fermé en tracé SVG : courbes passant par les sommets, droites entre deux coins. */
function loopPath(pts: Vec2[]): { d: string; pieces: number } {
  const n = pts.length;
  const inDir = pts.map((p, i) => unit(p.x - pts[(i + n - 1) % n]!.x, p.y - pts[(i + n - 1) % n]!.y));
  const outDir = pts.map((p, i) => unit(pts[(i + 1) % n]!.x - p.x, pts[(i + 1) % n]!.y - p.y));
  const corner = pts.map((_, i) => inDir[i]!.x * outDir[i]!.x + inDir[i]!.y * outDir[i]!.y < CORNER_COS);
  const tangent = (i: number, side: Vec2[]) => (corner[i] ? side[i]! : unit(inDir[i]!.x + outDir[i]!.x, inDir[i]!.y + outDir[i]!.y));
  const parts = [`M${fmt(pts[0]!.x)} ${fmt(pts[0]!.y)}`];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const [p, q] = [pts[i]!, pts[j]!];
    if (corner[i] && corner[j]) {
      parts.push(`L${fmt(q.x)} ${fmt(q.y)}`);
      continue;
    }
    const handle = Math.hypot(q.x - p.x, q.y - p.y) / 3;
    const [t0, t1] = [tangent(i, outDir), tangent(j, inDir)];
    parts.push(`C${fmt(p.x + t0.x * handle)} ${fmt(p.y + t0.y * handle)} ${fmt(q.x - t1.x * handle)} ${fmt(q.y - t1.y * handle)} ${fmt(q.x)} ${fmt(q.y)}`);
  }
  return { d: `${parts.join(' ')} Z`, pieces: n };
}

/** Vectorise l'image en un texte SVG. Sans encre, le SVG est vide. */
export function traceBitmap(image: GrayImage, o: TraceOptions): string {
  const loops = followEdges(cleanMask(image, o));
  // Le milieu des arêtes de pixels efface les marches d'escalier les plus fines.
  const smooth = loops
    .filter((l) => l.length >= 8)
    .map((l) => relax(l.map((p, i) => ({ x: (p.x + l[(i + 1) % l.length]!.x) / 2, y: (p.y + l[(i + 1) % l.length]!.y) / 2 })), 1 + Math.round(o.smoothing * 10)));
  // Un dessin trop chargé est simplifié davantage plutôt que refusé.
  let tolerance = 0.5 + 1.5 * o.smoothing;
  for (let attempt = 0; ; attempt++) {
    const paths = smooth.map((l) => simplify(l, tolerance)).filter((l) => l.length >= 3).map(loopPath);
    if (paths.reduce((s, p) => s + p.pieces, 0) <= MAX_STAMP_PIECES || attempt === 8) {
      const d = paths.map((p) => p.d).join(' ');
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${image.width} ${image.height}">${d ? `<path d="${d}"/>` : ''}</svg>`;
    }
    tolerance *= 1.5;
  }
}
