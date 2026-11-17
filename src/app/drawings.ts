/**
 * Documents de fabrication (calculs purs, testables) : mise en plan cotée (vues de face, de
 * dessus et de gauche en projection européenne), gabarit papier à l'échelle 1:1 et nomenclature.
 * Les pages sont écrites en PDF ou en SVG par `io/drawing.ts`.
 */
import { assemblyContents } from '../domain/subassemblies';
import type { CadDocument, DrawingDimension, DrawingViewName, Id, Part, PartDrawing } from '../domain/model';
import { formatLength, formatNumber } from '../domain/units';
import type { DrawingPage, LineStyle } from '../io/drawing';
import type { MeshData } from '../geometry/kernel';
import { dot3, type Vec2, type Vec3 } from '../math/vec';
import { faceOutline, largestPlanarFace, type Loop } from './laser';
import { fastenerGroups } from './fasteners';
import { BEAM_SYSTEMS, beamLabel } from '../features/beam/profiles';
import { beltSetup } from '../features/gear/definition';
import { BELT_PROFILES } from '../features/gear/profiles';
import { sheetOf } from '../domain/material-sheets';

// ----- Projection des vues

export type ViewName = DrawingViewName;

export interface ViewSpec {
  label: string;
  /** Axes horizontal et vertical de la feuille, et direction vers l'observateur. */
  u: Vec3;
  v: Vec3;
  toViewer: Vec3;
}

export const VIEWS: Record<ViewName, ViewSpec> = {
  face: { label: 'Vue de face', u: { x: 1, y: 0, z: 0 }, v: { x: 0, y: 0, z: 1 }, toViewer: { x: 0, y: -1, z: 0 } },
  dessus: { label: 'Vue de dessus', u: { x: 1, y: 0, z: 0 }, v: { x: 0, y: 1, z: 0 }, toViewer: { x: 0, y: 0, z: 1 } },
  gauche: { label: 'Vue de gauche', u: { x: 0, y: -1, z: 0 }, v: { x: 0, y: 0, z: 1 }, toViewer: { x: -1, y: 0, z: 0 } },
};

export interface ProjectedView {
  /** Traits vus et cachés, dans le plan de la vue (mm, échelle 1). */
  lines: { a: Vec2; b: Vec2; hidden: boolean }[];
  min: Vec2;
  max: Vec2;
}

const vertex = (p: ArrayLike<number>, i: number): Vec3 => ({ x: p[i * 3]!, y: p[i * 3 + 1]!, z: p[i * 3 + 2]! });

/**
 * Projette un maillage sur une vue : arêtes du solide et contours apparents des faces courbes
 * (là où la surface passe de « tournée vers l'observateur » à « de dos »), chaque trait étant
 * découpé en morceaux classés vus ou cachés (masqués par un triangle plus proche).
 */
export function projectView(mesh: MeshData, view: ViewSpec): ProjectedView {
  const proj = (p: Vec3): Vec2 => ({ x: dot3(p, view.u), y: dot3(p, view.v) });
  const depth = (p: Vec3) => dot3(p, view.toViewer);
  const segs: [Vec3, Vec3][] = [];
  const ep = mesh.edgePositions;
  for (const e of mesh.edges) {
    // Couture d'une face fermée (cylindre…) : ce n'est pas une arête visible du solide.
    if (e.faces.length === 1) continue;
    for (let k = e.start; k + 1 < e.start + e.count; k += 2) segs.push([vertex(ep, k), vertex(ep, k + 1)]);
  }
  // Contours apparents des faces courbes.
  const pos = mesh.positions;
  const nor = mesh.normals;
  const idx = mesh.indices;
  const pkey = (i: number) => `${Math.round(pos[i * 3]! * 1e5)},${Math.round(pos[i * 3 + 1]! * 1e5)},${Math.round(pos[i * 3 + 2]! * 1e5)}`;
  for (const face of mesh.faces) {
    if (face.plane) continue;
    const facing = new Map<string, { front: boolean; a: number; b: number }>();
    for (let t = face.start; t < face.start + face.count; t += 3) {
      const tri = [idx[t]!, idx[t + 1]!, idx[t + 2]!];
      const n = tri.reduce((acc, i) => ({ x: acc.x + nor[i * 3]!, y: acc.y + nor[i * 3 + 1]!, z: acc.z + nor[i * 3 + 2]! }), { x: 0, y: 0, z: 0 });
      const front = dot3(n, view.toViewer) > 1e-9;
      for (let e = 0; e < 3; e++) {
        const a = tri[e]!;
        const b = tri[(e + 1) % 3]!;
        // Clé par position : les sommets de la couture sont dédoublés dans le maillage.
        const [ka, kb] = [pkey(a), pkey(b)];
        const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
        const other = facing.get(key);
        if (!other) facing.set(key, { front, a, b });
        else if (other.front !== front) segs.push([vertex(pos, a), vertex(pos, b)]);
      }
    }
  }
  // Boîte de la vue.
  const min = { x: Infinity, y: Infinity };
  const max = { x: -Infinity, y: -Infinity };
  for (let i = 0; i < pos.length / 3; i++) {
    const q = proj(vertex(pos, i));
    min.x = Math.min(min.x, q.x);
    min.y = Math.min(min.y, q.y);
    max.x = Math.max(max.x, q.x);
    max.y = Math.max(max.y, q.y);
  }
  const size = Math.max(max.x - min.x, max.y - min.y, 1e-6);
  // Triangles projetés, rangés dans une grille pour le test de masquage.
  const N = 24;
  const cell = (v: number, lo: number, hi: number) => Math.min(N - 1, Math.max(0, Math.floor(((v - lo) / Math.max(hi - lo, 1e-9)) * N)));
  const grid: number[][] = Array.from({ length: N * N }, () => []);
  const tris: { p: Vec2[]; w: number[] }[] = [];
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const v3 = [vertex(pos, idx[t]!), vertex(pos, idx[t + 1]!), vertex(pos, idx[t + 2]!)];
    const p = v3.map(proj);
    const area = (p[1]!.x - p[0]!.x) * (p[2]!.y - p[0]!.y) - (p[2]!.x - p[0]!.x) * (p[1]!.y - p[0]!.y);
    if (Math.abs(area) < 1e-12 * size * size) continue; // triangle vu par la tranche
    const id = tris.push({ p, w: v3.map(depth) }) - 1;
    const [x0, x1] = [cell(Math.min(...p.map((q) => q.x)), min.x, max.x), cell(Math.max(...p.map((q) => q.x)), min.x, max.x)];
    const [y0, y1] = [cell(Math.min(...p.map((q) => q.y)), min.y, max.y), cell(Math.max(...p.map((q) => q.y)), min.y, max.y)];
    for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) grid[gy * N + gx]!.push(id);
  }
  const eps = 1e-4 * size + 1e-6;
  const hidden = (q: Vec2, w: number): boolean => {
    for (const id of grid[cell(q.y, min.y, max.y) * N + cell(q.x, min.x, max.x)]!) {
      const { p, w: tw } = tris[id]!;
      const [a, b, c] = p as [Vec2, Vec2, Vec2];
      const d = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
      const l1 = ((b.x - q.x) * (c.y - q.y) - (c.x - q.x) * (b.y - q.y)) / d;
      const l2 = ((c.x - q.x) * (a.y - q.y) - (a.x - q.x) * (c.y - q.y)) / d;
      const l3 = 1 - l1 - l2;
      const inside = 1e-6;
      if (l1 < inside || l2 < inside || l3 < inside) continue;
      if (l1 * tw[0]! + l2 * tw[1]! + l3 * tw[2]! > w + eps) return true;
    }
    return false;
  };
  // Chaque trait est découpé en morceaux courts, classés puis regroupés.
  const lines: ProjectedView['lines'] = [];
  const step = size / 40;
  for (const [A, B] of segs) {
    const a = proj(A);
    const b = proj(B);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-9) continue;
    const n = Math.min(60, Math.max(1, Math.ceil(len / step)));
    const [wa, wb] = [depth(A), depth(B)];
    let start = a;
    let state: boolean | null = null;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const h = hidden({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, wa + (wb - wa) * t);
      if (state !== null && h !== state) {
        const cut = { x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n };
        lines.push({ a: start, b: cut, hidden: state });
        start = cut;
      }
      state = h;
    }
    lines.push({ a: start, b, hidden: !!state });
  }
  return { lines, min, max };
}

