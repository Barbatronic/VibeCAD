/**
 * Rendu d'une esquisse dans la vue 3D : géométrie, cotes, symboles de contraintes, aperçu du
 * tracé en cours et repères d'accrochage. Les cotes et symboles sont des boutons HTML (CSS2D) :
 * ils se lisent, se ciblent à la souris et au clavier.
 */
import { BufferGeometry, CanvasTexture, Color, Float32BufferAttribute, Group, Points, PointsMaterial } from 'three';
import type { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { AXIS_X_ID, AXIS_Y_ID, ORIGIN_POINT_ID, type ConstraintType, type SketchConstraint, type SketchParams } from '../domain/model';
import { formatAngle, formatLength } from '../domain/units';
import type { Frame3D } from '../math/frame';
import { add2, cross2, distance2, dot2, midpoint2, normalize2, perp2, scale2, sub2, type Vec2 } from '../math/vec';
import { arcGeometry, arcPointAt, ellipseOf, findArc, findCircle, findLine, pointPosition, splineOf, standalonePoints } from '../sketch/model';
import { sampleBeziers, sampleEllipse } from '../sketch/curves';
import type { ProjectableCurve, SessionPreview } from '../sketch/session';
import type { SnapResult } from '../sketch/snapping';
import type { ViewportPalette } from './colors';
import { frameMatrix } from './grid';
import { fatLineMaterial } from './part-meshes';

export interface SketchRenderInput {
  frame: Frame3D;
  sketch: SketchParams;
  mode: 'display' | 'edit';
  freeEntities?: ReadonlySet<string>;
  selection?: ReadonlySet<string>;
  hover?: string | null;
  picks?: readonly string[];
  highlightPoints?: readonly Vec2[];
  preview?: SessionPreview | null;
  snap?: SnapResult | null;
  /** Esquisse sélectionnée dans l'historique (mode affichage). */
  emphasis?: boolean;
  /** Arêtes de la pièce projetables dans l'esquisse (outil Projeter) et celle survolée. */
  projectable?: readonly ProjectableCurve[];
  projectHover?: number | null;
}

/** Symboles des contraintes géométriques (texte court + nom lisible). */
const GLYPHS: Partial<Record<ConstraintType, { text: string; label: string }>> = {
  horizontal: { text: 'H', label: 'horizontal' },
  vertical: { text: 'V', label: 'vertical' },
  parallel: { text: '∥', label: 'parallèle' },
  perpendicular: { text: '⊥', label: 'perpendiculaire' },
  collinear: { text: '≡', label: 'colinéaire' },
  equal: { text: '=', label: 'égalité' },
  tangent: { text: 'T', label: 'tangence' },
  pointOn: { text: '∈', label: 'point sur la courbe' },
  midpoint: { text: 'M', label: 'milieu' },
};

/** Éléments près desquels le symbole d'une contrainte est affiché. */
function glyphEntities(c: SketchConstraint): string[] {
  switch (c.type) {
    case 'horizontal':
    case 'vertical':
      return [c.line];
    case 'parallel':
    case 'perpendicular':
    case 'collinear':
    case 'equal':
    case 'tangent':
      return [c.a, c.b];
    case 'pointOn':
    case 'midpoint':
      return [c.point];
    default:
      return [];
  }
}

type Segment = [Vec2, Vec2];

const CIRCLE_SEGMENTS = 96;

function circleSegments(center: Vec2, radius: number, n = CIRCLE_SEGMENTS): Segment[] {
  const out: Segment[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const b = ((i + 1) / n) * Math.PI * 2;
    out.push([
      { x: center.x + radius * Math.cos(a), y: center.y + radius * Math.sin(a) },
      { x: center.x + radius * Math.cos(b), y: center.y + radius * Math.sin(b) },
    ]);
  }
  return out;
}

/** Segments d'un arc (ouverture signée : négative dans le sens horaire). */
function arcSegments(center: Vec2, radius: number, startAngle: number, sweep: number): Segment[] {
  const n = Math.max(4, Math.ceil((Math.abs(sweep) / (Math.PI * 2)) * CIRCLE_SEGMENTS));
  const out: Segment[] = [];
  for (let i = 0; i < n; i++) {
    const a = startAngle + (sweep * i) / n;
    const b = startAngle + (sweep * (i + 1)) / n;
    out.push([
      { x: center.x + radius * Math.cos(a), y: center.y + radius * Math.sin(a) },
      { x: center.x + radius * Math.cos(b), y: center.y + radius * Math.sin(b) },
    ]);
  }
  return out;
}

let pointTexture: CanvasTexture | null = null;
function squareTexture(): CanvasTexture {
  if (pointTexture) return pointTexture;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(4, 4, 24, 24);
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 4;
  ctx.strokeRect(4, 4, 24, 24);
  pointTexture = new CanvasTexture(canvas);
  return pointTexture;
}

/** Lot de segments épais d'une même épaisseur, avec une couleur par segment. */
class SegmentBatch {
  readonly positions: number[] = [];
  readonly colors: number[] = [];
  add(seg: Segment, color: Color): void {
    this.positions.push(seg[0].x, seg[0].y, 0, seg[1].x, seg[1].y, 0);
    this.colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
  }
  build(material: LineMaterial, renderOrder: number): LineSegments2 | null {
    if (this.positions.length === 0) return null;
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(this.positions);
    geometry.setColors(this.colors);
    const line = new LineSegments2(geometry, material);
    line.computeLineDistances();
    line.renderOrder = renderOrder;
    return line;
  }
}

export class SketchView {
  readonly group = new Group();
  private materials: LineMaterial[] = [];
  /** Libellés réutilisés d'une mise à jour à l'autre (clé stable) : le même élément reste sous
   *  le pointeur, ce qui garde fiables le double-clic et le focus clavier. */
  private labels = new Map<string, CSS2DObject>();
  private usedLabels = new Set<string>();

  constructor(private palette: ViewportPalette) {
    this.group.matrixAutoUpdate = false;
  }

  setPalette(palette: ViewportPalette): void {
    this.palette = palette;
  }

  private material(width: number, opts: { dashed?: boolean; depthTest?: boolean; opacity?: number } = {}): LineMaterial {
    const m = fatLineMaterial('#ffffff', width, opts);
    m.vertexColors = true;
    this.materials.push(m);
    return m;
  }

  /** Les matériaux de traits épais doivent connaître la taille de la vue. */
  setResolution(width: number, height: number): void {
    for (const m of this.materials) m.resolution.set(width, height);
  }

  private label(key: string, text: string, at: Vec2, className: string, attrs: Record<string, string> = {}, button = false): void {
    const tag = button ? 'BUTTON' : 'SPAN';
    // « À côté » : l'étiquette part du point vers le bas à droite, sans jamais le recouvrir
    // (ancre de taille nulle centrée sur le point, étiquette décalée dedans).
    const beside = className.includes('vp-tag-beside');
    let obj = this.labels.get(key);
    if (obj && (obj.element.tagName !== tag || obj.element.classList.contains('vp-anchor') !== beside)) {
      this.group.remove(obj);
      obj = undefined;
    }
    if (!obj) {
      let el = document.createElement(tag.toLowerCase());
      if (button) (el as HTMLButtonElement).type = 'button';
      if (beside) {
        const anchor = document.createElement('span');
        anchor.className = 'vp-anchor';
        anchor.appendChild(el);
        el = anchor;
      }
      obj = new CSS2DObject(el);
      this.labels.set(key, obj);
      this.group.add(obj);
    }
    const el = beside ? (obj.element.firstElementChild as HTMLElement) : obj.element;
    if (el.className !== className) el.className = className;
    if (el.textContent !== text) el.textContent = text;
    for (const [k, v] of Object.entries(attrs)) if (el.getAttribute(k) !== v) el.setAttribute(k, v);
    obj.position.set(at.x, at.y, 0);
    this.usedLabels.add(key);
  }

  /** Retire les traits et points ; les libellés sont conservés pour être réutilisés. */
  private clearGeometry(): void {
    for (const child of [...this.group.children]) {
      if (child instanceof CSS2DObject) continue;
      this.group.remove(child);
      if (child instanceof LineSegments2) child.geometry.dispose();
      if (child instanceof Points) {
        child.geometry.dispose();
        (child.material as PointsMaterial).dispose();
      }
    }
    for (const m of this.materials) m.dispose();
    this.materials = [];
  }

  /** Retire les libellés non utilisés par la dernière mise à jour (et leurs éléments HTML). */
  private pruneLabels(): void {
    for (const [key, obj] of this.labels) {
      if (this.usedLabels.has(key)) continue;
      this.group.remove(obj);
      this.labels.delete(key);
    }
  }

  clear(): void {
    this.clearGeometry();
    this.usedLabels.clear();
    this.pruneLabels();
  }

  update(input: SketchRenderInput, pixelSize: number, resolution: { width: number; height: number }): void {
    this.clearGeometry();
    this.usedLabels.clear();
    this.group.matrix.copy(frameMatrix(input.frame));
    this.group.matrixWorldNeedsUpdate = true;
    const edit = input.mode === 'edit';
    const p = this.palette;
    const cFree = new Color(p.sketch);
    const cDone = new Color(p.sketchConstrained);
    const cSel = new Color(p.sketchSelected);
    const cHover = new Color(p.sketchHover);
    const cDim = new Color(p.dimension);
    const cErr = new Color(p.error);
    const sel = input.selection ?? new Set<string>();
    const free = input.freeEntities ?? new Set<string>();
    const normal = new SegmentBatch();
    const strong = new SegmentBatch();
    const thin = new SegmentBatch();
    const dashed = new SegmentBatch();
    const sketch = input.sketch;
    const px = pixelSize;

    const cRef = new Color(p.sketchReference);
    const picks = new Set(input.picks ?? []);
    const construction = new SegmentBatch();
    const entityColor = (ids: string[], id: string) => {
      if (sel.has(id) || picks.has(id)) return { color: cSel, strong: true };
      if (input.hover === id) return { color: cHover, strong: true };
      if (!edit) return { color: input.emphasis ? cSel : cFree, strong: !!input.emphasis };
      return { color: ids.some((x) => free.has(x)) ? cFree : cDone, strong: false };
    };

    // Géométrie : traits pleins (volume), pointillés (construction), violet (repris de la pièce).
    for (const e of sketch.entities) {
      if (e.type === 'point') continue;
      let segs: Segment[];
      let style: { color: Color; strong: boolean };
      // Polyligne fine → segments à tracer.
      const chain = (pts: Vec2[], closed: boolean): Segment[] => pts.slice(0, closed ? pts.length : -1).map((q, i) => [q, pts[(i + 1) % pts.length]!] as Segment);
      if (e.type === 'ellipse') {
        const g = ellipseOf(sketch, e);
        if (!g) continue;
        segs = chain(sampleEllipse(g, 96), true);
        style = entityColor([e.id, e.center, e.major], e.id);
      } else if (e.type === 'spline') {
        const bz = splineOf(sketch, e);
        if (bz.length === 0) continue;
        segs = chain(sampleBeziers(bz, 20), false);
        style = entityColor(e.points, e.id);
      } else if (e.type === 'arc') {
        const g = arcGeometry(sketch, e);
        if (!g) continue;
        segs = arcSegments(g.center, g.radius, g.startAngle, g.sweep);
        style = entityColor([e.center, e.start, e.end], e.id);
      } else if (e.type === 'line') {
        const a = pointPosition(sketch, e.a);
        const b = pointPosition(sketch, e.b);
        if (!a || !b) continue;
        segs = [[a, b]];
        style = entityColor([e.a, e.b], e.id);
      } else {
        const c = pointPosition(sketch, e.center);
        if (!c) continue;
        segs = circleSegments(c, e.radius);
        style = entityColor([e.id, e.center], e.id);
      }
      const highlighted = sel.has(e.id) || picks.has(e.id) || input.hover === e.id;
      if (e.reference) {
        const color = highlighted ? style.color : cRef;
        for (const seg of segs) (highlighted ? strong : normal).add(seg, color);
      } else if (e.construction) {
        for (const seg of segs) construction.add(seg, style.color);
      } else {
        for (const seg of segs) (style.strong ? strong : normal).add(seg, style.color);
      }
    }

    // Arêtes de la pièce que l'outil Projeter peut reprendre.
    (input.projectable ?? []).forEach((curve, i) => {
      const hovered = input.projectHover === i;
      const segs = curve.kind === 'line' ? [[curve.a, curve.b] as Segment] : circleSegments(curve.center, curve.radius, 64);
      for (const seg of segs) (hovered ? strong : construction).add(seg, hovered ? cHover : cRef);
    });

    // Axes et origine de l'esquisse (mode édition)
    if (edit) {
      const span = px * 4000;
      // Un axe survolé ou choisi (cote, contrainte) s'épaissit comme un trait du dessin.
      const axis = (id: string, seg: Segment, color: string) => {
        const on = sel.has(id) || picks.has(id) || input.hover === id;
        if (on) strong.add(seg, sel.has(id) || picks.has(id) ? cSel : cHover);
        else thin.add(seg, new Color(color));
      };
      axis(AXIS_X_ID, [{ x: -span, y: 0 }, { x: span, y: 0 }], p.axisX);
      axis(AXIS_Y_ID, [{ x: 0, y: -span }, { x: 0, y: span }], p.axisY);
      for (const seg of circleSegments({ x: 0, y: 0 }, 6 * px, 24)) strong.add(seg, sel.has(ORIGIN_POINT_ID) || input.hover === ORIGIN_POINT_ID ? cSel : cDim);
    }

    // Cotes et symboles
    if (edit) {
      const centroid = sketchCentroid(sketch);
      // Plusieurs symboles sur un même élément sont décalés les uns des autres.
      const slots = new Map<string, number>();
      const glyphPosition = (entityId: string): Vec2 | null => {
        const k = slots.get(entityId) ?? 0;
        slots.set(entityId, k + 1);
        const line = findLine(sketch, entityId);
        if (line) {
          const a = pointPosition(sketch, line.a);
          const b = pointPosition(sketch, line.b);
          if (!a || !b || distance2(a, b) < 1e-9) return null;
          const n = sideAwayFrom(a, b, centroid);
          const t = normalize2(sub2(b, a));
          return add2(add2(midpoint2(a, b), scale2(n, -14 * px)), scale2(t, k * 20 * px));
        }
        const arc = findArc(sketch, entityId);
        const ag = arc && arcGeometry(sketch, arc);
        if (ag) {
          // Au milieu de l'arc, côté extérieur, décalé pour chaque symbole supplémentaire.
          const m = arcPointAt(ag, 0.5 + k * 0.12);
          const out = normalize2(sub2(m, ag.center));
          return add2(m, scale2(out, 14 * px));
        }
        const circle = findCircle(sketch, entityId);
        if (circle) {
          const c = pointPosition(sketch, circle.center);
          if (!c) return null;
          const angle = -Math.PI / 4 - k * 0.45;
          const r = circle.radius + 12 * px;
          return { x: c.x + r * Math.cos(angle), y: c.y + r * Math.sin(angle) };
        }
        const pt = pointPosition(sketch, entityId);
        return pt ? { x: pt.x + (14 + k * 20) * px, y: pt.y - 14 * px } : null;
      };
      for (const c of sketch.constraints) {
        const geom = dimensionGeometry(sketch, c, centroid, px);
        if (geom) {
          const color = sel.has(c.id) ? cSel : input.hover === c.id ? cHover : cDim;
          for (const seg of geom.segments) thin.add(seg, color);
          this.label(`c:${c.id}`, geom.text, geom.labelAt, `vp-dim${sel.has(c.id) ? ' is-selected' : ''}`, {
            'data-constraint': c.id,
            'aria-label': `${geom.description} : ${geom.text}. Double-cliquez ou appuyez sur Entrée pour modifier.`,
            title: `${geom.description} — double-cliquez pour changer la valeur, faites glisser pour déplacer la cote`,
          }, true);
          continue;
        }
        const glyph = GLYPHS[c.type];
        if (!glyph) continue;
        glyphEntities(c).forEach((entityId, i) => {
          const at = glyphPosition(entityId);
          if (!at) return;
          this.label(`c:${c.id}:${i}`, glyph.text, at, `vp-glyph${sel.has(c.id) ? ' is-selected' : ''}`, {
            'data-constraint': c.id,
            'aria-label': `Contrainte : ${glyph.label}`,
            title: `Contrainte : ${glyph.label} — cliquez pour la sélectionner, Suppr pour la retirer`,
          }, true);
        });
      }
    }

    // Points seuls (outil Point) : une croix, visible aussi hors de l'édition.
    for (const p of standalonePoints(sketch)) {
      const style = entityColor([p.id], p.id);
      const k = 6 * px;
      for (const seg of [[{ x: p.x - k, y: p.y - k }, { x: p.x + k, y: p.y + k }], [{ x: p.x - k, y: p.y + k }, { x: p.x + k, y: p.y - k }]] as Segment[]) (style.strong ? strong : normal).add(seg, style.color);
    }

    // Points (mode édition) ; ceux des éléments repris de la pièce sont violets (fixes).
    const pointPositions: number[] = [];
    const pointColors: number[] = [];
    if (edit) {
      const refPoints = new Set<string>();
      for (const e of sketch.entities) {
        if (e.type === 'line' && e.reference) refPoints.add(e.a).add(e.b);
        if (e.type === 'circle' && e.reference) refPoints.add(e.center);
        if (e.type === 'arc' && e.reference) refPoints.add(e.center).add(e.start).add(e.end);
      }
      for (const e of sketch.entities) {
        if (e.type !== 'point') continue;
        const base = refPoints.has(e.id) ? cRef : free.has(e.id) ? cFree : cDone;
        const style = sel.has(e.id) || picks.has(e.id) ? { color: cSel } : input.hover === e.id ? { color: cHover } : { color: base };
        pointPositions.push(e.x, e.y, 0);
        pointColors.push(style.color.r, style.color.g, style.color.b);
      }
    }

    // Points à relier (contour ouvert) : cercles rouges + libellé
    for (const [i, h] of (input.highlightPoints ?? []).entries()) {
      for (const seg of circleSegments(h, 10 * px, 24)) strong.add(seg, cErr);
      this.label(`open:${i}`, 'À relier', h, 'vp-tag vp-tag-error vp-tag-beside');
    }

    // Aperçu du tracé en cours
    const preview = input.preview;
    if (preview) {
      const cPrev = new Color(p.preview);
      for (const seg of preview.lines) dashed.add(seg, cPrev);
      for (const circle of preview.circles) for (const seg of circleSegments(circle.center, circle.radius)) dashed.add(seg, cPrev);
      for (const arc of preview.arcs) {
        if (Math.abs(arc.sweep) < 1e-6) continue;
        for (const seg of arcSegments(arc.center, arc.radius, arc.startAngle, arc.sweep)) strong.add(seg, cPrev);
        if (arc.arrow === false) continue;
        // Flèche au bout de l'arc : elle montre le sens dans lequel il est tracé.
        const endA = arc.startAngle + arc.sweep;
        const tip = { x: arc.center.x + arc.radius * Math.cos(endA), y: arc.center.y + arc.radius * Math.sin(endA) };
        const dir = scale2({ x: -Math.sin(endA), y: Math.cos(endA) }, Math.sign(arc.sweep));
        for (const seg of arrow(tip, dir, 11 * px)) strong.add(seg, cPrev);
      }
      for (const g of preview.guides) dashed.add(g, new Color(p.sketchHover));
      // Outil Couper : le morceau qui sera retiré, en rouge.
      for (const path of preview.removed ?? []) for (let i = 0; i + 1 < path.length; i++) strong.add([path[i]!, path[i + 1]!], cErr);
      for (const [i, l] of preview.labels.entries()) this.label(`preview:${i}`, l.text, previewLabelAt(l, px), 'vp-tag vp-tag-preview');
    }

    // Repère d'accrochage : forme + texte
    const snap = input.snap;
    if (snap && snap.kind !== 'free') {
      const s = snap.point;
      const cSnap = new Color(p.sketchSelected);
      const r = 7 * px;
      if (snap.kind === 'grid') {
        strong.add([{ x: s.x - r * 0.6, y: s.y }, { x: s.x + r * 0.6, y: s.y }], cDim);
        strong.add([{ x: s.x, y: s.y - r * 0.6 }, { x: s.x, y: s.y + r * 0.6 }], cDim);
      } else if (snap.kind === 'center' || snap.kind === 'origin') {
        for (const seg of circleSegments(s, r, 20)) strong.add(seg, cSnap);
      } else {
        const sq: Vec2[] = [
          { x: s.x - r, y: s.y - r },
          { x: s.x + r, y: s.y - r },
          { x: s.x + r, y: s.y + r },
          { x: s.x - r, y: s.y + r },
        ];
        for (let i = 0; i < 4; i++) strong.add([sq[i]!, sq[(i + 1) % 4]!], cSnap);
      }
      if (snap.label) this.label('snap', snap.label, s, 'vp-tag vp-tag-snap vp-tag-beside');
    }

    const objects = [
      thin.build(this.material(1.2, { depthTest: !edit }), 30),
      normal.build(this.material(edit ? 2.2 : 1.6, { depthTest: !edit }), 31),
      strong.build(this.material(edit ? 3.6 : 2.8, { depthTest: !edit }), 32),
      dashed.build(this.material(1.6, { dashed: true, depthTest: false }), 33),
      construction.build(this.material(edit ? 2 : 1.4, { dashed: true, depthTest: !edit }), 31),
    ];
    for (const o of objects) if (o) this.group.add(o);
    for (const m of this.materials) {
      m.resolution.set(resolution.width, resolution.height);
      m.dashSize = 6 * px;
      m.gapSize = 4 * px;
    }
    if (pointPositions.length > 0) {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(pointPositions, 3));
      geometry.setAttribute('color', new Float32BufferAttribute(pointColors, 3));
      const points = new Points(
        geometry,
        new PointsMaterial({ size: 9, sizeAttenuation: false, vertexColors: true, map: squareTexture(), alphaTest: 0.5, depthTest: false, transparent: true }),
      );
      points.renderOrder = 34;
      this.group.add(points);
    }
    this.pruneLabels();
  }

  dispose(): void {
    this.clear();
  }
}

