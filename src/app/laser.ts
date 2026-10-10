/**
 * Découpe laser (calculs purs, testables) : contour d'une face plate d'une pièce (à partir du
 * maillage, en 2D dans le plan de la face), compensation du trait de coupe (kerf), placement des
 * pièces sur une ou plusieurs plaques. Les écrivains SVG et DXF sont dans `io/vector.ts`.
 */
import type { FabricationSettings, FaceRef, Id, LaserItem } from '../domain/model';
import { formatLength } from '../domain/units';
import type { FaceTag, MeshData } from '../geometry/kernel';
import { worldToFrame } from '../math/frame';
import { frameFromAxis } from '../math/mat4';
import { dot3, type Vec2 } from '../math/vec';

/** Contour fermé (polyligne, sans répéter le premier point). */
export type Loop = Vec2[];

export interface FlatOutline {
  /** Contour extérieur (sens trigonométrique) puis trous (sens horaire). */
  outer: Loop;
  holes: Loop[];
  /** Épaisseur de la pièce perpendiculairement à la face (mm). */
  thickness: number;
}

const sameTag = (t: FaceTag, r: FaceRef) =>
  t.featureId === r.featureId && t.role === r.role && (t.entityId ?? null) === (r.entityId ?? null) && (t.index ?? null) === (r.index ?? null);

/** Rang de la face plate désignée par une référence (−1 si elle n'existe plus). */
export function findPlanarFace(mesh: MeshData, ref: FaceRef): number {
  return mesh.faces.findIndex((f) => f.plane && f.tags.some((t) => sameTag(t, ref)));
}

export function loopArea(loop: Loop): number {
  let a = 0;
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i]!;
    const q = loop[(i + 1) % loop.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** Face plate la plus grande d'un maillage (choix par défaut du contour à découper). */
export function largestPlanarFace(mesh: MeshData): number {
  let best = -1;
  let area = -1;
  mesh.faces.forEach((f, i) => {
    if (f.plane && f.area > area) {
      best = i;
      area = f.area;
    }
  });
  return best;
}

/**
 * Contour d'une face plate : arêtes du maillage qui bordent la face, projetées dans son plan
 * (repère d'axe Z = normale) puis chaînées en boucles fermées.
 */
export function faceOutline(mesh: MeshData, faceIndex: number): FlatOutline | null {
  const face = mesh.faces[faceIndex];
  if (!face?.plane) return null;
  const frame = frameFromAxis(face.plane.origin, face.plane.normal);
  // Regard depuis l'extérieur de la face : on retourne l'axe X pour garder un contour non inversé.
  const flip = { ...frame, xAxis: { x: -frame.xAxis.x, y: -frame.xAxis.y, z: -frame.xAxis.z } };
  const segs: [Vec2, Vec2][] = [];
  const pos = mesh.edgePositions;
  for (const e of mesh.edges) {
    if (!e.faces.includes(faceIndex)) continue;
    for (let k = e.start; k < e.start + e.count; k += 2) {
      const a = worldToFrame(flip, { x: pos[k * 3]!, y: pos[k * 3 + 1]!, z: pos[k * 3 + 2]! });
      const b = worldToFrame(flip, { x: pos[k * 3 + 3]!, y: pos[k * 3 + 4]!, z: pos[k * 3 + 5]! });
      if (Math.hypot(b.x - a.x, b.y - a.y) > 1e-9) segs.push([a, b]);
    }
  }
  const loops = chainLoops(segs);
  if (loops.length === 0) return null;
  loops.sort((p, q) => Math.abs(loopArea(q)) - Math.abs(loopArea(p)));
  const [outerRaw, ...holesRaw] = loops;
  const outer = loopArea(outerRaw!) < 0 ? [...outerRaw!].reverse() : outerRaw!;
  const holes = holesRaw.map((h) => (loopArea(h) > 0 ? [...h].reverse() : h));
  // Épaisseur : étendue des sommets le long de la normale.
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const d = dot3({ x: mesh.positions[i]!, y: mesh.positions[i + 1]!, z: mesh.positions[i + 2]! }, face.plane.normal);
    min = Math.min(min, d);
    max = Math.max(max, d);
  }
  return { outer, holes, thickness: max - min };
}