// ----- Trous et arrondis

export interface RoundNote {
  kind: 'diameter' | 'radius';
  value: number;
  count: number;
}

/**
 * Cercles et arcs du solide, regroupés par axe et par rayon (le haut et le bas d'un même trou
 * comptent une fois) : « Ø » pour un cercle complet, « R » pour un arrondi.
 */
export function roundNotes(mesh: MeshData): RoundNote[] {
  const groups = new Map<string, { radius: number; length: number }>();
  for (const e of mesh.edges) {
    if (!e.circle) continue;
    const { center, axis, radius } = e.circle;
    const s = axis.x + axis.y + axis.z < 0 ? -1 : 1;
    const ax = { x: axis.x * s, y: axis.y * s, z: axis.z * s };
    const along = dot3(center, ax);
    const foot = { x: center.x - ax.x * along, y: center.y - ax.y * along, z: center.z - ax.z * along };
    const r = (v: number) => Math.round(v * 100) / 100 + 0;
    const key = [ax.x, ax.y, ax.z, foot.x, foot.y, foot.z, radius].map(r).join(',');
    const g = groups.get(key);
    if (g) g.length = Math.max(g.length, e.length);
    else groups.set(key, { radius, length: e.length });
  }
  const notes = new Map<string, RoundNote>();
  for (const g of groups.values()) {
    const full = g.length >= 2 * Math.PI * g.radius * 0.99;
    const kind = full ? 'diameter' : 'radius';
    const value = full ? 2 * g.radius : g.radius;
    const key = `${kind}:${value.toFixed(2)}`;
    const n = notes.get(key);
    if (n) n.count++;
    else notes.set(key, { kind, value, count: 1 });
  }
  return [...notes.values()].sort((a, b) => (a.kind === b.kind ? b.value - a.value : a.kind === 'diameter' ? -1 : 1));
}

export const roundNoteText = (n: RoundNote) => `${n.kind === 'diameter' ? 'Ø' : 'R'} ${formatNumber(n.value, 2)}${n.count > 1 ? ` (×${n.count})` : ''}`;

// ----- Mise en plan

/** Échelles normalisées, de la plus grande à la plus petite. */
const SCALES: readonly number[] = [10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01];
export const scaleLabel = (s: number) => (s >= 1 ? `${s}:1` : `1:${Math.round(1 / s)}`);

const A4L = { width: 297, height: 210 };
/** Feuilles de la mise en plan, en paysage. */
export const DRAWING_FORMATS = { A4: A4L, A3: { width: 420, height: 297 } } as const;
/** Échelles proposées, de la plus grande à la plus petite. */
export const DRAWING_SCALES: readonly number[] = SCALES;
const MARGIN = 10;
const GAP = 24;
const TEXT = 3.5;