/**
 * Place d'une valeur affichée pendant le tracé. Le long d'un trait : à côté de son milieu, du côté
 * gauche ou du dessus (l'étiquette d'accrochage est en bas à droite du curseur), assez loin pour
 * que le texte ne recouvre jamais le trait. Sinon : un peu au-dessus du point.
 */
function previewLabelAt(l: { at: Vec2; text: string; along?: [Vec2, Vec2] }, px: number): Vec2 {
  if (!l.along) return add2(l.at, { x: 0, y: 12 * px });
  const [a, b] = l.along;
  const len = distance2(a, b);
  if (len < 1e-12) return add2(l.at, { x: 0, y: 18 * px });
  const d = scale2(sub2(b, a), 1 / len);
  let n = { x: -d.y, y: d.x };
  if (n.x > 1e-9 || (Math.abs(n.x) <= 1e-9 && n.y < 0)) n = scale2(n, -1);
  // Demi-largeur et demi-hauteur approximatives de l'étiquette (pixels).
  const halfWidth = 6 + l.text.length * 3.6;
  const offset = 10 + Math.abs(n.x) * halfWidth + Math.abs(n.y) * 9;
  return add2(l.at, scale2(n, offset * px));
}

function sketchCentroid(sketch: SketchParams): Vec2 {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const e of sketch.entities) {
    if (e.type === 'point') {
      minX = Math.min(minX, e.x);
      maxX = Math.max(maxX, e.x);
      minY = Math.min(minY, e.y);
      maxY = Math.max(maxY, e.y);
    } else if (e.type === 'circle') {
      // (Les arcs comptent par leurs points, déjà pris en compte.)
      const c = pointPosition(sketch, e.center);
      if (c) {
        minX = Math.min(minX, c.x - e.radius);
        maxX = Math.max(maxX, c.x + e.radius);
        minY = Math.min(minY, c.y - e.radius);
        maxY = Math.max(maxY, c.y + e.radius);
      }
    }
  }
  return Number.isFinite(minX) ? { x: (minX + maxX) / 2, y: (minY + maxY) / 2 } : { x: 0, y: 0 };
}

