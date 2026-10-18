/**
 * Découpe laser (calculs purs, testables) : contour d'une face plate d'une pièce (à partir du
 * maillage, en 2D dans le plan de la face), compensation du trait de coupe (kerf), choix du
 * matériau, placement des pièces sur une ou plusieurs plaques de chaque matériau. Les écrivains
 * SVG et DXF sont dans `io/vector.ts`.
 */
import type { FabricationSettings, FaceRef, Id, LaserItem, LaserMaterial, LaserPlacement } from '../domain/model';
import { centered, loopBounds, nest, placeLoops, type Placement } from './nesting';
import { formatLength } from '../domain/units';
import type { FaceTag, MeshData } from '../geometry/kernel';
import { worldToFrame } from '../math/frame';
import { frameFromAxis } from '../math/mat4';
import { dot3, type Vec2, type Vec3 } from '../math/vec';
import type { Frame3D } from '../math/frame';

/** Contour fermé (polyligne, sans répéter le premier point). */
export type Loop = Vec2[];

export interface FlatOutline {
  /** Contour extérieur (sens trigonométrique) puis trous (sens horaire). */
  outer: Loop;
  holes: Loop[];
  /** Épaisseur de la pièce perpendiculairement à la face (mm). */
  thickness: number;
  /** Repère du plan du contour (coordonnées 2D du contour). */
  frame: Frame3D;
}

/** Ligne de pli d'une tôle (développé) : point, direction (3D) et angle du pli (degrés). */
export interface BendLine {
  point: Vec3;
  dir: Vec3;
  angle: number;
}

/**
 * Portions d'une droite (3D, projetée dans le plan du contour) qui sont dans la matière : la droite
 * est coupée par tous les bords (contour et trous), et on garde les morceaux dont le milieu est à
 * l'intérieur (règle pair-impair).
 */
export function clipLineToOutline(outline: Pick<FlatOutline, 'outer' | 'holes' | 'frame'>, point: Vec3, dir: Vec3): [Vec2, Vec2][] {
  const p = worldToFrame(outline.frame, point);
  const q = worldToFrame(outline.frame, { x: point.x + dir.x, y: point.y + dir.y, z: point.z + dir.z });
  const d = { x: q.x - p.x, y: q.y - p.y };
  const len = Math.hypot(d.x, d.y);
  if (len < 1e-12) return [];
  const loops = [outline.outer, ...outline.holes];
  const ts: number[] = [];
  for (const loop of loops)
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i]!;
      const b = loop[(i + 1) % loop.length]!;
      const e = { x: b.x - a.x, y: b.y - a.y };
      const den = d.x * e.y - d.y * e.x;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((a.x - p.x) * e.y - (a.y - p.y) * e.x) / den;
      const u = ((a.x - p.x) * d.y - (a.y - p.y) * d.x) / den;
      if (u >= -1e-9 && u <= 1 + 1e-9) ts.push(t);
    }
  ts.sort((x, y) => x - y);
  const at = (t: number) => ({ x: p.x + d.x * t, y: p.y + d.y * t });
  const inside = (pt: Vec2) => {
    let c = false;
    for (const loop of loops)
      for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
        const a = loop[i]!;
        const b = loop[j]!;
        if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) c = !c;
      }
    return c;
  };
  const out: [Vec2, Vec2][] = [];
  for (let i = 0; i + 1 < ts.length; i++) {
    if (ts[i + 1]! - ts[i]! < 1e-9) continue;
    if (inside(at((ts[i]! + ts[i + 1]!) / 2))) out.push([at(ts[i]!), at(ts[i + 1]!)]);
  }
  return out;
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
  return { outer, holes, thickness: max - min, frame: flip };
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
  materialId: Id;
  /** Rang de la plaque parmi celles de son matériau (0, 1, 2…). */
  sheet: number;
  /** Contours de découpe (déjà décalés du demi-trait de coupe), en coordonnées de la plaque (mm). */
  loops: Loop[];
  /** Position du nom gravé (centre de la pièce). */
  labelAt: Vec2;
  /** Tôle : lignes de pli (repères à graver), en coordonnées de la plaque. */
  bends?: { a: Vec2; b: Vec2; angle: number }[];
  /** Exemplaire (0, 1, 2…), placement (centre, angle) et contours centrés non tournés (plaques en grand). */
  copy: number;
  placement: { x: number; y: number; angle: number };
  local: Loop[];
}

