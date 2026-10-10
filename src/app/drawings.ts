/**
 * Documents de fabrication (calculs purs, testables) : mise en plan cotée (vues de face, de
 * dessus et de gauche en projection européenne), gabarit papier à l'échelle 1:1 et nomenclature.
 * Les pages sont écrites en PDF ou en SVG par `io/drawing.ts`.
 */
import type { CadDocument, Id } from '../domain/model';
import { formatLength, formatNumber } from '../domain/units';
import type { DrawingPage, LineStyle } from '../io/drawing';
import type { MeshData } from '../geometry/kernel';
import { dot3, type Vec2, type Vec3 } from '../math/vec';
import { faceOutline, largestPlanarFace, type Loop } from './laser';

// ----- Projection des vues

export type ViewName = 'face' | 'dessus' | 'gauche';

interface ViewSpec {
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
const SCALES = [10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01];
export const scaleLabel = (s: number) => (s >= 1 ? `${s}:1` : `1:${Math.round(1 / s)}`);

const A4L = { width: 297, height: 210 };
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
  dimension(a: Vec2, b: Vec2, offset: number, text: string) {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-6) return;
    const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    const n = { x: -d.y, y: d.x };
    const s = Math.sign(offset) || 1;
    const pa = { x: a.x + n.x * offset, y: a.y + n.y * offset };
    const pb = { x: b.x + n.x * offset, y: b.y + n.y * offset };
    const ext = (p: Vec2, q: Vec2) => this.line({ x: p.x + n.x * s * 1.5, y: p.y + n.y * s * 1.5 }, { x: q.x + n.x * s * 2, y: q.y + n.y * s * 2 }, 'thin');
    ext(a, pa);
    ext(b, pb);
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
}

/**
 * Mise en plan d'une pièce sur une page A4 paysage : vue de face en haut à gauche, vue de
 * dessus en dessous, vue de gauche à droite (projection européenne), cotes d'encombrement,
 * liste des diamètres et rayons, cartouche.
 */