/** Chaîne des segments (extrémités confondues à 1 µm près) en boucles fermées. */
export function chainLoops(segs: [Vec2, Vec2][], tol = 1e-3): Loop[] {
  const key = (p: Vec2) => `${Math.round(p.x / tol)},${Math.round(p.y / tol)}`;
  const adjacency = new Map<string, number[]>();
  segs.forEach(([a, b], i) => {
    for (const p of [a, b]) {
      const k = key(p);
      const list = adjacency.get(k);
      if (list) list.push(i);
      else adjacency.set(k, [i]);
    }
  });
  const used = new Set<number>();
  const loops: Loop[] = [];
  for (let i = 0; i < segs.length; i++) {
    if (used.has(i)) continue;
    used.add(i);
    const loop: Loop = [segs[i]![0]];
    let current = segs[i]![1];
    const startKey = key(segs[i]![0]);
    for (let guard = 0; guard < segs.length; guard++) {
      if (key(current) === startKey) break;
      loop.push(current);
      const next = (adjacency.get(key(current)) ?? []).find((j) => !used.has(j));
      if (next === undefined) break;
      used.add(next);
      const [a, b] = segs[next]!;
      current = key(a) === key(current) ? b : a;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

/**
 * Décale une boucle vers la droite du sens de parcours de `d` mm (onglets limités) : pour un
 * contour extérieur (trigonométrique) c'est vers l'extérieur, pour un trou (horaire) vers le
 * centre du trou. Sert à compenser la demi-largeur du trait de coupe.
 */
export function offsetLoop(loop: Loop, d: number): Loop {
  if (Math.abs(d) < 1e-12) return loop;
  const n = loop.length;
  return loop.map((p, i) => {
    const prev = loop[(i - 1 + n) % n]!;
    const next = loop[(i + 1) % n]!;
    const d1 = norm({ x: p.x - prev.x, y: p.y - prev.y });
    const d2 = norm({ x: next.x - p.x, y: next.y - p.y });
    // Normales à droite du parcours.
    const n1 = { x: d1.y, y: -d1.x };
    const n2 = { x: d2.y, y: -d2.x };
    const bis = norm({ x: n1.x + n2.x, y: n1.y + n2.y });
    const cos = bis.x * n1.x + bis.y * n1.y;
    const k = d / Math.max(cos, 0.25);
    return { x: p.x + bis.x * k, y: p.y + bis.y * k };
  });
}

function norm(v: Vec2): Vec2 {
  const l = Math.hypot(v.x, v.y);
  return l > 1e-12 ? { x: v.x / l, y: v.y / l } : { x: 0, y: 0 };
}

export interface PlacedOutline {
  partId: Id;
  name: string;
  sheet: number;
  /** Contours de découpe (déjà décalés du demi-trait de coupe), en coordonnées de la plaque (mm). */
  loops: Loop[];
  /** Position du nom gravé (centre de la pièce). */
  labelAt: Vec2;
}

export interface LaserLayout {
  sheets: number;
  placed: PlacedOutline[];
  warnings: string[];
  /** Épaisseur de chaque pièce (pour l'affichage). */
  thickness: Record<Id, number>;
}

/** Contours des pièces à découper, compensés et rangés sur une ou plusieurs plaques. */
export function laserLayout(
  settings: FabricationSettings['laser'],
  parts: readonly { id: Id; name: string }[],
  meshOf: (partId: Id) => MeshData | null | undefined,
): LaserLayout {
  const placed: PlacedOutline[] = [];
  const warnings: string[] = [];
  const thickness: Record<Id, number> = {};
  const { w, h } = settings.sheet;
  let sheet = 0;
  let x = settings.spacing;
  let y = settings.spacing;
  let rowHeight = 0;
  for (const item of settings.items as LaserItem[]) {
    const part = parts.find((p) => p.id === item.partId);
    const mesh = meshOf(item.partId);
    if (!part || !mesh) continue;
    const faceIndex = item.face ? findPlanarFace(mesh, item.face) : largestPlanarFace(mesh);
    if (item.copies > 0 && faceIndex < 0) {
      warnings.push(`« ${part.name} » : la face choisie pour le contour n’existe plus ; choisissez-en une autre.`);
      continue;
    }
    const outline = faceIndex >= 0 ? faceOutline(mesh, faceIndex) : null;
    if (!outline) continue;
    thickness[part.id] = outline.thickness;
    if (item.copies <= 0) continue;
    if (Math.abs(outline.thickness - settings.thickness) > 0.05) {
      warnings.push(`« ${part.name} » fait ${formatLength(outline.thickness)} d’épaisseur et le matériau ${formatLength(settings.thickness)} : vérifiez.`);
    }
    const half = settings.kerf / 2;
    const loops = [offsetLoop(outline.outer, half), ...outline.holes.map((hole) => offsetLoop(hole, half))];
    const xs = loops[0]!.map((p) => p.x);
    const ys = loops[0]!.map((p) => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const bw = Math.max(...xs) - minX;
    const bh = Math.max(...ys) - minY;
    if (bw + 2 * settings.spacing > w || bh + 2 * settings.spacing > h) {
      warnings.push(`« ${part.name} » (${Math.ceil(bw)} × ${Math.ceil(bh)} mm) est plus grande que la plaque.`);
      continue;
    }
    for (let copy = 0; copy < item.copies; copy++) {
      if (x + bw + settings.spacing > w) {
        x = settings.spacing;
        y += rowHeight + settings.spacing;
        rowHeight = 0;
      }
      if (y + bh + settings.spacing > h) {
        sheet++;
        x = settings.spacing;
        y = settings.spacing;
        rowHeight = 0;
      }
      const dx = x - minX;
      const dy = y - minY;
      placed.push({
        partId: part.id,
        name: item.copies > 1 ? `${part.name} ${copy + 1}` : part.name,
        sheet,
        loops: loops.map((l) => l.map((p) => ({ x: p.x + dx, y: p.y + dy }))),
        labelAt: { x: x + bw / 2, y: y + bh / 2 },
      });
      x += bw + settings.spacing;
      rowHeight = Math.max(rowHeight, bh);
    }
  }
  return { sheets: placed.length ? sheet + 1 : 0, placed, warnings, thickness };
}
