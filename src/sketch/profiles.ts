/**
 * Extraction des profils fermés d'une esquisse résolue, avec diagnostics compréhensibles.
 *
 * - Les extrémités de segments distantes de moins de `TOLERANCES.linear` sont confondues.
 * - Chaque sommet doit relier exactement deux segments (sinon contour ouvert ou ramifié).
 * - Les contours ne doivent ni se croiser eux-mêmes, ni se chevaucher entre eux.
 * - L'imbrication détermine la matière : profondeur paire = contour extérieur, impaire = trou.
 */
import { isConstructionCurve, type SketchParams } from '../domain/model';
import type { FeatureIssueCode } from '../domain/status';
import { TOLERANCES } from '../domain/tolerances';
import { cross2, distance2, distanceToSegment2, sub2, type Vec2 } from '../math/vec';
import { pointPosition } from './model';

export type ProfileSegment =
  | { kind: 'line'; entityId: string; start: Vec2; end: Vec2 }
  | { kind: 'circle'; entityId: string; center: Vec2; radius: number; clockwise: boolean }
  /** Arc parcouru de `start` à `end`, dans le sens horaire si `clockwise`. */
  | { kind: 'arc'; entityId: string; start: Vec2; end: Vec2; center: Vec2; radius: number; clockwise: boolean };

export interface ProfileLoop {
  segments: ProfileSegment[];
  /** Aire signée (positive = sens trigonométrique). */
  signedArea: number;
}

export interface ProfileRegion {
  outer: ProfileLoop;
  holes: ProfileLoop[];
  /** Aire de matière de la région (extérieur moins trous), en mm². */
  area: number;
}

export type ProfileResult =
  | { ok: true; regions: ProfileRegion[] }
  | { ok: false; code: FeatureIssueCode; points: string[]; positions: Vec2[] };

interface Node {
  position: Vec2;
  pointIds: string[];
  edges: number[];
}

interface Edge {
  entityId: string;
  n1: number;
  n2: number;
  /** Pour un arc : centre et rayon (parcouru de n1 à n2 dans le sens trigonométrique). */
  arc?: { center: Vec2; radius: number };
}

type LoopEdge = Extract<ProfileSegment, { kind: 'line' | 'arc' }>;

type RawLoop =
  /** `vertices` : polyligne fine (arcs subdivisés) pour les tests géométriques ; `edges` : courbes exactes. */
  | { kind: 'polygon'; vertices: Vec2[]; edges: LoopEdge[] }
  | { kind: 'circle'; entityId: string; center: Vec2; radius: number };

/** Ouverture signée d'un arc parcouru (positive dans le sens trigonométrique). */
function arcSweep(e: Extract<LoopEdge, { kind: 'arc' }>): number {
  const a0 = Math.atan2(e.start.y - e.center.y, e.start.x - e.center.x);
  const a1 = Math.atan2(e.end.y - e.center.y, e.end.x - e.center.x);
  let d = a1 - a0;
  if (e.clockwise) {
    while (d >= -1e-12) d -= Math.PI * 2;
    while (d < -Math.PI * 2) d += Math.PI * 2;
  } else {
    while (d <= 1e-12) d += Math.PI * 2;
    while (d > Math.PI * 2) d -= Math.PI * 2;
  }
  return d;
}

/** Points intermédiaires d'un arc (sans le point de départ), pour la polyligne de test. */
function arcSamples(e: Extract<LoopEdge, { kind: 'arc' }>): Vec2[] {
  const sweep = arcSweep(e);
  const n = Math.max(4, Math.ceil(Math.abs(sweep) / (Math.PI / 36)));
  const a0 = Math.atan2(e.start.y - e.center.y, e.start.x - e.center.x);
  const out: Vec2[] = [];
  for (let i = 1; i < n; i++) {
    const a = a0 + (sweep * i) / n;
    out.push({ x: e.center.x + e.radius * Math.cos(a), y: e.center.y + e.radius * Math.sin(a) });
  }
  return out;
}

