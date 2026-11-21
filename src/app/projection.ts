/**
 * Arêtes de la pièce que l'outil « Projeter » peut reprendre dans une esquisse : segments et
 * cercles (dont l'axe est perpendiculaire au plan) projetés dans le repère de l'esquisse, chacun
 * désigné de façon persistante par les deux faces qui le bordent.
 */
import type { Id, Part } from '../domain/model';
import { pickFaceReference } from '../features/sketch/support';
import type { MeshData } from '../geometry/kernel';
import { signedDistanceToFrame, worldToFrame, type Frame3D } from '../math/frame';
import { ccwThrough, distance2, dot3 } from '../math/vec';
import type { ProjectableCurve } from '../sketch/session';

const round = (v: number) => Math.round(v * 1e4) / 1e4;


/**
 * Arêtes de `part` reprenables dans l'esquisse `sketchId` ; `external` : `part` est une autre
 * pièce du projet (toutes ses arêtes, désignées avec son identifiant).
 */
export function projectableCurves(mesh: MeshData | null | undefined, frame: Frame3D, part: Part, sketchId: Id, external = false): ProjectableCurve[] {
  if (!mesh) return [];
  const order = new Map(part.features.map((f, i) => [f.id, i]));
  // Seules les faces créées avant l'esquisse peuvent être référencées (pas de boucle).
  const limit = external ? Infinity : (order.get(sketchId) ?? Infinity);
  const before = (featureId: Id) => external || (order.get(featureId) ?? Infinity) < limit;
  const best = new Map<string, { curve: ProjectableCurve; depth: number }>();
  for (const edge of mesh.edges) {
    if (edge.faces.length < 2) continue;
    const refA = pickFaceReference(mesh.faces[edge.faces[0]!]?.tags ?? [], part);
    const refB = pickFaceReference(mesh.faces[edge.faces[1]!]?.tags ?? [], part);
    if (!refA || !refB || !before(refA.featureId) || !before(refB.featureId)) continue;
    const ref = { faces: [refA, refB] as [typeof refA, typeof refB] };
    let curve: ProjectableCurve;
    let depth: number;
    let key: string;
    if (edge.line) {
      const a = worldToFrame(frame, edge.line.start);
      const b = worldToFrame(frame, edge.line.end);
      if (distance2(a, b) < 1e-6) continue;
      curve = { kind: 'line', a, b, ref, ...(external ? { partId: part.id } : {}) };
      depth = Math.max(Math.abs(signedDistanceToFrame(frame, edge.line.start)), Math.abs(signedDistanceToFrame(frame, edge.line.end)));
      const [p, q] = [a, b].sort((u, v) => u.x - v.x || u.y - v.y);
      key = `l|${round(p!.x)}|${round(p!.y)}|${round(q!.x)}|${round(q!.y)}`;
    } else if (edge.circle && Math.abs(Math.abs(dot3(edge.circle.axis, frame.normal)) - 1) < 1e-6) {
      const center = worldToFrame(frame, edge.circle.center);
      depth = Math.abs(signedDistanceToFrame(frame, edge.circle.center));
      // Extrémités de l'arête (premier et dernier sommet de sa polyligne) : confondues pour un cercle complet.
      const vertex = (k: number) => {
        const i = 3 * k;
        return worldToFrame(frame, { x: mesh.edgePositions[i]!, y: mesh.edgePositions[i + 1]!, z: mesh.edgePositions[i + 2]! });
      };
      const first = vertex(edge.start);
      const last = vertex(edge.start + edge.count - 1);
      if (edge.count < 2 || distance2(first, last) < Math.max(1e-6, edge.circle.radius * 1e-4)) {
        curve = { kind: 'circle', center, radius: edge.circle.radius, ref, ...(external ? { partId: part.id } : {}) };
        key = `c|${round(center.x)}|${round(center.y)}|${round(edge.circle.radius)}`;
      } else {
        // Arc : sens trigonométrique de `start` à `end`, celui qui passe par le milieu de l'arête.
        const mid = vertex(edge.start + Math.floor(edge.count / 2));
        const [start, end] = ccwThrough(center, first, last, mid) ? [first, last] : [last, first];
        curve = { kind: 'arc', center, radius: edge.circle.radius, start, end, ref, ...(external ? { partId: part.id } : {}) };
        key = `a|${round(center.x)}|${round(center.y)}|${round(edge.circle.radius)}|${round(start.x)}|${round(start.y)}|${round(end.x)}|${round(end.y)}`;
      }
    } else continue;
    // Plusieurs arêtes se projettent au même endroit (dessus et dessous d'une plaque) : on garde
    // la plus proche du plan de l'esquisse.
    const prev = best.get(key);
    if (!prev || depth < prev.depth - 1e-9) best.set(key, { curve, depth });
  }
  return Array.from(best.values(), (v) => v.curve);
}
