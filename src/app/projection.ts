/**
 * Arêtes et faces de la pièce que l'outil « Projeter » peut reprendre dans une esquisse, projetées
 * dans le repère de l'esquisse ; chaque arête est désignée de façon persistante par les deux faces
 * qui la bordent.
 */
import type { Id, Part } from '../domain/model';
import { pickFaceReference } from '../features/sketch/support';
import type { MeshData } from '../geometry/kernel';
import { signedDistanceToFrame, worldToFrame, type Frame3D } from '../math/frame';
import { ccwThrough, distance2, type Vec2 } from '../math/vec';
import { projectCircle, splineThrough } from '../sketch/projected';
import type { ProjectableCurve, ProjectableFace } from '../sketch/session';

const round = (v: number) => Math.round(v * 1e4) / 1e4;


/** Arêtes et faces de la pièce reprenables par Projeter. */
export interface ProjectableGeometry {
  curves: ProjectableCurve[];
  faces: ProjectableFace[];
}

/**
 * Arêtes de `part` reprenables dans l'esquisse `sketchId` ; `external` : `part` est une autre
 * pièce du projet (toutes ses arêtes, désignées avec son identifiant).
 */
export function projectableCurves(mesh: MeshData | null | undefined, frame: Frame3D, part: Part, sketchId: Id, external = false): ProjectableCurve[] {
  return projectableGeometry(mesh, frame, part, sketchId, external).curves;
}

/**
 * Arêtes et faces de `part` reprenables dans l'esquisse `sketchId`. Segments, cercles et arcs vus
 * de face gardent leur nature ; un cercle vu de biais devient une ellipse ; un arc vu de biais ou
 * une courbe libre devient une spline. Une face donne d'un clic toutes ses arêtes.
 */
export function projectableGeometry(mesh: MeshData | null | undefined, frame: Frame3D, part: Part, sketchId: Id, external = false): ProjectableGeometry {
  if (!mesh) return { curves: [], faces: [] };
  const order = new Map(part.features.map((f, i) => [f.id, i]));
  // Seules les faces créées avant l'esquisse peuvent être référencées (pas de boucle).
  const limit = external ? Infinity : (order.get(sketchId) ?? Infinity);
  const before = (featureId: Id) => external || (order.get(featureId) ?? Infinity) < limit;
  const own = external ? { partId: part.id } : {};
  const best = new Map<string, { curve: ProjectableCurve; depth: number }>();
  /** Clé de la courbe retenue pour chaque arête (null : arête vue par la tranche, non reprise). */
  const edgeKey = new Map<number, string | null>();
  const depthOf = (p: { x: number; y: number; z: number }) => Math.abs(signedDistanceToFrame(frame, p));
  mesh.edges.forEach((edge, index) => {
    if (edge.faces.length < 2) return;
    const refA = pickFaceReference(mesh.faces[edge.faces[0]!]?.tags ?? [], part);
    const refB = pickFaceReference(mesh.faces[edge.faces[1]!]?.tags ?? [], part);
    if (!refA || !refB || !before(refA.featureId) || !before(refB.featureId)) return;
    const ref = { faces: [refA, refB] as [typeof refA, typeof refB] };
    // Sommets de la polyligne de l'arête (premier, dernier, tous).
    const vertex3 = (k: number) => ({ x: mesh.edgePositions[3 * k]!, y: mesh.edgePositions[3 * k + 1]!, z: mesh.edgePositions[3 * k + 2]! });
    const polyline = () => {
      const out = [vertex3(edge.start)];
      for (let k = edge.start + 1; k < edge.start + edge.count; k += 2) out.push(vertex3(k));
      return out;
    };
    let curve: ProjectableCurve;
    let depth: number;
    let key: string;
    if (edge.line) {
      const a = worldToFrame(frame, edge.line.start);
      const b = worldToFrame(frame, edge.line.end);
      // Segment vu par la tranche (perpendiculaire au plan) : il se réduit à un point.
      if (distance2(a, b) < 1e-6) return edgeKey.set(index, null), undefined;
      curve = { kind: 'line', a, b, ref, ...own };
      depth = Math.max(depthOf(edge.line.start), depthOf(edge.line.end));
      const [p, q] = [a, b].sort((u, v) => u.x - v.x || u.y - v.y);
      key = `l|${round(p!.x)}|${round(p!.y)}|${round(q!.x)}|${round(q!.y)}`;
    } else if (edge.circle) {
      const projected = projectCircle(frame, edge.circle.center, edge.circle.axis, edge.circle.radius);
      if (!projected) return edgeKey.set(index, null), undefined;
      depth = depthOf(edge.circle.center);
      const first = worldToFrame(frame, vertex3(edge.start));
      const last = worldToFrame(frame, vertex3(edge.start + edge.count - 1));
      const full = edge.count < 2 || distance2(first, last) < Math.max(1e-6, edge.circle.radius * 1e-4);
      if (projected.kind === 'circle' && full) {
        curve = { kind: 'circle', center: projected.center, radius: projected.radius, ref, ...own };
        key = `c|${round(projected.center.x)}|${round(projected.center.y)}|${round(projected.radius)}`;
      } else if (projected.kind === 'circle') {
        // Arc vu de face : sens trigonométrique de `start` à `end`, celui qui passe par le milieu de l'arête.
        const mid = worldToFrame(frame, vertex3(edge.start + Math.floor(edge.count / 2)));
        const [start, end] = ccwThrough(projected.center, first, last, mid) ? [first, last] : [last, first];
        curve = { kind: 'arc', center: projected.center, radius: projected.radius, start, end, ref, ...own };
        key = `a|${round(projected.center.x)}|${round(projected.center.y)}|${round(projected.radius)}|${round(start.x)}|${round(start.y)}|${round(end.x)}|${round(end.y)}`;
      } else if (full) {
        curve = { kind: 'ellipse', center: projected.center, major: projected.major, minorRadius: projected.minorRadius, ref, ...own };
        key = `e|${round(projected.center.x)}|${round(projected.center.y)}|${round(projected.minorRadius)}|${round(Math.hypot(projected.major.x - projected.center.x, projected.major.y - projected.center.y))}`;
      } else {
        const sp = splineThrough(polyline(), frame);
        if (!sp) return edgeKey.set(index, null), undefined;
        curve = { kind: 'spline', points: sp.points, closed: sp.closed, ref, ...own };
        key = splineKey(sp.points);
      }
    } else {
      // Courbe libre : spline par des points de l'arête.
      const pts = polyline();
      const sp = splineThrough(pts, frame);
      if (!sp) return edgeKey.set(index, null), undefined;
      curve = { kind: 'spline', points: sp.points, closed: sp.closed, ref, ...own };
      depth = Math.max(...pts.map(depthOf));
      key = splineKey(sp.points);
    }
    edgeKey.set(index, key);
    // Plusieurs arêtes se projettent au même endroit (dessus et dessous d'une plaque) : on garde
    // la plus proche du plan de l'esquisse.
    const prev = best.get(key);
    if (!prev || depth < prev.depth - 1e-9) best.set(key, { curve, depth });
  });
  const keys = Array.from(best.keys());
  const indexOf = new Map(keys.map((k, i) => [k, i]));
  const curves = keys.map((k) => best.get(k)!.curve);
  // Faces : leurs arêtes, et le contour extérieur (la boucle d'arêtes la plus étendue).
  const faceEdges = new Map<number, number[]>();
  mesh.edges.forEach((edge, index) => {
    for (const f of edge.faces) faceEdges.set(f, [...(faceEdges.get(f) ?? []), index]);
  });
  const faces: ProjectableFace[] = [];
  mesh.faces.forEach((face, fi) => {
    const ref = pickFaceReference(face.tags, part);
    if (!ref || !before(ref.featureId)) return;
    const edges = faceEdges.get(fi) ?? [];
    const ids = new Set<number>();
    let skipped = 0;
    for (const e of edges) {
      const k = edgeKey.get(e);
      if (k === null) skipped++;
      else if (k !== undefined) ids.add(indexOf.get(k)!);
      else skipped++;
    }
    if (ids.size === 0) return;
    const triangles: number[] = [];
    let depth = Infinity;
    for (let t = face.start; t < face.start + face.count; t++) {
      const i = mesh.indices[t]! * 3;
      const p = { x: mesh.positions[i]!, y: mesh.positions[i + 1]!, z: mesh.positions[i + 2]! };
      const q = worldToFrame(frame, p);
      triangles.push(q.x, q.y);
      depth = Math.min(depth, depthOf(p));
    }
    const list = Array.from(ids);
    faces.push({ triangles, depth, curves: list, outer: outerLoop(list.map((i) => curves[i]!), list), skipped });
  });
  return { curves, faces };
}