/** Aire signée exacte d'un contour de segments et d'arcs (corde + segment circulaire). */
function exactArea(edges: LoopEdge[]): number {
  let a = 0;
  for (const e of edges) {
    a += (e.start.x * e.end.y - e.end.x * e.start.y) / 2;
    if (e.kind === 'arc') {
      const t = arcSweep(e);
      a += ((e.radius * e.radius) / 2) * (t - Math.sin(t));
    }
  }
  return a;
}

const tol = TOLERANCES.linear;

export function extractProfiles(sketch: SketchParams): ProfileResult {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const nodeFor = (pointId: string, position: Vec2): number => {
    const found = nodes.findIndex((n) => distance2(n.position, position) <= tol);
    if (found >= 0) {
      if (!nodes[found]!.pointIds.includes(pointId)) nodes[found]!.pointIds.push(pointId);
      return found;
    }
    nodes.push({ position, pointIds: [pointId], edges: [] });
    return nodes.length - 1;
  };

  const loops: RawLoop[] = [];
  for (const e of sketch.entities) {
    // Les traits de construction et la géométrie reprise de la pièce ne forment pas le volume.
    if ((e.type === 'circle' || e.type === 'line' || e.type === 'arc') && isConstructionCurve(e)) continue;
    if (e.type === 'arc') {
      const c = pointPosition(sketch, e.center);
      const a = pointPosition(sketch, e.start);
      const b = pointPosition(sketch, e.end);
      if (!c || !a || !b) continue;
      const radius = distance2(a, c);
      if (radius <= tol) continue;
      if (distance2(a, b) <= tol) {
        // Arc refermé sur lui-même : c'est un cercle complet.
        loops.push({ kind: 'circle', entityId: e.id, center: c, radius });
        continue;
      }
      const n1 = nodeFor(e.start, a);
      const n2 = nodeFor(e.end, b);
      const index = edges.length;
      edges.push({ entityId: e.id, n1, n2, arc: { center: c, radius } });
      nodes[n1]!.edges.push(index);
      nodes[n2]!.edges.push(index);
      continue;
    }
    if (e.type === 'circle') {
      const c = pointPosition(sketch, e.center);
      if (c && e.radius > tol) loops.push({ kind: 'circle', entityId: e.id, center: c, radius: e.radius });
    } else if (e.type === 'line') {
      const a = pointPosition(sketch, e.a);
      const b = pointPosition(sketch, e.b);
      if (!a || !b || distance2(a, b) <= tol) continue;
      const n1 = nodeFor(e.a, a);
      const n2 = nodeFor(e.b, b);
      const index = edges.length;
      edges.push({ entityId: e.id, n1, n2 });
      nodes[n1]!.edges.push(index);
      nodes[n2]!.edges.push(index);
    }
  }

  const dangling = nodes.filter((n) => n.edges.length === 1);
  if (dangling.length > 0) {
    return {
      ok: false,
      code: 'PROFILE_OPEN',
      points: dangling.map((n) => n.pointIds[0]!),
      positions: dangling.map((n) => n.position),
    };
  }
  const branched = nodes.filter((n) => n.edges.length > 2);
  if (branched.length > 0) {
    return {
      ok: false,
      code: 'PROFILE_BRANCHED',
      points: branched.map((n) => n.pointIds[0]!),
      positions: branched.map((n) => n.position),
    };
  }

  // Parcours des cycles (chaque sommet a exactement deux arêtes).
  const used = new Set<number>();
  for (let start = 0; start < edges.length; start++) {
    if (used.has(start)) continue;
    const vertices: Vec2[] = [];
    const loopEdges: LoopEdge[] = [];
    let edgeIndex = start;
    let fromNode = edges[start]!.n1;
    for (;;) {
      used.add(edgeIndex);
      const edge = edges[edgeIndex]!;
      const forward = edge.n1 === fromNode;
      const toNode = forward ? edge.n2 : edge.n1;
      const from = nodes[fromNode]!.position;
      const to = nodes[toNode]!.position;
      vertices.push(from);
      if (edge.arc) {
        const seg: LoopEdge = { kind: 'arc', entityId: edge.entityId, start: from, end: to, center: edge.arc.center, radius: edge.arc.radius, clockwise: !forward };
        loopEdges.push(seg);
        vertices.push(...arcSamples(seg));
      } else {
        loopEdges.push({ kind: 'line', entityId: edge.entityId, start: from, end: to });
      }
      const next = nodes[toNode]!.edges.find((i) => i !== edgeIndex && !used.has(i));
      if (next === undefined) break;
      edgeIndex = next;
      fromNode = toNode;
    }
    loops.push({ kind: 'polygon', vertices, edges: loopEdges });
  }

  if (loops.length === 0) return { ok: false, code: 'PROFILE_EMPTY', points: [], positions: [] };

  // Auto-intersections.
  for (const loop of loops) {
    if (loop.kind !== 'polygon') continue;
    const hit = polygonSelfIntersection(loop.vertices);
    if (hit) return { ok: false, code: 'PROFILE_SELF_INTERSECTING', points: [], positions: [hit] };
    if (Math.abs(exactArea(loop.edges)) <= tol * tol) {
      return { ok: false, code: 'PROFILE_SELF_INTERSECTING', points: [], positions: [loop.vertices[0]!] };
    }
  }
  // Chevauchements entre contours.
  for (let i = 0; i < loops.length; i++) {
    for (let j = i + 1; j < loops.length; j++) {
      const hit = loopsIntersect(loops[i]!, loops[j]!);
      if (hit) return { ok: false, code: 'PROFILE_OVERLAPPING', points: [], positions: [hit] };
    }
  }

  // Imbrication.
  const depth = loops.map((loop, i) =>
    loops.reduce((d, other, j) => (j !== i && loopContainsLoop(other, loop) ? d + 1 : d), 0),
  );
  const parent = loops.map((loop, i) => {
    let best = -1;
    loops.forEach((other, j) => {
      if (j !== i && depth[j] === depth[i]! - 1 && loopContainsLoop(other, loop)) best = j;
    });
    return best;
  });

  const regions: ProfileRegion[] = [];
  loops.forEach((loop, i) => {
    if (depth[i]! % 2 !== 0) return;
    const outer = orientLoop(loop, true);
    const holes = loops.flatMap((other, j) => (parent[j] === i ? [orientLoop(other, false)] : []));
    const area = Math.abs(outer.signedArea) - holes.reduce((s, h) => s + Math.abs(h.signedArea), 0);
    regions.push({ outer, holes, area });
  });
  return { ok: true, regions };
}