class PageBuilder {
  page: DrawingPage;
  constructor(width: number, height: number) {
    this.page = { width, height, lines: [], texts: [] };
  }
  line(a: Vec2, b: Vec2, style: LineStyle = 'thick') {
    this.page.lines.push({ a, b, style });
  }
  rect(x: number, y: number, w: number, h: number, style: LineStyle = 'thick') {
    this.line({ x, y }, { x: x + w, y }, style);
    this.line({ x: x + w, y }, { x: x + w, y: y + h }, style);
    this.line({ x: x + w, y: y + h }, { x, y: y + h }, style);
    this.line({ x, y: y + h }, { x, y }, style);
  }
  loop(points: Loop, style: LineStyle = 'thick') {
    points.forEach((p, i) => this.line(p, points[(i + 1) % points.length]!, style));
  }
  text(at: Vec2, text: string, size = TEXT, anchor: 'start' | 'middle' | 'end' = 'start', angle = 0) {
    this.page.texts.push({ at, text, size, anchor, ...(angle ? { angle } : {}) });
  }
  /** Flèche fine dont la pointe est en `tip`, orientée selon `dir` (unitaire). */
  arrow(tip: Vec2, dir: Vec2) {
    const l = 2.5;
    const w = 0.8;
    const base = { x: tip.x - dir.x * l, y: tip.y - dir.y * l };
    this.line(tip, { x: base.x - dir.y * w, y: base.y + dir.x * w }, 'thin');
    this.line(tip, { x: base.x + dir.y * w, y: base.y - dir.x * w }, 'thin');
  }
  /**
   * Cote entre `a` et `b` (points de la pièce sur la feuille), tracée parallèlement à a→b,
   * décalée de `offset` mm sur la gauche du segment, avec lignes d'attache et texte.
   */
  dimension(a: Vec2, b: Vec2, offset: number, text: string, attach = true) {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-6) return;
    const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    const n = { x: -d.y, y: d.x };
    const s = Math.sign(offset) || 1;
    const pa = { x: a.x + n.x * offset, y: a.y + n.y * offset };
    const pb = { x: b.x + n.x * offset, y: b.y + n.y * offset };
    const ext = (p: Vec2, q: Vec2) => this.line({ x: p.x + n.x * s * 1.5, y: p.y + n.y * s * 1.5 }, { x: q.x + n.x * s * 2, y: q.y + n.y * s * 2 }, 'thin');
    if (attach) {
      ext(a, pa);
      ext(b, pb);
    }
    this.line(pa, pb, 'thin');
    this.arrow(pa, { x: -d.x, y: -d.y });
    this.arrow(pb, d);
    // Texte lisible (jamais à l'envers), posé juste au-dessus de la ligne de cote.
    const angle = (Math.atan2(d.y, d.x) * 180) / Math.PI;
    const r = angle > 90 || angle <= -90 ? { x: -d.x, y: -d.y } : d;
    const up = { x: -r.y, y: r.x };
    const mid = { x: (pa.x + pb.x) / 2 + up.x, y: (pa.y + pb.y) / 2 + up.y };
    this.text(mid, text, TEXT, 'middle', (Math.atan2(r.y, r.x) * 180) / Math.PI);
  }
}

export interface DrawingInfo {
  partName: string;
  projectName: string;
  /** Matière de la pièce (nom de sa fiche), pour le cartouche. */
  material?: string;
}

/** Ordre des vues demandées au calcul exact des traits cachés. */
export const VIEW_ORDER: readonly ViewName[] = ['face', 'dessus', 'gauche'];

/** Vue projetée à partir de traits déjà classés vus / cachés (calcul exact du noyau). */
export function viewFromLines(lines: ProjectedView['lines']): ProjectedView {
  const min = { x: Infinity, y: Infinity };
  const max = { x: -Infinity, y: -Infinity };
  for (const l of lines) {
    for (const p of [l.a, l.b]) {
      min.x = Math.min(min.x, p.x);
      min.y = Math.min(min.y, p.y);
      max.x = Math.max(max.x, p.x);
      max.y = Math.max(max.y, p.y);
    }
  }
  return lines.length ? { lines, min, max } : { lines, min: { x: 0, y: 0 }, max: { x: 0, y: 0 } };
}

// ----- Points d'accroche et cercles d'une vue

/** Cercle ou arc vu de face dans une vue (son axe est la direction du regard). */
export interface ViewCircle {
  center: Vec2;
  radius: number;
  /** Cercle complet (cote de diamètre) ou arc (cote de rayon). */
  full: boolean;
}

/** Ce sur quoi une cote peut s'accrocher dans une vue : sommets de la pièce, centres, cercles. */
export interface ViewAnchors {
  points: Vec2[];
  circles: ViewCircle[];
}

const SNAP_TOLERANCE = 0.02;
const near = (a: Vec2, b: Vec2, tol = SNAP_TOLERANCE) => Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol;

/** Points d'accroche d'une vue, pris sur la forme (extrémités des arêtes, centres des cercles). */
export function viewAnchors(mesh: MeshData, view: ViewSpec): ViewAnchors {
  const proj = (p: Vec3): Vec2 => ({ x: dot3(p, view.u), y: dot3(p, view.v) });
  const seen = new Set<string>();
  const points: Vec2[] = [];
  const add = (p: Vec2) => {
    const key = `${Math.round(p.x * 100)},${Math.round(p.y * 100)}`;
    if (seen.has(key)) return;
    seen.add(key);
    points.push(p);
  };
  const circles: ViewCircle[] = [];
  const ep = mesh.edgePositions;
  for (const e of mesh.edges) {
    if (e.count < 2) continue;
    const full = !!e.circle && e.length >= 2 * Math.PI * e.circle.radius * 0.99;
    // Extrémités de l'arête (un cercle complet n'en a pas).
    if (!full) {
      add(proj(vertex(ep, e.start)));
      add(proj(vertex(ep, e.start + e.count - 1)));
    }
    if (!e.circle || Math.abs(dot3(e.circle.axis, view.toViewer)) < 0.999) continue;
    const center = proj(e.circle.center);
    add(center);
    const known = circles.find((c) => near(c.center, center) && Math.abs(c.radius - e.circle!.radius) <= SNAP_TOLERANCE);
    if (known) known.full ||= full;
    else circles.push({ center, radius: e.circle.radius, full });
  }
  return { points, circles };
}

// ----- Mise en plan