export function technicalDrawing(mesh: MeshData, info: DrawingInfo): { page: DrawingPage; scale: number } {
  const views = {
    face: projectView(mesh, VIEWS.face),
    dessus: projectView(mesh, VIEWS.dessus),
    gauche: projectView(mesh, VIEWS.gauche),
  };
  const ext = (v: ProjectedView) => ({ w: v.max.x - v.min.x, h: v.max.y - v.min.y });
  const F = ext(views.face);
  const T = ext(views.dessus);
  const G = ext(views.gauche);
  const titleH = 24;
  const left = MARGIN + 22;
  const top = A4L.height - MARGIN - 12;
  const availW = A4L.width - MARGIN - left - 8;
  const availH = top - (MARGIN + titleH + 6);
  const scale = SCALES.find((s) => s * (F.w + G.w) + GAP <= availW && s * (F.h + T.h) + GAP <= availH) ?? SCALES[SCALES.length - 1]!;
  const b = new PageBuilder(A4L.width, A4L.height);
  b.rect(MARGIN, MARGIN, A4L.width - 2 * MARGIN, A4L.height - 2 * MARGIN);
  // Origines des vues sur la feuille.
  const place = (v: ProjectedView, x: number, yTop: number) => (p: Vec2): Vec2 => ({ x: x + (p.x - v.min.x) * scale, y: yTop - (v.max.y - p.y) * scale });
  const faceAt = place(views.face, left, top);
  const dessusAt = place(views.dessus, left, top - F.h * scale - GAP);
  const gaucheAt = place(views.gauche, left + F.w * scale + GAP, top);
  const draw = (v: ProjectedView, at: (p: Vec2) => Vec2, name: ViewName) => {
    for (const l of v.lines) if (l.hidden) b.line(at(l.a), at(l.b), 'hidden');
    for (const l of v.lines) if (!l.hidden) b.line(at(l.a), at(l.b), 'thick');
    const tl = at({ x: v.min.x, y: v.max.y });
    b.text({ x: tl.x, y: tl.y + 3 }, VIEWS[name].label, 3);
  };
  draw(views.face, faceAt, 'face');
  draw(views.dessus, dessusAt, 'dessus');
  draw(views.gauche, gaucheAt, 'gauche');
  const n = (v: number) => formatNumber(v, 2);
  // Cotes d'encombrement : largeur et hauteur sur la vue de face, profondeur sur la vue de dessus.
  const fv = views.face;
  if (F.w > 1e-6) b.dimension(faceAt({ x: fv.min.x, y: fv.min.y }), faceAt({ x: fv.max.x, y: fv.min.y }), -8, n(F.w));
  if (F.h > 1e-6) b.dimension(faceAt({ x: fv.min.x, y: fv.max.y }), faceAt({ x: fv.min.x, y: fv.min.y }), -8, n(F.h));
  const tv = views.dessus;
  if (T.h > 1e-6) b.dimension(dessusAt({ x: tv.min.x, y: tv.max.y }), dessusAt({ x: tv.min.x, y: tv.min.y }), -8, n(T.h));
  // Cartouche.
  const cw = 110;
  const cx = A4L.width - MARGIN - cw;
  const cy = MARGIN;
  b.rect(cx, cy, cw, titleH);
  b.line({ x: cx, y: cy + 12 }, { x: cx + cw, y: cy + 12 }, 'thin');
  b.line({ x: cx + 70, y: cy }, { x: cx + 70, y: cy + 12 }, 'thin');
  b.text({ x: cx + 3, y: cy + 16 }, info.partName, 5);
  b.text({ x: cx + 3, y: cy + 7 }, info.projectName, 3);
  b.text({ x: cx + 3, y: cy + 3 }, 'Cotes en mm · projection européenne', 2.5);
  b.text({ x: cx + 73, y: cy + 7 }, `Échelle ${scaleLabel(scale)}`, 3.5);
  b.text({ x: cx + 73, y: cy + 3 }, 'VibeCAD', 2.5);
  // Trous et arrondis.
  const notes = roundNotes(mesh);
  if (notes.length) {
    const lines = ['Trous et arrondis :', ...notes.slice(0, 8).map(roundNoteText), ...(notes.length > 8 ? ['…'] : [])];
    lines.forEach((t, i) => b.text({ x: cx, y: cy + titleH + 6 + (lines.length - 1 - i) * 4.5 }, t, 3.2));
  }
  return { page: b.page, scale };
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
  partId: Id;
  name: string;
  quantity: number;
  /** Encombrement (mm) de la pièce telle que modélisée. */
  size: Vec3 | null;
  /** Volume (mm³). */
  volume: number | null;
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
 * d'insertion), ou à défaut toutes les pièces ayant un volume, une de chaque.
 */
export function billOfMaterials(
  doc: CadDocument,
  hasSolid: (partId: Id) => boolean,
  meshOf: (partId: Id) => MeshData | null | undefined,
  volumeOf: (partId: Id) => number | null | undefined,
): Bom {
  const counts = new Map<Id, number>();
  for (const inst of doc.assembly?.instances ?? []) counts.set(inst.partId, (counts.get(inst.partId) ?? 0) + 1);
  const source = counts.size > 0 ? 'assembly' : 'parts';
  if (source === 'parts') for (const p of doc.parts) if (hasSolid(p.id)) counts.set(p.id, 1);
  const rows: BomRow[] = [];
  for (const [partId, quantity] of counts) {
    const part = doc.parts.find((p) => p.id === partId);
    if (!part) continue;
    const mesh = meshOf(partId);
    rows.push({ mark: rows.length + 1, partId, name: part.name, quantity, size: mesh ? meshSize(mesh) : null, volume: volumeOf(partId) ?? null });
  }
  return { rows, source };
}

export const bomSizeText = (s: Vec3 | null) => (s ? `${formatNumber(s.x, 1)} × ${formatNumber(s.y, 1)} × ${formatNumber(s.z, 1)}` : '—');

/** Nomenclature au format CSV (séparateur « ; », UTF-8 avec BOM : s'ouvre bien dans un tableur français). */
export function bomCsv(bom: Bom): string {
  const cell = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [['Repère', 'Désignation', 'Quantité', 'Encombrement L × l × h (mm)', 'Volume (cm³)'].join(';')];
  for (const r of bom.rows) {
    lines.push([String(r.mark), cell(r.name), String(r.quantity), bomSizeText(r.size), r.volume === null ? '' : formatNumber(r.volume / 1000, 2)].join(';'));
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}