function orientLoop(loop: RawLoop, counterClockwise: boolean): ProfileLoop {
  if (loop.kind === 'circle') {
    const area = Math.PI * loop.radius * loop.radius;
    return {
      segments: [
        { kind: 'circle', entityId: loop.entityId, center: loop.center, radius: loop.radius, clockwise: !counterClockwise },
      ],
      signedArea: counterClockwise ? area : -area,
    };
  }
  const area = exactArea(loop.edges);
  const isCcw = area > 0;
  let segs: LoopEdge[] = loop.edges;
  if (isCcw !== counterClockwise) {
    segs = [...segs].reverse().map((s) => (s.kind === 'arc' ? { ...s, start: s.end, end: s.start, clockwise: !s.clockwise } : { ...s, start: s.end, end: s.start }));
  }
  return { segments: segs, signedArea: counterClockwise ? Math.abs(area) : -Math.abs(area) };
}

const orient = (a: Vec2, b: Vec2, c: Vec2) => cross2(sub2(b, a), sub2(c, a));

/** Intersection de deux segments (y compris contact), renvoie un point approximatif ou null. */
function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): Vec2 | null {
  const scale = Math.max(distance2(a, b), distance2(c, d), 1);
  const eps = tol * scale;
  const d1 = orient(c, d, a);
  const d2 = orient(c, d, b);
  const d3 = orient(a, b, c);
  const d4 = orient(a, b, d);
  if (((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) && ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps))) {
    const t = d1 / (d1 - d2);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }
  if (distanceToSegment2(a, c, d) <= tol) return a;
  if (distanceToSegment2(b, c, d) <= tol) return b;
  if (distanceToSegment2(c, a, b) <= tol) return c;
  if (distanceToSegment2(d, a, b) <= tol) return d;
  return null;
}