/** Cotes d'une mise en plan sans réglage : les trois cotes d'encombrement. */
export const DEFAULT_DIMENSIONS: readonly DrawingDimension[] = [
  { id: 'auto-largeur', view: 'face', kind: 'overall', axis: 'x', offset: -8 },
  { id: 'auto-hauteur', view: 'face', kind: 'overall', axis: 'y', offset: -8 },
  { id: 'auto-profondeur', view: 'dessus', kind: 'overall', axis: 'y', offset: -8 },
];

type PageLine = DrawingPage['lines'][number];
type PageText = DrawingPage['texts'][number];

/** Une vue posée sur la feuille. */
export interface PlacedView {
  name: ViewName;
  /** Rectangle de la vue sur la feuille (mm papier). */
  box: { x: number; y: number; w: number; h: number };
  /** Point de la vue (mm pièce) → point de la feuille, et l'inverse. */
  toPaper: (p: Vec2) => Vec2;
  toView: (q: Vec2) => Vec2;
  anchors: ViewAnchors;
  min: Vec2;
  max: Vec2;
  lines: PageLine[];
  texts: PageText[];
}

/** Une cote tracée : ses traits, son texte, et de quoi la saisir à la souris. */
export interface PlacedDimension {
  dim: DrawingDimension;
  /** Ce qu'elle mesurait n'existe plus dans la vue : elle n'est pas exportée. */
  detached: boolean;
  lines: PageLine[];
  texts: PageText[];
  /** Ligne de cote (ou trait de repère), pour la saisir. */
  grip: [Vec2, Vec2];
}

export interface DrawingLayout {
  format: 'A4' | 'A3';
  width: number;
  height: number;
  scale: number;
  views: Record<ViewName, PlacedView>;
  /** Cadre, cartouche, liste des trous et arrondis. */
  frame: { lines: PageLine[]; texts: PageText[] };
  dimensions: PlacedDimension[];
}

const lengthText = (v: number) => formatNumber(v, 2);

/**
 * Trace une cote linéaire entre deux points de la feuille. `axis` : mesure horizontale (`x`),
 * verticale (`y`) ou dans l'alignement des points ; `offset` : distance de la ligne de cote au
 * bord de ce qui est mesuré (négative : en dessous, à gauche).
 */
function linearDimension(b: PageBuilder, pa: Vec2, pb: Vec2, axis: 'x' | 'y' | 'aligned', offset: number, text: string): [Vec2, Vec2] {
  if (axis === 'aligned') {
    b.dimension(pa, pb, offset, text);
    const len = Math.hypot(pb.x - pa.x, pb.y - pa.y) || 1;
    const n = { x: -(pb.y - pa.y) / len, y: (pb.x - pa.x) / len };
    return [{ x: pa.x + n.x * offset, y: pa.y + n.y * offset }, { x: pb.x + n.x * offset, y: pb.y + n.y * offset }];
  }
  // Ligne de cote horizontale ou verticale : chaque point y est ramené par sa ligne d'attache.
  const [lo, hi] = axis === 'x' ? [Math.min(pa.y, pb.y), Math.max(pa.y, pb.y)] : [Math.min(pa.x, pb.x), Math.max(pa.x, pb.x)];
  const at = (offset < 0 ? lo : hi) + offset;
  const foot = (p: Vec2): Vec2 => (axis === 'x' ? { x: p.x, y: at } : { x: at, y: p.y });
  const [fa, fb] = [foot(pa), foot(pb)];
  const ordered = axis === 'x' ? fa.x <= fb.x : fa.y >= fb.y;
  const [first, second, p1, p2] = ordered ? [fa, fb, pa, pb] : [fb, fa, pb, pa];
  const attach = (p: Vec2, f: Vec2) => {
    const len = Math.hypot(f.x - p.x, f.y - p.y);
    if (len < 1e-6) return;
    const d = { x: (f.x - p.x) / len, y: (f.y - p.y) / len };
    b.line({ x: p.x + d.x * Math.min(1.5, len / 2), y: p.y + d.y * Math.min(1.5, len / 2) }, { x: f.x + d.x * 2, y: f.y + d.y * 2 }, 'thin');
  };
  attach(p1, first);
  attach(p2, second);
  // Même convention que `dimension` : de la gauche vers la droite, ou du haut vers le bas.
  b.dimension(first, second, 0, text, false);
  return [first, second];
}

/** Trace une cote de diamètre ou de rayon : trait de repère dans la direction `angle`, texte au bout. */
function roundDimension(b: PageBuilder, center: Vec2, radius: number, kind: 'diameter' | 'radius', angle: number, offset: number, text: string): [Vec2, Vec2] {
  const d = { x: Math.cos((angle * Math.PI) / 180), y: Math.sin((angle * Math.PI) / 180) };
  const tip = { x: center.x + d.x * radius, y: center.y + d.y * radius };
  const end = { x: center.x + d.x * (radius + Math.max(2, offset)), y: center.y + d.y * (radius + Math.max(2, offset)) };
  const from = kind === 'diameter' ? { x: center.x - d.x * radius, y: center.y - d.y * radius } : center;
  b.line(from, end, 'thin');
  b.arrow(tip, d);
  if (kind === 'diameter') b.arrow(from, { x: -d.x, y: -d.y });
  // Texte horizontal au bout du repère, sur un petit palier.
  const side = d.x >= 0 ? 1 : -1;
  b.line(end, { x: end.x + side * 2, y: end.y }, 'thin');
  b.text({ x: end.x + side * 3, y: end.y - TEXT * 0.35 }, text, TEXT, side > 0 ? 'start' : 'end');
  return [tip, end];
}