/** Une « page » de découpe : un matériau, ses plaques et les pièces posées dessus. */
export interface MaterialLayout {
  material: LaserMaterial;
  sheets: number;
  placed: PlacedOutline[];
}

export interface LaserLayout {
  /** Dans l'ordre des matériaux des réglages (y compris ceux sans pièce). */
  materials: MaterialLayout[];
  /** Toutes les pièces posées, tous matériaux confondus. */
  placed: PlacedOutline[];
  warnings: string[];
  /** Épaisseur de chaque pièce (pour l'affichage). */
  thickness: Record<Id, number>;
  /** Matériau retenu pour chaque pièce. */
  materialOf: Record<Id, Id>;
}

/**
 * Matériau d'une pièce : celui choisi s'il existe encore, sinon celui dont l'épaisseur est la plus
 * proche de celle de la pièce (le premier en cas d'égalité).
 */
export function resolveMaterial(item: LaserItem, materials: readonly LaserMaterial[], thickness: number | null): LaserMaterial | null {
  const chosen = item.materialId ? materials.find((m) => m.id === item.materialId) : undefined;
  if (chosen) return chosen;
  if (materials.length === 0) return null;
  if (thickness === null) return materials[0]!;
  return materials.reduce((best, m) => (Math.abs(m.thickness - thickness) < Math.abs(best.thickness - thickness) - 1e-9 ? m : best));
}