/** Normale du segment [a, b] orientée à l'opposé du centre de l'esquisse. */
function sideAwayFrom(a: Vec2, b: Vec2, centroid: Vec2): Vec2 {
  const n = normalize2(perp2(sub2(b, a)));
  const mid = midpoint2(a, b);
  const toMid = sub2(mid, centroid);
  return n.x * toMid.x + n.y * toMid.y < 0 ? scale2(n, -1) : n;
}

function arrow(tip: Vec2, dir: Vec2, size: number): Segment[] {
  const d = normalize2(dir);
  const back = scale2(d, -size);
  const side = scale2(perp2(d), size * 0.42);
  return [
    [tip, add2(add2(tip, back), side)],
    [tip, add2(sub2(tip, side), scale2(d, size * -1))],
  ];
}

interface DimensionGeometry {
  segments: Segment[];
  labelAt: Vec2;
  text: string;
  description: string;
}

/** Géométrie d'affichage d'une cote (lignes d'attache, ligne de cote, flèches, libellé). */
export function dimensionGeometry(sketch: SketchParams, c: SketchConstraint, centroid: Vec2, px: number): DimensionGeometry | null {
  const gap = 4 * px;
  const offset = 26 * px;
  const arrowSize = 9 * px;
  if (c.type === 'length' || c.type === 'distance') {
    let a: Vec2 | undefined;
    let b: Vec2 | undefined;
    if (c.type === 'length') {
      const line = findLine(sketch, c.line);
      a = line && pointPosition(sketch, line.a);
      b = line && pointPosition(sketch, line.b);
    } else {
      a = pointPosition(sketch, c.a);
      b = pointPosition(sketch, c.b);
    }
    if (!a || !b || distance2(a, b) < 1e-9) return null;
    // Placement choisi à la souris (décalage signé par rapport à la normale du segment), sinon automatique.
    let n = sideAwayFrom(a, b, centroid);
    let dist = offset;
    if (c.offset !== undefined) {
      const n0 = normalize2(perp2(sub2(b, a)));
      n = c.offset >= 0 ? n0 : scale2(n0, -1);
      dist = Math.abs(c.offset);
    }
    const a2 = add2(a, scale2(n, dist));
    const b2 = add2(b, scale2(n, dist));
    const dir = sub2(b2, a2);
    return {
      segments: [[add2(a, scale2(n, gap)), add2(a2, scale2(n, gap * 2))], [add2(b, scale2(n, gap)), add2(b2, scale2(n, gap * 2))], [a2, b2], ...arrow(a2, scale2(dir, -1), arrowSize), ...arrow(b2, dir, arrowSize)],
      labelAt: add2(midpoint2(a2, b2), scale2(n, 12 * px)),
      text: formatLength(c.value),
      description: c.type === 'length' ? 'Cote de longueur' : 'Cote de distance',
    };
  }
  if (c.type === 'distanceX' || c.type === 'distanceY') {
    const a = pointPosition(sketch, c.a);
    const b = pointPosition(sketch, c.b);
    if (!a || !b) return null;
    const horizontal = c.type === 'distanceX';
    if (horizontal) {
      const above = c.offset !== undefined ? c.offset >= 0 : (a.y + b.y) / 2 >= centroid.y;
      const y = c.offset !== undefined ? (a.y + b.y) / 2 + c.offset : above ? Math.max(a.y, b.y) + offset : Math.min(a.y, b.y) - offset;
      const s = above ? 1 : -1;
      const pa = { x: a.x, y };
      const pb = { x: b.x, y };
      const segs: Segment[] = [
        [{ x: a.x, y: a.y + s * gap }, { x: a.x, y: y + s * gap * 2 }],
        [{ x: b.x, y: b.y + s * gap }, { x: b.x, y: y + s * gap * 2 }],
        [pa, pb],
      ];
      if (Math.abs(b.x - a.x) > 1e-9) segs.push(...arrow(pa, { x: a.x - b.x, y: 0 }, arrowSize), ...arrow(pb, { x: b.x - a.x, y: 0 }, arrowSize));
      return { segments: segs, labelAt: { x: (a.x + b.x) / 2, y: y + s * 12 * px }, text: formatLength(c.value), description: 'Cote horizontale' };
    }
    const right = c.offset !== undefined ? c.offset >= 0 : (a.x + b.x) / 2 >= centroid.x;
    const x = c.offset !== undefined ? (a.x + b.x) / 2 + c.offset : right ? Math.max(a.x, b.x) + offset : Math.min(a.x, b.x) - offset;
    const s = right ? 1 : -1;
    const pa = { x, y: a.y };
    const pb = { x, y: b.y };
    const segs: Segment[] = [
      [{ x: a.x + s * gap, y: a.y }, { x: x + s * gap * 2, y: a.y }],
      [{ x: b.x + s * gap, y: b.y }, { x: x + s * gap * 2, y: b.y }],
      [pa, pb],
    ];
    if (Math.abs(b.y - a.y) > 1e-9) segs.push(...arrow(pa, { x: 0, y: a.y - b.y }, arrowSize), ...arrow(pb, { x: 0, y: b.y - a.y }, arrowSize));
    return { segments: segs, labelAt: { x: x + s * 18 * px, y: (a.y + b.y) / 2 }, text: formatLength(c.value), description: 'Cote verticale' };
  }
  if (c.type === 'pointLineDistance') {
    const p = pointPosition(sketch, c.point);
    const line = findLine(sketch, c.line);
    const a = line && pointPosition(sketch, line.a);
    const b = line && pointPosition(sketch, line.b);
    if (!p || !a || !b || distance2(a, b) < 1e-9) return null;
    const t = normalize2(sub2(b, a));
    const s = dot2(sub2(p, a), t);
    const foot0 = add2(a, scale2(t, s));
    // Glissement de la ligne de cote le long du segment (placement choisi à la souris).
    const shift = c.offset ?? 0;
    const p1 = add2(p, scale2(t, shift));
    const foot = add2(foot0, scale2(t, shift));
    const segs: Segment[] = [];
    if (Math.abs(shift) > 1e-9) segs.push([p, p1], [foot0, foot]);
    if (distance2(p1, foot) > 1e-9) segs.push([p1, foot], ...arrow(foot, sub2(foot, p1), arrowSize), ...arrow(p1, sub2(p1, foot), arrowSize));
    // Prolongement de la droite jusqu'au pied de la perpendiculaire.
    if (s + shift < 0) segs.push([foot, a]);
    else if (s + shift > distance2(a, b)) segs.push([b, foot]);
    const side = distance2(p1, foot) > 1e-9 ? normalize2(perp2(sub2(foot, p1))) : perp2(t);
    return {
      segments: segs,
      labelAt: add2(midpoint2(p1, foot), scale2(side, 14 * px)),
      text: formatLength(c.value),
      description: 'Cote de distance au segment',
    };
  }
  if (c.type === 'angle') {
    const la = findLine(sketch, c.a);
    const lb = findLine(sketch, c.b);
    const a1 = la && pointPosition(sketch, la.a);
    const a2 = la && pointPosition(sketch, la.b);
    const b1 = lb && pointPosition(sketch, lb.a);
    const b2 = lb && pointPosition(sketch, lb.b);
    if (!a1 || !a2 || !b1 || !b2 || distance2(a1, a2) < 1e-9 || distance2(b1, b2) < 1e-9) return null;
    const u = normalize2(sub2(a2, a1));
    const v = normalize2(sub2(b2, b1));
    const midA = midpoint2(a1, a2);
    const midB = midpoint2(b1, b2);
    const denom = cross2(u, v);
    // Sommet de l'angle : intersection des deux droites (milieu des segments s'ils sont parallèles).
    const o = Math.abs(denom) < 1e-9 ? midpoint2(midA, midB) : add2(a1, scale2(u, cross2(sub2(b1, a1), v) / denom));
    const toward = (m: Vec2, fallback: Vec2) => (distance2(m, o) > 1e-6 ? normalize2(sub2(m, o)) : fallback);
    const ua = toward(midA, u);
    let vb = toward(midB, v);
    const between = (x: Vec2, y: Vec2) => (Math.acos(Math.max(-1, Math.min(1, dot2(x, y)))) * 180) / Math.PI;
    if (Math.abs(between(ua, vb) - c.value) > Math.abs(between(ua, scale2(vb, -1)) - c.value)) vb = scale2(vb, -1);
    const start = Math.atan2(ua.y, ua.x);
    const sweep = Math.atan2(cross2(ua, vb), dot2(ua, vb));
    const radius = c.offset !== undefined && c.offset > 0 ? c.offset : 40 * px;
    const n = 24;
    const arc: Segment[] = [];
    for (let i = 0; i < n; i++) {
      const t0 = start + (sweep * i) / n;
      const t1 = start + (sweep * (i + 1)) / n;
      arc.push([
        { x: o.x + radius * Math.cos(t0), y: o.y + radius * Math.sin(t0) },
        { x: o.x + radius * Math.cos(t1), y: o.y + radius * Math.sin(t1) },
      ]);
    }
    const mid = start + sweep / 2;
    return {
      segments: arc,
      labelAt: { x: o.x + (radius + 16 * px) * Math.cos(mid), y: o.y + (radius + 16 * px) * Math.sin(mid) },
      text: formatAngle(c.value),
      description: 'Cote d’angle',
    };
  }
  if ((c.type === 'diameter' || c.type === 'radius') && sketch.entities.some((e) => e.id === c.circle && e.type === 'ellipse')) {
    // Ellipse : la cote suit le petit axe (perpendiculaire au grand axe).
    const e = sketch.entities.find((x) => x.id === c.circle);
    const g = e?.type === 'ellipse' ? ellipseOf(sketch, e) : undefined;
    if (!g) return null;
    const u = { x: -Math.sin(g.angle), y: Math.cos(g.angle) };
    const tipOut = add2(g.center, scale2(u, g.b));
    const outside = add2(g.center, scale2(u, g.b + (c.offset !== undefined ? Math.max(c.offset, 0) : offset)));
    const tipIn = sub2(g.center, scale2(u, g.b));
    return c.type === 'diameter'
      ? { segments: [[tipIn, outside], ...arrow(tipOut, u, arrowSize), ...arrow(tipIn, scale2(u, -1), arrowSize)], labelAt: add2(outside, scale2(u, 10 * px)), text: `↕ ${formatLength(c.value)}`, description: 'Cote du petit axe de l’ellipse' }
      : { segments: [[g.center, outside], ...arrow(tipOut, u, arrowSize)], labelAt: add2(outside, scale2(u, 10 * px)), text: `r ${formatLength(c.value)}`, description: 'Cote du petit rayon de l’ellipse' };
  }
  if (c.type === 'diameter' || c.type === 'radius') {
    const circle = findCircle(sketch, c.circle);
    const arc = findArc(sketch, c.circle);
    const ag = arc && arcGeometry(sketch, arc);
    const center = ag ? ag.center : circle && pointPosition(sketch, circle.center);
    if ((!circle && !ag) || !center) return null;
    // Pour un arc, la cote vise le milieu de l'arc.
    const auto = ag ? normalize2(sub2(arcPointAt(ag, 0.5), ag.center)) : { x: Math.SQRT1_2, y: Math.SQRT1_2 };
    const u = c.labelAngle !== undefined ? { x: Math.cos((c.labelAngle * Math.PI) / 180), y: Math.sin((c.labelAngle * Math.PI) / 180) } : auto;
    const r = ag ? ag.radius : circle!.radius;
    const tipOut = add2(center, scale2(u, r));
    const outside = add2(center, scale2(u, r + (c.offset !== undefined ? Math.max(c.offset, 0) : offset)));
    if (c.type === 'diameter') {
      const tipIn = sub2(center, scale2(u, r));
      return {
        segments: [[tipIn, outside], ...arrow(tipOut, u, arrowSize), ...arrow(tipIn, scale2(u, -1), arrowSize)],
        labelAt: add2(outside, scale2(u, 10 * px)),
        text: `Ø ${formatLength(c.value)}`,
        description: 'Cote de diamètre',
      };
    }
    return {
      segments: [[center, outside], ...arrow(tipOut, u, arrowSize)],
      labelAt: add2(outside, scale2(u, 10 * px)),
      text: `R ${formatLength(c.value)}`,
      description: 'Cote de rayon',
    };
  }
  return null;
}