/** Trace une cote dans sa vue. Une cote dont les points ne sont plus sur la pièce est « détachée ». */
export function placeDimension(dim: DrawingDimension, view: PlacedView, scale: number): PlacedDimension {
  const b = new PageBuilder(0, 0);
  let grip: [Vec2, Vec2] = [view.toPaper(view.min), view.toPaper(view.min)];
  let detached = false;
  if (dim.kind === 'overall') {
    const x = dim.axis !== 'y';
    const size = x ? view.max.x - view.min.x : view.max.y - view.min.y;
    // Les points sont pris sur le bord de la vue du côté de la cote.
    const edge = dim.offset < 0 ? view.min : view.max;
    const pa = view.toPaper(x ? { x: view.min.x, y: edge.y } : { x: edge.x, y: view.max.y });
    const pb = view.toPaper(x ? { x: view.max.x, y: edge.y } : { x: edge.x, y: view.min.y });
    if (size > 1e-6) grip = linearDimension(b, pa, pb, x ? 'x' : 'y', dim.offset, lengthText(size));
    else detached = true;
  } else if (dim.kind === 'linear' && dim.a && dim.b) {
    const axis = dim.axis ?? 'aligned';
    const value = axis === 'x' ? Math.abs(dim.b.x - dim.a.x) : axis === 'y' ? Math.abs(dim.b.y - dim.a.y) : Math.hypot(dim.b.x - dim.a.x, dim.b.y - dim.a.y);
    detached = !view.anchors.points.some((p) => near(p, dim.a!)) || !view.anchors.points.some((p) => near(p, dim.b!));
    grip = linearDimension(b, view.toPaper(dim.a), view.toPaper(dim.b), axis, dim.offset, lengthText(value));
  } else if ((dim.kind === 'diameter' || dim.kind === 'radius') && dim.a && dim.radius !== undefined) {
    const radius = dim.radius;
    detached = !view.anchors.circles.some((c) => near(c.center, dim.a!) && Math.abs(c.radius - radius) <= SNAP_TOLERANCE);
    const text = dim.kind === 'diameter' ? `Ø ${lengthText(2 * radius)}` : `R ${lengthText(radius)}`;
    grip = roundDimension(b, view.toPaper(dim.a), radius * scale, dim.kind, dim.angle ?? 45, dim.offset, text);
  } else detached = true;
  return { dim, detached, lines: b.page.lines, texts: b.page.texts, grip };
}

/** Écart minimal (mm papier) entre une ligne de cote et ce qu'elle mesure. */
const MIN_OFFSET = 2;
const sided = (p: number, lo: number, hi: number) => (p < (lo + hi) / 2 ? Math.min(p - lo, -MIN_OFFSET) : Math.max(p - hi, MIN_OFFSET));
const round1 = (v: number) => Math.round(v * 10) / 10;

/** Décalage d'une cote linéaire entre deux points de la feuille quand sa ligne passe par `p`. */
function linearOffset(pa: Vec2, pb: Vec2, axis: 'x' | 'y' | 'aligned', p: Vec2): number {
  if (axis === 'x') return round1(sided(p.y, Math.min(pa.y, pb.y), Math.max(pa.y, pb.y)));
  if (axis === 'y') return round1(sided(p.x, Math.min(pa.x, pb.x), Math.max(pa.x, pb.x)));
  const len = Math.hypot(pb.x - pa.x, pb.y - pa.y) || 1;
  const d = ((p.x - pa.x) * -(pb.y - pa.y) + (p.y - pa.y) * (pb.x - pa.x)) / len;
  return round1(Math.abs(d) < MIN_OFFSET ? (d < 0 ? -MIN_OFFSET : MIN_OFFSET) : d);
}

/**
 * Cote linéaire entre deux points d'une vue, posée là où est le pointeur `p` (feuille) : au-dessus
 * ou en dessous des points, elle mesure à l'horizontale ; à côté, à la verticale ; ailleurs, dans
 * leur alignement.
 */
export function linearAt(view: PlacedView, a: Vec2, b: Vec2, p: Vec2): Pick<DrawingDimension, 'axis' | 'offset'> {
  const [pa, pb] = [view.toPaper(a), view.toPaper(b)];
  const flatX = Math.abs(pa.x - pb.x) < 1e-6;
  const flatY = Math.abs(pa.y - pb.y) < 1e-6;
  const inX = p.x >= Math.min(pa.x, pb.x) && p.x <= Math.max(pa.x, pb.x);
  const inY = p.y >= Math.min(pa.y, pb.y) && p.y <= Math.max(pa.y, pb.y);
  const axis = flatY ? 'x' : flatX ? 'y' : inX && !inY ? 'x' : inY && !inX ? 'y' : 'aligned';
  return { axis, offset: linearOffset(pa, pb, axis, p) };
}

/** Direction d'un trait de repère du centre `c` vers le point `p`, par pas de 5°. */
export const leaderAngle = (c: Vec2, p: Vec2): number => Math.round((Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI / 5) * 5;

/** Ce qui change dans une cote quand on la fait glisser jusqu'au point `p` de la feuille. */
export function dragDimension(dim: DrawingDimension, view: PlacedView, scale: number, p: Vec2): Partial<DrawingDimension> {
  if (dim.kind === 'overall') {
    const x = dim.axis !== 'y';
    return { offset: round1(x ? sided(p.y, view.box.y, view.box.y + view.box.h) : sided(p.x, view.box.x, view.box.x + view.box.w)) };
  }
  if (dim.kind === 'linear' && dim.a && dim.b) return { offset: linearOffset(view.toPaper(dim.a), view.toPaper(dim.b), dim.axis ?? 'aligned', p) };
  if (dim.a && dim.radius !== undefined) {
    const c = view.toPaper(dim.a);
    return { angle: leaderAngle(c, p), offset: round1(Math.max(MIN_OFFSET, Math.hypot(p.x - c.x, p.y - c.y) - dim.radius * scale)) };
  }
  return {};
}

/** Point d'accroche d'une vue le plus proche du point `p` de la feuille, à moins de `reach` mm papier. */
export function nearestAnchor(layout: DrawingLayout, p: Vec2, reach: number, only?: ViewName): { view: ViewName; point: Vec2 } | null {
  let best: { view: ViewName; point: Vec2 } | null = null;
  let bestD = reach;
  for (const name of VIEW_ORDER) {
    if (only && name !== only) continue;
    const view = layout.views[name];
    for (const point of view.anchors.points) {
      const q = view.toPaper(point);
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d <= bestD) [best, bestD] = [{ view: name, point }, d];
    }
  }
  return best;
}