/** Contours des pièces à découper, compensés et rangés sur les plaques de leur matériau. */
export function laserLayout(
  settings: FabricationSettings['laser'],
  parts: readonly { id: Id; name: string }[],
  meshOf: (partId: Id) => MeshData | null | undefined,
  /** Tôle : lignes de pli du développé (le maillage donné est alors celui de la tôle à plat). */
  bendsOf: (partId: Id) => readonly BendLine[] | undefined = () => undefined,
): LaserLayout {
  const warnings: string[] = [];
  const thickness: Record<Id, number> = {};
  const materialOf: Record<Id, Id> = {};
  type Entry = { partId: Id; name: string; copy: number; local: Loop[]; bends: { a: Vec2; b: Vec2; angle: number }[]; bw: number; bh: number };
  const entries = new Map<Id, Entry[]>(settings.materials.map((m) => [m.id, []]));
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
    const material = resolveMaterial(item, settings.materials, outline.thickness);
    if (!material) {
      if (item.copies > 0) warnings.push('Aucun matériau : ajoutez-en un pour découper les pièces.');
      continue;
    }
    materialOf[part.id] = material.id;
    if (item.copies <= 0) continue;
    if (Math.abs(outline.thickness - material.thickness) > 0.05) {
      warnings.push(`« ${part.name} » fait ${formatLength(outline.thickness)} d’épaisseur et le matériau « ${material.name} » ${formatLength(material.thickness)} : vérifiez.`);
    }
    const { w, h } = material.sheet;
    const half = material.kerf / 2;
    const { loops: local, center } = centered([offsetLoop(outline.outer, half), ...outline.holes.map((hole) => offsetLoop(hole, half))]);
    const b = loopBounds(local);
    const bw = b.maxX - b.minX;
    const bh = b.maxY - b.minY;
    if (Math.min(bw, bh) + 2 * settings.spacing > Math.min(w, h) || Math.max(bw, bh) + 2 * settings.spacing > Math.max(w, h)) {
      warnings.push(`« ${part.name} » (${Math.ceil(bw)} × ${Math.ceil(bh)} mm) est plus grande que les plaques de « ${material.name} » (${w} × ${h} mm).`);
      continue;
    }
    const bends = (bendsOf(part.id) ?? []).flatMap((bl) =>
      clipLineToOutline(outline, bl.point, bl.dir).map(([a, e]) => ({ a: { x: a.x - center.x, y: a.y - center.y }, b: { x: e.x - center.x, y: e.y - center.y }, angle: bl.angle })),
    );
    for (let copy = 0; copy < item.copies; copy++) {
      entries.get(material.id)!.push({ partId: part.id, name: item.copies > 1 ? `${part.name} ${copy + 1}` : part.name, copy, local, bends, bw, bh });
    }
  }
  const keyOf = (e: { partId: Id; copy: number }) => `${e.partId}#${e.copy}`;
  const materials = settings.materials.map((material) => {
    const list = entries.get(material.id) ?? [];
    const { w, h } = material.sheet;
    const placements = new Map<string, Placement>();
    const manual = new Map((material.placements ?? []).map((p) => [keyOf(p), p]));
    if (manual.size) {
      // Placements enregistrés (plaques en grand) ; les autres pièces se logent autour.
      const fixed: (Placement & { loops: Loop[] })[] = [];
      for (const e of list) {
        const m = manual.get(keyOf(e));
        if (!m) continue;
        const pl = { key: keyOf(e), sheet: m.sheet, x: m.x, y: m.y, angle: m.angle };
        placements.set(pl.key, pl);
        fixed.push({ ...pl, loops: e.local });
      }
      const rest = list.filter((e) => !placements.has(keyOf(e)));
      for (const pl of nest(rest.map((e) => ({ key: keyOf(e), loops: e.local })), material.sheet, settings.spacing, fixed)) placements.set(pl.key, pl);
    } else {
      // Rangement simple par rangées, dans l'ordre des pièces.
      const c = { sheet: 0, x: settings.spacing, y: settings.spacing, row: 0 };
      for (const e of list) {
        const rot = e.bw + 2 * settings.spacing > w ? 90 : 0;
        const bw = rot ? e.bh : e.bw;
        const bh = rot ? e.bw : e.bh;
        if (c.x + bw + settings.spacing > w) {
          c.x = settings.spacing;
          c.y += c.row + settings.spacing;
          c.row = 0;
        }
        if (c.y + bh + settings.spacing > h) {
          c.sheet++;
          c.x = settings.spacing;
          c.y = settings.spacing;
          c.row = 0;
        }
        placements.set(keyOf(e), { key: keyOf(e), sheet: c.sheet, x: c.x + bw / 2, y: c.y + bh / 2, angle: rot });
        c.x += bw + settings.spacing;
        c.row = Math.max(c.row, bh);
      }
    }
    const placed: PlacedOutline[] = list.flatMap((e) => {
      const p = placements.get(keyOf(e));
      if (!p) return [];
      const at = (q: Vec2) => placeLoops([[q]], p)[0]![0]!;
      return [
        {
          partId: e.partId,
          copy: e.copy,
          name: e.name,
          materialId: material.id,
          sheet: p.sheet,
          placement: { x: p.x, y: p.y, angle: p.angle },
          local: e.local,
          loops: placeLoops(e.local, p),
          labelAt: { x: p.x, y: p.y },
          ...(e.bends.length ? { bends: e.bends.map((bd) => ({ a: at(bd.a), b: at(bd.b), angle: bd.angle })) } : {}),
        },
      ];
    });
    if (placed.length < list.length) warnings.push(`« ${material.name} » : certaines pièces n’ont pas trouvé de place sur les plaques.`);
    const sheets = placed.length ? Math.max(...placed.map((x) => x.sheet)) + 1 : 0;
    return { material, sheets, placed };
  });
  return { materials, placed: materials.flatMap((g) => g.placed), warnings: [...new Set(warnings)], thickness, materialOf };
}

/** Placements « optimisés » de toutes les pièces d'un matériau (imbrication serrée, rotations). */
export function optimizedPlacements(layout: LaserLayout, materialId: Id, spacing: number): LaserPlacement[] {
  const g = layout.materials.find((m) => m.material.id === materialId);
  if (!g) return [];
  const byKey = new Map(g.placed.map((p) => [`${p.partId}#${p.copy}`, p]));
  return nest(
    g.placed.map((p) => ({ key: `${p.partId}#${p.copy}`, loops: p.local })),
    g.material.sheet,
    spacing,
  ).map((pl) => {
    const p = byKey.get(pl.key)!;
    return { partId: p.partId, copy: p.copy, sheet: pl.sheet, x: pl.x, y: pl.y, angle: pl.angle };
  });
}