function polygonSelfIntersection(vertices: Vec2[]): Vec2 | null {
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const a = vertices[i]!;
    const b = vertices[(i + 1) % n]!;
    for (let j = i + 1; j < n; j++) {
      // Segments adjacents : ils partagent un sommet, on vérifie seulement le recouvrement.
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      const c = vertices[j]!;
      const d = vertices[(j + 1) % n]!;
      if (adjacent) {
        const shared = j === i + 1 ? b : a;
        const otherA = j === i + 1 ? a : b;
        const otherC = j === i + 1 ? d : c;
        // Repli sur lui-même : les deux segments sont colinéaires et de même direction depuis le sommet.
        const u = sub2(otherA, shared);
        const v = sub2(otherC, shared);
        if (Math.abs(cross2(u, v)) <= tol * Math.max(1, Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y)) && u.x * v.x + u.y * v.y > 0) {
          return shared;
        }
        continue;
      }
      const hit = segmentsIntersect(a, b, c, d);
      if (hit) return hit;
    }
  }
  return null;
}

function segmentCircleIntersect(a: Vec2, b: Vec2, center: Vec2, r: number): Vec2 | null {
  const dMin = distanceToSegment2(center, a, b);
  const dMax = Math.max(distance2(center, a), distance2(center, b));
  if (dMin <= r + tol && dMax >= r - tol) {
    // Point approximatif : l'extrémité ou le projeté le plus proche du cercle.
    return Math.abs(distance2(center, a) - r) < Math.abs(distance2(center, b) - r) ? a : b;
  }
  return null;
}

function loopsIntersect(l1: RawLoop, l2: RawLoop): Vec2 | null {
  if (l1.kind === 'circle' && l2.kind === 'circle') {
    const d = distance2(l1.center, l2.center);
    if (d <= l1.radius + l2.radius + tol && d >= Math.abs(l1.radius - l2.radius) - tol) {
      if (d <= tol && Math.abs(l1.radius - l2.radius) <= tol) return l1.center;
      if (d > tol) {
        const t = l1.radius / d;
        return { x: l1.center.x + (l2.center.x - l1.center.x) * t, y: l1.center.y + (l2.center.y - l1.center.y) * t };
      }
    }
    return null;
  }
  if (l1.kind === 'circle' || l2.kind === 'circle') {
    const circle = (l1.kind === 'circle' ? l1 : l2) as Extract<RawLoop, { kind: 'circle' }>;
    const poly = (l1.kind === 'polygon' ? l1 : l2) as Extract<RawLoop, { kind: 'polygon' }>;
    for (const [a, b] of denseSegments(poly)) {
      const hit = segmentCircleIntersect(a, b, circle.center, circle.radius);
      if (hit) return hit;
    }
    return null;
  }
  const s2 = denseSegments(l2);
  for (const [a, b] of denseSegments(l1)) {
    for (const [c, d] of s2) {
      const hit = segmentsIntersect(a, b, c, d);
      if (hit) return hit;
    }
  }
  return null;
}

/** Segments de la polyligne fine d'un contour (arcs subdivisés). */
function denseSegments(loop: Extract<RawLoop, { kind: 'polygon' }>): [Vec2, Vec2][] {
  return loop.vertices.map((v, i) => [v, loop.vertices[(i + 1) % loop.vertices.length]!] as [Vec2, Vec2]);
}

function pointInPolygon(p: Vec2, vertices: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const a = vertices[i]!;
    const b = vertices[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function samplePoint(loop: RawLoop): Vec2 {
  return loop.kind === 'circle' ? { x: loop.center.x + loop.radius, y: loop.center.y } : loop.vertices[0]!;
}

/** Vrai si `inner` est entièrement à l'intérieur de `outer` (les contours ne se coupent pas). */
function loopContainsLoop(outer: RawLoop, inner: RawLoop): boolean {
  const p = samplePoint(inner);
  if (outer.kind === 'circle') return distance2(p, outer.center) < outer.radius - tol;
  return pointInPolygon(p, outer.vertices);
}

export function profileArea(result: ProfileResult): number {
  return result.ok ? result.regions.reduce((s, r) => s + r.area, 0) : 0;
}