/** Cercle ou arc d'une vue dont le trait passe le plus près du point `p` de la feuille. */
export function nearestCircle(layout: DrawingLayout, p: Vec2, reach: number): { view: ViewName; circle: ViewCircle } | null {
  let best: { view: ViewName; circle: ViewCircle } | null = null;
  let bestD = reach;
  for (const name of VIEW_ORDER) {
    const view = layout.views[name];
    for (const circle of view.anchors.circles) {
      const c = view.toPaper(circle.center);
      const d = Math.abs(Math.hypot(p.x - c.x, p.y - c.y) - circle.radius * layout.scale);
      if (d <= bestD) [best, bestD] = [{ view: name, circle }, d];
    }
  }
  return best;
}

/**
 * Mise en plan d'une pièce sur une feuille en paysage : vue de face en haut à gauche, vue de
 * dessus en dessous, vue de gauche à droite (projection européenne), cotes, liste des diamètres
 * et rayons, cartouche. `exact` : vues calculées par le noyau (traits cachés exacts) ; sans elles,
 * les vues sont déduites du maillage (approché, mais immédiat). `settings` : retouches de la mise
 * en plan (feuille, échelle, place des vues, cotes, cartouche) ; absentes, tout est automatique.
 */
export function technicalDrawing(mesh: MeshData, info: DrawingInfo, exact?: Record<ViewName, ProjectedView>, settings?: PartDrawing): { page: DrawingPage; scale: number; layout: DrawingLayout } {
  const views = exact ?? {
    face: projectView(mesh, VIEWS.face),
    dessus: projectView(mesh, VIEWS.dessus),
    gauche: projectView(mesh, VIEWS.gauche),
  };
  const format = settings?.format ?? 'A4';
  const sheet = DRAWING_FORMATS[format];
  const ext = (v: ProjectedView) => ({ w: v.max.x - v.min.x, h: v.max.y - v.min.y });
  const F = ext(views.face);
  const T = ext(views.dessus);
  const G = ext(views.gauche);
  const titleH = 30;
  const left = MARGIN + 22;
  const top = sheet.height - MARGIN - 12;
  const availW = sheet.width - MARGIN - left - 8;
  const availH = top - (MARGIN + titleH + 6);
  const fitted = SCALES.find((s) => s * (F.w + G.w) + GAP <= availW && s * (F.h + T.h) + GAP <= availH) ?? SCALES[SCALES.length - 1]!;
  const scale = settings?.scale && settings.scale > 0 ? settings.scale : fitted;
  // Place des vues : automatique, puis décalée ; la vue de dessus reste sous la vue de face, la vue de gauche à sa droite.
  const shift = settings?.views ?? {};
  const face = { x: left + (shift.face?.x ?? 0), y: top + (shift.face?.y ?? 0) };
  const origins: Record<ViewName, Vec2> = {
    face,
    dessus: { x: face.x, y: face.y - F.h * scale - GAP + (shift.dessus?.y ?? 0) },
    gauche: { x: face.x + F.w * scale + GAP + (shift.gauche?.x ?? 0), y: face.y },
  };
  const placed = (name: ViewName): PlacedView => {
    const v = views[name];
    const o = origins[name];
    const toPaper = (p: Vec2): Vec2 => ({ x: o.x + (p.x - v.min.x) * scale, y: o.y - (v.max.y - p.y) * scale });
    const toView = (q: Vec2): Vec2 => ({ x: v.min.x + (q.x - o.x) / scale, y: v.max.y + (q.y - o.y) / scale });
    const b = new PageBuilder(0, 0);
    for (const l of v.lines) if (l.hidden) b.line(toPaper(l.a), toPaper(l.b), 'hidden');
    for (const l of v.lines) if (!l.hidden) b.line(toPaper(l.a), toPaper(l.b), 'thick');
    b.text({ x: o.x, y: o.y + 3 }, VIEWS[name].label, 3);
    const size = ext(v);
    return { name, box: { x: o.x, y: o.y - size.h * scale, w: size.w * scale, h: size.h * scale }, toPaper, toView, anchors: viewAnchors(mesh, VIEWS[name]), min: v.min, max: v.max, lines: b.page.lines, texts: b.page.texts };
  };
  const layoutViews = { face: placed('face'), dessus: placed('dessus'), gauche: placed('gauche') };
  const dimensions = (settings?.dimensions ?? DEFAULT_DIMENSIONS).map((dim) => placeDimension(dim, layoutViews[dim.view], scale));
  // Cadre et cartouche.
  const b = new PageBuilder(sheet.width, sheet.height);
  b.rect(MARGIN, MARGIN, sheet.width - 2 * MARGIN, sheet.height - 2 * MARGIN);
  const title = settings?.title ?? {};
  const cw = 130;
  const cx = sheet.width - MARGIN - cw;
  const cy = MARGIN;
  b.rect(cx, cy, cw, titleH);
  b.line({ x: cx, y: cy + 9 }, { x: cx + cw, y: cy + 9 }, 'thin');
  b.line({ x: cx, y: cy + 18 }, { x: cx + cw, y: cy + 18 }, 'thin');
  const cell = (x: number, y: number, label: string, value: string, size = 3.2) => {
    b.text({ x: cx + x + 2, y: cy + y + 6.2 }, label, 1.8);
    if (value) b.text({ x: cx + x + 2, y: cy + y + 1.8 }, value, size);
  };
  const split = (x: number, y: number) => b.line({ x: cx + x, y: cy + y }, { x: cx + x, y: cy + y + 9 }, 'thin');
  // Haut : titre et numéro du plan.
  b.line({ x: cx + 95, y: cy + 18 }, { x: cx + 95, y: cy + titleH }, 'thin');
  b.text({ x: cx + 3, y: cy + 21.5 }, title.title || info.partName, 5);
  b.text({ x: cx + 97, y: cy + 27 }, 'Plan n°', 1.8);
  if (title.number) b.text({ x: cx + 97, y: cy + 21 }, title.number, 3.5);
  // Milieu : projet et matière.
  cell(0, 9, 'Projet', info.projectName);
  split(70, 9);
  cell(70, 9, 'Matière', title.material ?? info.material ?? '');
  // Bas : auteur, date, échelle, feuille.
  cell(0, 0, 'Dessiné par', title.author ?? '');
  split(50, 0);
  cell(50, 0, 'Date', title.date ?? '');
  split(80, 0);
  cell(80, 0, 'Échelle', scaleLabel(scale));
  split(105, 0);
  cell(105, 0, 'Feuille', format);
  b.text({ x: MARGIN + 2, y: MARGIN + 2 }, `Cotes en mm · projection européenne${title.note ? ` · ${title.note}` : ''}`, 2.5);
  // Trous et arrondis.
  const notes = roundNotes(mesh);
  if (notes.length) {
    const lines = ['Trous et arrondis :', ...notes.slice(0, 8).map(roundNoteText), ...(notes.length > 8 ? ['…'] : [])];
    lines.forEach((t, i) => b.text({ x: cx, y: cy + titleH + 6 + (lines.length - 1 - i) * 4.5 }, t, 3.2));
  }
  const frame = { lines: b.page.lines, texts: b.page.texts };
  const shown = dimensions.filter((d) => !d.detached);
  const page: DrawingPage = {
    width: sheet.width,
    height: sheet.height,
    lines: [...frame.lines, ...VIEW_ORDER.flatMap((name) => layoutViews[name].lines), ...shown.flatMap((d) => d.lines)],
    texts: [...frame.texts, ...VIEW_ORDER.flatMap((name) => layoutViews[name].texts), ...shown.flatMap((d) => d.texts)],
  };
  return { page, scale, layout: { format, width: sheet.width, height: sheet.height, scale, views: layoutViews, frame, dimensions } };
}