const splineKey = (pts: readonly Vec2[]) => `s|${pts.map((p) => `${round(p.x)},${round(p.y)}`).join('|')}`;

/** Extrémités d'une courbe ouverte (aucune pour une courbe fermée). */
function endsOf(c: ProjectableCurve): Vec2[] {
  if (c.kind === 'line') return [c.a, c.b];
  if (c.kind === 'arc') return [c.start, c.end];
  if (c.kind === 'spline' && !c.closed) return [c.points[0]!, c.points[c.points.length - 1]!];
  return [];
}

/** Points d'une courbe, pour en mesurer l'étendue. */
function pointsOf(c: ProjectableCurve): Vec2[] {
  if (c.kind === 'line') return [c.a, c.b];
  if (c.kind === 'circle') return [{ x: c.center.x - c.radius, y: c.center.y - c.radius }, { x: c.center.x + c.radius, y: c.center.y + c.radius }];
  if (c.kind === 'arc') return [c.start, c.end, { x: c.center.x - c.radius, y: c.center.y - c.radius }, { x: c.center.x + c.radius, y: c.center.y + c.radius }];
  if (c.kind === 'ellipse') {
    const r = Math.hypot(c.major.x - c.center.x, c.major.y - c.center.y);
    return [{ x: c.center.x - r, y: c.center.y - r }, { x: c.center.x + r, y: c.center.y + r }];
  }
  return c.points;
}

/** Rangs des courbes de la boucle la plus étendue (le contour extérieur de la face). */
function outerLoop(curves: ProjectableCurve[], ids: number[]): number[] {
  // Boucles : courbes reliées par leurs extrémités (une courbe fermée est une boucle à elle seule).
  const parent = curves.map((_c, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const near = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-3;
  for (let i = 0; i < curves.length; i++) {
    for (let j = i + 1; j < curves.length; j++) {
      if (endsOf(curves[i]!).some((p) => endsOf(curves[j]!).some((q) => near(p, q)))) parent[find(i)] = find(j);
    }
  }
  const loops = new Map<number, number[]>();
  curves.forEach((_c, i) => loops.set(find(i), [...(loops.get(find(i)) ?? []), i]));
  let best: number[] = [];
  let bestArea = -1;
  for (const members of loops.values()) {
    const pts = members.flatMap((i) => pointsOf(curves[i]!));
    const area = (Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x))) * (Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y)));
    if (area > bestArea) {
      bestArea = area;
      best = members;
    }
  }
  return best.map((i) => ids[i]!);
}