// ----- Gabarit papier 1:1

const PAPER = [
  { name: 'A4', width: 210, height: 297 },
  { name: 'A4', width: 297, height: 210 },
  { name: 'A3', width: 297, height: 420 },
  { name: 'A3', width: 420, height: 297 },
];

/** Face par défaut du gabarit : la plus grande face plate, de préférence celle du dessus. */
function templateFace(mesh: MeshData): number {
  const largest = largestPlanarFace(mesh);
  if (largest < 0) return largest;
  const area = mesh.faces[largest]!.area;
  let best = largest;
  mesh.faces.forEach((f, i) => {
    if (f.plane && f.area > area * (1 - 1e-6) && f.plane.normal.z > mesh.faces[best]!.plane!.normal.z) best = i;
  });
  return best;
}

export interface TemplateResult {
  pages: DrawingPage[];
  /** Format de chaque page (A4 ou A3), pour l'information de l'utilisateur. */
  formats: string[];
  warnings: string[];
}

/**
 * Gabarits à l'échelle 1:1 : le contour d'une face plate de chaque pièce (celle choisie pour la
 * découpe, sinon la plus grande), centré sur une page A4 (ou A3 si besoin), avec le nom de la
 * pièce et un trait de contrôle de 50 mm pour vérifier l'échelle d'impression.
 */
export function templatePages(
  parts: readonly { id: Id; name: string }[],
  meshOf: (partId: Id) => MeshData | null | undefined,
  faceOf: (partId: Id, mesh: MeshData) => number,
): TemplateResult {
  const pages: DrawingPage[] = [];
  const formats: string[] = [];
  const warnings: string[] = [];
  const reserve = 28; // place des textes et du trait de contrôle
  for (const part of parts) {
    const mesh = meshOf(part.id);
    if (!mesh) continue;
    let face = faceOf(part.id, mesh);
    if (face < 0) face = templateFace(mesh);
    const outline = face >= 0 ? faceOutline(mesh, face) : null;
    if (!outline) {
      warnings.push(`« ${part.name} » n’a pas de face plate : pas de gabarit.`);
      continue;
    }
    const xs = outline.outer.map((p) => p.x);
    const ys = outline.outer.map((p) => p.y);
    const [x0, y0] = [Math.min(...xs), Math.min(...ys)];
    const [w, h] = [Math.max(...xs) - x0, Math.max(...ys) - y0];
    const paper = PAPER.find((p) => w <= p.width - 2 * MARGIN - 4 && h <= p.height - 2 * MARGIN - reserve - 4);
    if (!paper) {
      warnings.push(`« ${part.name} » (${Math.ceil(w)} × ${Math.ceil(h)} mm) dépasse le format A3 : utilisez plutôt la découpe laser.`);
      continue;
    }
    const b = new PageBuilder(paper.width, paper.height);
    const dx = (paper.width - w) / 2 - x0;
    const dy = MARGIN + reserve + (paper.height - 2 * MARGIN - reserve - h) / 2 - y0;
    const move = (l: Loop) => l.map((p) => ({ x: p.x + dx, y: p.y + dy }));
    b.loop(move(outline.outer));
    for (const hole of outline.holes) b.loop(move(hole));
    b.text({ x: MARGIN, y: paper.height - MARGIN - 5 }, `${part.name} — gabarit 1:1 (${formatLength(w, 1)} × ${formatLength(h, 1)})`, 4.5);
    b.text({ x: MARGIN, y: paper.height - MARGIN - 10 }, 'Imprimer en « taille réelle » (100 %), sans « ajuster à la page ».', 3);
    // Trait de contrôle de 50 mm, gradué tous les 10 mm.
    const cx = MARGIN;
    const cy = MARGIN + 10;
    b.line({ x: cx, y: cy }, { x: cx + 50, y: cy });
    for (let i = 0; i <= 5; i++) b.line({ x: cx + i * 10, y: cy }, { x: cx + i * 10, y: cy + (i % 5 === 0 ? 4 : 2) }, 'thin');
    b.text({ x: cx, y: cy - 6 }, 'Contrôle : ce trait doit mesurer 50 mm.', 3);
    if (outline.thickness > 1e-6) b.text({ x: paper.width - MARGIN, y: cy - 6 }, `Épaisseur : ${formatLength(outline.thickness, 2)}`, 3, 'end');
    pages.push(b.page);
    formats.push(paper.name);
  }
  return { pages, formats, warnings };
}

// ----- Nomenclature

export interface BomRow {
  /** Repère (1, 2, 3…) */
  mark: number;
  /** Pièce du projet ; null pour la visserie normalisée (désignation seule). */
  partId: Id | null;
  name: string;
  quantity: number;
  /** Encombrement (mm) de la pièce telle que modélisée. */
  size: Vec3 | null;
  /** Volume (mm³). */
  volume: number | null;
  /** Pièce du commerce (profilé, courroie, composant de bibliothèque, visserie) : à acheter, pas à fabriquer. */
  bought: boolean;
}

/** Étapes qui ne donnent pas de matière (esquisses, repères, images). */
const REFERENCE_FEATURES = new Set(['sketch', 'image', 'plane', 'axis']);

/**
 * Désignation commerciale d'une pièce achetée, ou `null` si elle se fabrique. Un profilé ou une
 * courroie se reconnaît à sa première étape de matière ; des reprises ensuite (perçages, coupes)
 * n'en font pas une pièce à fabriquer de zéro. Deux pièces de même désignation font une seule ligne.
 */
export function boughtDesignation(doc: Pick<CadDocument, 'materials'>, part: Part): string | null {
  const first = part.features.find((f) => !REFERENCE_FEATURES.has(f.type));
  if (first?.type === 'beam' && first.params.operation !== 'cut') {
    const p = first.params;
    return `Profilé ${BEAM_SYSTEMS[p.system]} ${beamLabel(p.size)}, ${formatLength(p.length)}`;
  }
  if (first?.type === 'gear' && first.params.kind === 'belt') {
    const p = first.params;
    return `Courroie ${BELT_PROFILES[p.belt].label}, ${Math.round(beltSetup(p).teeth)} dents, largeur ${formatLength(p.thickness)}`;
  }
  // Composant de bibliothèque non modifié, ou pièce dont la fiche matière dit « achetée ».
  if (part.component && !part.component.editable) return part.component.name;
  if (sheetOf(doc, part)?.process === 'bought') return part.name;
  return null;
}

export interface Bom {
  rows: BomRow[];
  /** 'assembly' : quantités comptées dans l'assemblage ; 'parts' : une de chaque pièce. */
  source: 'assembly' | 'parts';
}

export function meshSize(mesh: MeshData): Vec3 {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  const p = mesh.positions;
  for (let i = 0; i < p.length; i++) {
    const k = i % 3;
    if (p[i]! < lo[k]!) lo[k] = p[i]!;
    if (p[i]! > hi[k]!) hi[k] = p[i]!;
  }
  return p.length ? { x: hi[0]! - lo[0]!, y: hi[1]! - lo[1]!, z: hi[2]! - lo[2]! } : { x: 0, y: 0, z: 0 };
}

/**
 * Nomenclature : les pièces de l'assemblage avec leur nombre d'exemplaires (dans l'ordre
 * d'insertion) puis sa visserie, ou à défaut toutes les pièces ayant un volume, une de chaque.
 */
export function billOfMaterials(
  doc: CadDocument,
  hasSolid: (partId: Id) => boolean,
  meshOf: (partId: Id) => MeshData | null | undefined,
  volumeOf: (partId: Id) => number | null | undefined,
): Bom {
  // Pièces insérées, y compris celles des sous-assemblages (un bloc inséré deux fois compte double).
  const contents = assemblyContents(doc, doc.assembly);
  const counts = contents.counts;
  const source = counts.size > 0 ? 'assembly' : 'parts';
  if (source === 'parts') for (const p of doc.parts) if (hasSolid(p.id)) counts.set(p.id, 1);
  const rows: BomRow[] = [];
  for (const [partId, quantity] of counts) {
    const part = doc.parts.find((p) => p.id === partId);
    if (!part) continue;
    const mesh = meshOf(partId);
    const designation = boughtDesignation(doc, part);
    // Pièces achetées identiques (deux profilés de même section et longueur) : une ligne, quantités ajoutées.
    const same = designation ? rows.find((r) => r.bought && r.name === designation) : undefined;
    if (same) same.quantity += quantity;
    else rows.push({ mark: rows.length + 1, partId, name: designation ?? part.name, quantity, size: mesh ? meshSize(mesh) : null, volume: volumeOf(partId) ?? null, bought: designation !== null });
  }
  // Visserie normalisée : une ligne par désignation (« Vis CHC ISO 4762 M3 × 12 »).
  if (source === 'assembly') {
    for (const g of fastenerGroups({ instances: [], joints: [], fasteners: contents.fasteners })) rows.push({ mark: rows.length + 1, partId: null, name: g.name, quantity: g.ids.length, size: null, volume: null, bought: true });
  }
  return { rows, source };
}

export const bomSizeText = (s: Vec3 | null) => (s ? `${formatNumber(s.x, 1)} × ${formatNumber(s.y, 1)} × ${formatNumber(s.z, 1)}` : '—');

/** Nomenclature au format CSV (séparateur « ; », UTF-8 avec BOM : s'ouvre bien dans un tableur français). */
export function bomCsv(bom: Bom): string {
  const cell = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [['Repère', 'Désignation', 'Quantité', 'Encombrement L × l × h (mm)', 'Volume (cm³)', 'Origine'].join(';')];
  for (const r of bom.rows) {
    lines.push([String(r.mark), cell(r.name), String(r.quantity), bomSizeText(r.size), r.volume === null ? '' : formatNumber(r.volume / 1000, 2), r.bought ? 'Achetée' : 'Fabriquée'].join(';'));
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}
