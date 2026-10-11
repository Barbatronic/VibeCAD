/**
 * Visserie de l'assemblage (calculs purs, testables) : maillage d'affichage des vis, écrous et
 * rondelles (sans filetage), trou visé par un clic (diamètre, profondeur, taille qui convient),
 * placement dans l'assemblage (empilement sur un même bord de trou), regroupement pour la liste et
 * la nomenclature. Les dimensions viennent des normes (`domain/fasteners.ts`).
 */
import {
  designation,
  fastenerType,
  holeMatches,
  HOLES,
  matchCountersink,
  nominal,
  sizesOf,
  suggestedLength,
  type FastenerKind,
  type HoleMatch,
  type MetricSize,
} from '../domain/fasteners';
import type { Assembly, AssemblyFastener, EdgeRef, Id, Part } from '../domain/model';
import type { EdgeMeshInfo, FaceMeshInfo, MeshData } from '../geometry/kernel';
import { frameMatrix4, multiply4, rotationX4, translation4, type Mat4 } from '../math/mat4';
import { dot3, sub3, type Vec3 } from '../math/vec';
import { edgesMatching, lcsFrame } from './assembly';
import { edgeRefFromPick } from './edges';

/** Clé six pans (mm) des vis à six pans creux. */
const SOCKET: Partial<Record<FastenerKind, Partial<Record<MetricSize, number>>>> = {
  iso4762: { M2: 1.5, 'M2.5': 2, M3: 2.5, M4: 3, M5: 4, M6: 5, M8: 6, M10: 8, M12: 10 },
  iso7380: { M3: 2, M4: 2.5, M5: 3, M6: 4, M8: 5, M10: 6, M12: 8 },
  iso10642: { M3: 2, M4: 2.5, M5: 3, M6: 4, M8: 5, M10: 6, M12: 8 },
};

/** Couleur d'affichage de la visserie (acier). */
export const FASTENER_COLOR = '#9aa4ae';

// ---------------------------------------------------------------------------
// Maillage

/** Anneau du profil : rayon (apothème si hexagonal) à la hauteur z ; `soft` : pas d'arête dessinée. */
interface Ring {
  r: number;
  z: number;
  /** Hexagone d'apothème `r` (sinon cercle de rayon `r`). */
  hex?: boolean;
  /** Hexagone rogné par un cercle de ce rayon (chanfrein à 30° d'un écrou : coins coupés en arcs). */
  clip?: number;
  /** Chanfrein : sens (+1 vers le haut, −1 vers le bas) de la normale du cône. */
  cone?: 1 | -1;
  /** Premier anneau d'un chanfrein d'hexagone : de quoi dessiner les arcs où le cône coupe les pans. */
  arcs?: { s: number; from: number; dir: 1 | -1 };
  soft?: boolean;
}

/** Points par anneau : 12 par côté d'hexagone, assez pour les arcs du chanfrein. */
const N = 72;

/** Rayon, dans la direction `a`, d'un hexagone d'apothème `apothem` (plats vers 0°, 60°…). */
function hexRadius(apothem: number, a: number): number {
  return apothem / Math.cos(((a + Math.PI / 6) % (Math.PI / 3)) - Math.PI / 6);
}

function ringPoints(ring: Ring): Vec3[] {
  const pts: Vec3[] = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    // Hexagone : plats tournés vers 0°, 60°… ; sommets à 30°, 90°… (multiples de 5° : sommets exacts).
    const hex = ring.hex ? hexRadius(ring.r, a) : ring.r;
    const r = ring.clip !== undefined ? Math.min(hex, ring.clip) : hex;
    pts.push({ x: r * Math.cos(a), y: r * Math.sin(a), z: ring.z });
  }
  return pts;
}

/**
 * Surface de révolution (ou à pans) d'un profil d'anneaux : chaque bande entre deux anneaux est une
 * face ; un rayon nul ferme le profil en éventail. `closed` relie le dernier anneau au premier (écrou,
 * rondelle : pièces percées).
 */
function profileMesh(rings: Ring[], closed: boolean): MeshData {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const faces: FaceMeshInfo[] = [];
  const edgePositions: number[] = [];
  const edges: EdgeMeshInfo[] = [];
  const pts = rings.map(ringPoints);
  const bands = closed ? rings.length : rings.length - 1;
  for (let b = 0; b < bands; b++) {
    const A = pts[b]!;
    const B = pts[(b + 1) % rings.length]!;
    const start = indices.length;
    const base = positions.length / 3;
    let area = 0;
    for (let i = 0; i < N; i++) {
      const prev = (i + N - 1) % N;
      const next = (i + 1) % N;
      // Normale = tangente de l'anneau × direction du profil (vers l'extérieur de la matière) ;
      // au centre d'un éventail, la tangente est prise sur l'autre anneau.
      const along = sub3(B[i]!, A[i]!);
      for (const [P, Q, R] of [
        [A, B, rings[b]!],
        [B, A, rings[(b + 1) % rings.length]!],
      ] as const) {
        const p = P[i]!;
        positions.push(p.x, p.y, p.z);
        // Chanfrein d'hexagone : normale exacte, celle du cône là où il rogne l'hexagone, sinon
        // celle du pan (le maillage seul donnerait des dents de scie).
        if (rings[b]!.clip !== undefined && rings[(b + 1) % rings.length]!.clip !== undefined) {
          const a = (i / N) * Math.PI * 2;
          const onCone = !!R.cone && Math.hypot(p.x, p.y) < hexRadius(R.r, a) - 1e-9;
          const flat = Math.round(a / (Math.PI / 3)) * (Math.PI / 3);
          if (onCone) normals.push(0.5 * Math.cos(a), 0.5 * Math.sin(a), R.cone! * Math.cos(Math.PI / 6));
          else normals.push(Math.cos(flat), Math.sin(flat), 0);
          continue;
        }
        const ring = P[next]!.x === P[prev]!.x && P[next]!.y === P[prev]!.y ? Q : P;
        const around = sub3(ring[next]!, ring[prev]!);
        const n = { x: around.y * along.z - around.z * along.y, y: around.z * along.x - around.x * along.z, z: around.x * along.y - around.y * along.x };
        const l = Math.hypot(n.x, n.y, n.z) || 1;
        normals.push(n.x / l, n.y / l, n.z / l);
      }
    }
    // Sommets : 2 par angle (A puis B).
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      const a0 = base + 2 * i;
      const b0 = a0 + 1;
      const a1 = base + 2 * j;
      const b1 = a1 + 1;
      // Un anneau de rayon nul (centre) rend un des deux triangles plat : il est omis.
      if (rings[(b + 1) % rings.length]!.r > 0) indices.push(a0, b1, b0);
      if (rings[b]!.r > 0) indices.push(a0, a1, b1);
      const tri = (u: number, v: number, w: number) => {
        const P = (k: number) => ({ x: positions[3 * k]!, y: positions[3 * k + 1]!, z: positions[3 * k + 2]! });
        const e1 = sub3(P(v), P(u));
        const e2 = sub3(P(w), P(u));
        return Math.hypot(e1.y * e2.z - e1.z * e2.y, e1.z * e2.x - e1.x * e2.z, e1.x * e2.y - e1.y * e2.x) / 2;
      };
      area += tri(a0, b1, b0) + tri(a0, a1, b1);
    }
    // Pans droits d'un hexagone : ombrage plat, une normale par triangle ; sinon les coins
    // paraîtraient arrondis.
    const ringA = rings[b]!;
    const ringB = rings[(b + 1) % rings.length]!;
    if (ringA.hex && ringB.hex && ringA.clip === undefined && ringB.clip === undefined) {
      const tris = indices.splice(start);
      for (let k = 0; k < tris.length; k += 3) {
        const P = (v: number) => ({ x: positions[3 * v]!, y: positions[3 * v + 1]!, z: positions[3 * v + 2]! });
        const [u, v, w] = [P(tris[k]!), P(tris[k + 1]!), P(tris[k + 2]!)];
        const e1 = sub3(v, u);
        const e2 = sub3(w, u);
        const n = { x: e1.y * e2.z - e1.z * e2.y, y: e1.z * e2.x - e1.x * e2.z, z: e1.x * e2.y - e1.y * e2.x };
        const l = Math.hypot(n.x, n.y, n.z) || 1;
        for (const q of [u, v, w]) {
          indices.push(positions.length / 3);
          positions.push(q.x, q.y, q.z);
          normals.push(n.x / l, n.y / l, n.z / l);
        }
      }
    }
    faces.push({ start, count: indices.length - start, tags: [], surface: 'other', area });
  }
  // Arêtes : les anneaux qui marquent un pli (bord de tête, de tige, d'empreinte).
  rings.forEach((ring, k) => {
    if (ring.soft || ring.r <= 0) return;
    const before = closed ? (k + rings.length - 1) % rings.length : k - 1;
    const after = closed || k < rings.length - 1 ? k % bands : -1;
    const start = edgePositions.length / 3;
    const p = pts[k]!;
    for (let i = 0; i < N; i++) {
      const a = p[i]!;
      const b = p[(i + 1) % N]!;
      edgePositions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    edges.push({
      start,
      count: 2 * N,
      faces: [before, after].filter((f) => f >= 0),
      curve: ring.hex ? 'other' : 'circle',
      length: 2 * Math.PI * ring.r,
      ...(ring.hex ? {} : { circle: { center: { x: 0, y: 0, z: ring.z }, axis: { x: 0, y: 0, z: 1 }, radius: ring.r } }),
    });
  });
  const polyline = (segments: number[]) => {
    if (segments.length === 0) return;
    const start = edgePositions.length / 3;
    edgePositions.push(...segments);
    let length = 0;
    for (let k = 0; k < segments.length; k += 6) length += Math.hypot(segments[k + 3]! - segments[k]!, segments[k + 4]! - segments[k + 1]!, segments[k + 5]! - segments[k + 2]!);
    edges.push({ start, count: segments.length / 3, faces: [], curve: 'other', length });
  };
  // Arêtes des coins d'un hexagone, là où ils ne sont pas coupés par un chanfrein.
  for (let b = 0; b < bands; b++) {
    const ra = rings[b]!;
    const rb = rings[(b + 1) % rings.length]!;
    if (!ra.hex || !rb.hex) continue;
    const segments: number[] = [];
    for (let i = N / 12; i < N; i += N / 6) {
      const a = (i / N) * Math.PI * 2;
      const whole = (r: Ring) => r.clip === undefined || r.clip >= hexRadius(r.r, a) - 1e-9;
      if (!whole(ra) || !whole(rb)) continue;
      const p = pts[b]![i]!;
      const q = pts[(b + 1) % rings.length]![i]!;
      segments.push(p.x, p.y, p.z, q.x, q.y, q.z);
    }
    polyline(segments);
  }
  // Arcs des chanfreins : sur chaque pan, la courbe où le cône à 30° coupe le plan du pan.
  for (const ring of rings) {
    if (!ring.arcs) continue;
    const { s: across, from, dir } = ring.arcs;
    const segments: number[] = [];
    const steps = 24;
    for (let k = 0; k < 6; k++) {
      const phi = (k * Math.PI) / 3;
      let prev: Vec3 | null = null;
      for (let j = 0; j <= steps; j++) {
        const a = phi - Math.PI / 6 + (j * Math.PI) / 3 / steps;
        const r = across / 2 / Math.cos(a - phi);
        const p = { x: r * Math.cos(a), y: r * Math.sin(a), z: from + dir * (r - 0.45 * across) * Math.tan(Math.PI / 6) };
        if (prev) segments.push(prev.x, prev.y, prev.z, p.x, p.y, p.z);
        prev = p;
      }
    }
    polyline(segments);
  }
  return {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    indices: Uint32Array.from(indices),
    faces,
    edgePositions: Float32Array.from(edgePositions),
    edges,
  };
}

/** Empreinte six pans creux (clé `s`) au sommet `top` d'une tête, profonde de `depth`, entrée chanfreinée. */
function socketRings(s: number, top: number, depth: number): Ring[] {
  const e = s / Math.sqrt(3);
  return [
    { r: e + 0.08 * s, z: top },
    { r: s / 2, z: top - 0.12 * s, hex: true },
    { r: s / 2, z: top - depth, hex: true },
    { r: 0, z: top - depth },
  ];
}

/**
 * Chanfrein à 30° d'un hexagone (écrou, tête H) : de la face d'appui ronde (Ø 0,9 × s) au prisme
 * complet ; entre les deux, les pans gardent des arcs. `from` : hauteur de la face, `dir` : +1 si la
 * matière est au-dessus (face du bas), −1 sinon. Anneaux rangés par z croissant.
 */
function hexChamfer(s: number, from: number, dir: 1 | -1): Ring[] {
  const rw = 0.45 * s;
  const e = s / Math.sqrt(3);
  const tan30 = Math.tan(Math.PI / 6);
  // Cône seul jusqu'à l'apothème, puis assez d'anneaux pour suivre les arcs sur les pans.
  const clips = [rw, 0.5 * s, ...Array.from({ length: 8 }, (_, k) => 0.5 * s + ((e - 0.5 * s) * (k + 1)) / 8)];
  const cone = dir > 0 ? -1 : 1;
  const rings = clips.map((c, i): Ring => ({ r: s / 2, hex: true, clip: c, cone, z: from + dir * (c - rw) * tan30, ...(i > 0 ? { soft: true } : { arcs: { s, from, dir } }) }));
  return dir > 0 ? rings : rings.reverse();
}

/**
 * Profil dans le repère de l'élément : axe +Z vers l'extérieur de la pièce (côté tête), tige vers −Z.
 * Vis : la face d'appui de la tête est en z = 0 ; tête fraisée : le dessus de la tête est en z = 0.
 * Pas de filetage ; chanfreins comme sur les vraies pièces (bout de tige, bords de tête, écrous).
 */
export function fastenerProfile(kind: FastenerKind, size: MetricSize, length = 0): { rings: Ring[]; closed: boolean } {
  const t = fastenerType(kind);
  const dims = t.dims[size]!;
  const R = nominal(size) / 2;
  const s = SOCKET[kind]?.[size] ?? R;
  // Tige avec un chanfrein à 45° au bout.
  const tip = 0.15 * R + 0.1;
  const shank = (bottom: number, top: number): Ring[] => [
    { r: 0, z: bottom },
    { r: R - tip, z: bottom },
    { r: R, z: bottom + tip },
    { r: R, z: top },
  ];
  switch (t.shape) {
    case 'socket': {
      const c = 0.06 * dims.d;
      return {
        rings: [...shank(-length, 0), { r: dims.d / 2, z: 0 }, { r: dims.d / 2, z: dims.k - c }, { r: dims.d / 2 - c, z: dims.k }, ...socketRings(s, dims.k, 0.55 * dims.k)],
        closed: false,
      };
    }
    case 'button': {
      // Tête bombée : quart d'ellipse jusqu'au bord de l'empreinte.
      const rings: Ring[] = [...shank(-length, 0), { r: dims.d / 2, z: 0 }];
      const rTop = s / Math.sqrt(3) + Math.max(0.3, 0.14 * s);
      const steps = 6;
      for (let i = 1; i <= steps; i++) {
        const r = dims.d / 2 - ((dims.d / 2 - rTop) * i) / steps;
        const z = (dims.k * Math.sqrt(Math.max(0, 1 - (r / (dims.d / 2)) ** 2))) / Math.sqrt(Math.max(1e-9, 1 - (rTop / (dims.d / 2)) ** 2));
        rings.push({ r, z: Math.min(dims.k, z), soft: i < steps });
      }
      return { rings: [...rings, ...socketRings(s, dims.k, 0.6 * dims.k)], closed: false };
    }
    case 'countersunk': {
      // Petit bord cylindrique en haut de la tête, comme sur les vraies vis fraisées.
      const land = 0.08 * dims.k;
      return { rings: [...shank(-length, -dims.k), { r: dims.d / 2, z: -land }, { r: dims.d / 2, z: 0 }, ...socketRings(s, 0, 0.6 * dims.k)], closed: false };
    }
    case 'hex':
      // Tête H : pans droits (anneau rogné au rayon des coins, sans effet) puis chanfrein du dessus.
      return { rings: [...shank(-length, 0), { r: dims.d / 2, z: 0, hex: true, clip: dims.d / Math.sqrt(3) }, ...hexChamfer(dims.d, dims.k, -1), { r: 0, z: dims.k }], closed: false };
    case 'nut': {
      // Écrou : double chanfrein à 30°, entrée du taraudage chanfreinée des deux côtés.
      const cs = 0.12 * R + 0.1;
      return {
        rings: [{ r: R + cs, z: 0 }, ...hexChamfer(dims.d, 0, 1), ...hexChamfer(dims.d, dims.k, -1), { r: R + cs, z: dims.k }, { r: R, z: dims.k - cs }, { r: R, z: cs }],
        closed: true,
      };
    }
    case 'washer': {
      const inner = HOLES[size].fine / 2;
      return { rings: [{ r: inner, z: 0 }, { r: dims.d / 2, z: 0 }, { r: dims.d / 2, z: dims.k }, { r: inner, z: dims.k }], closed: true };
    }
  }
}

const meshCache = new Map<string, MeshData>();

/** Maillage d'un élément (mis en cache : les éléments identiques le partagent). */
export function fastenerMesh(kind: FastenerKind, size: MetricSize, length?: number): { key: string; mesh: MeshData } {
  const key = `fastener|${kind}|${size}|${length ?? 0}`;
  let mesh = meshCache.get(key);
  if (!mesh) {
    const p = fastenerProfile(kind, size, length);
    mesh = profileMesh(p.rings, p.closed);
    meshCache.set(key, mesh);
  }
  return { key, mesh };
}

/** Épaisseur occupée au-dessus du bord du trou (rondelle, écrou) : sert à empiler les éléments. */
function stackHeight(f: AssemblyFastener): number {
  const t = fastenerType(f.kind);
  return t.shape === 'washer' || t.shape === 'nut' ? t.dims[f.size]!.k : 0;
}

// ---------------------------------------------------------------------------
// Trou visé

export interface HoleInfo {
  edge: EdgeRef;
  /** Diamètre du bord cliqué (mm) et profondeur du trou (mm, 0 si inconnue). */
  diameter: number;
  depth: number;
}

/** Profondeur du trou bordé par une arête circulaire : étendue de sa face cylindrique le long de l'axe. */
function holeDepth(mesh: MeshData, edgeIndex: number): number {
  const e = mesh.edges[edgeIndex]!;
  const axis = e.circle!.axis;
  for (const fi of e.faces) {
    const f = mesh.faces[fi]!;
    if (f.surface !== 'cylinder' || !f.cylinder) continue;
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = f.start; k < f.start + f.count; k++) {
      const v = mesh.indices[k]!;
      const d = mesh.positions[3 * v]! * axis.x + mesh.positions[3 * v + 1]! * axis.y + mesh.positions[3 * v + 2]! * axis.z;
      lo = Math.min(lo, d);
      hi = Math.max(hi, d);
    }
    return hi - lo;
  }
  return 0;
}

/**
 * Trou désigné par un clic sur une pièce (coordonnées de la pièce) : le bord circulaire cliqué,
 * ou, pour un clic dans un trou, celui de ses bords le plus proche du point cliqué.
 */
export function holeFromPick(mesh: MeshData, part: Part, kind: 'face' | 'edge', index: number, point: Vec3): HoleInfo | { reason: string } {
  let edgeIndex = -1;
  if (kind === 'edge') {
    if (mesh.edges[index]?.circle) edgeIndex = index;
  } else {
    const face = mesh.faces[index];
    if (face?.surface === 'cylinder') {
      let best = Infinity;
      mesh.edges.forEach((e, i) => {
        if (!e.circle || !e.faces.includes(index)) return;
        const d = Math.abs(dot3(sub3(point, e.circle.center), e.circle.axis));
        if (d < best) {
          best = d;
          edgeIndex = i;
        }
      });
    }
  }
  if (edgeIndex < 0) return { reason: 'Cliquez le bord d’un trou rond (ou l’intérieur du trou).' };
  const ref = edgeRefFromPick(mesh, edgeIndex, part, null);
  if (ref.kind !== 'ref') return { reason: 'Ce bord de trou ne peut pas être désigné de façon durable : choisissez un autre trou.' };
  return { edge: ref.ref, diameter: 2 * mesh.edges[edgeIndex]!.circle!.radius, depth: holeDepth(mesh, edgeIndex) };
}

/** Bord de trou d'un élément posé, dans le maillage actuel de la pièce. */
export function holeOf(mesh: MeshData, edge: EdgeRef): { diameter: number; depth: number } | null {
  const i = edgesMatching(mesh, edge).find((k) => mesh.edges[k]!.circle);
  return i === undefined ? null : { diameter: 2 * mesh.edges[i]!.circle!.radius, depth: holeDepth(mesh, i) };
}

/** Tailles possibles d'un élément dans un trou de ce diamètre (tête fraisée : fraisure ou trou). */
export function sizesForHole(kind: FastenerKind, diameter: number): HoleMatch[] {
  const allowed = new Set(sizesOf(kind));
  const out: HoleMatch[] = [];
  if (kind === 'iso10642') {
    const cs = matchCountersink(diameter);
    if (cs) out.push({ size: cs, hole: 'clearance' });
  }
  for (const m of holeMatches(diameter)) if (allowed.has(m.size) && !out.some((o) => o.size === m.size)) out.push(m);
  return out;
}

/** Nouvel élément pour ce trou (taille la plus probable, longueur proposée), ou l'explication. */
export function fastenerForHole(kind: FastenerKind, hole: HoleInfo): Omit<AssemblyFastener, 'id' | 'at'> | { reason: string } {
  const options = sizesForHole(kind, hole.diameter);
  const first = options[0];
  if (!first) {
    const t = fastenerType(kind);
    const other = holeMatches(hole.diameter)[0];
    if (other) return { reason: `${t.label} : la norme ${t.standard} n’existe pas en ${other.size}. Choisissez un autre type de vis.` };
    const d = hole.diameter.toFixed(2).replace(/\.?0+$/, '').replace('.', ',');
    return {
      reason: `Ce trou fait ${d} mm : aucune vis métrique normalisée n’y va. Exemples : M3 → trou de passage 3,2 à 3,6 mm (ISO 273) ou 2,5 mm à tarauder ; M4 → 4,3 à 4,8 mm ou 3,3 mm.`,
    };
  }
  const length = suggestedLength(kind, first.size, hole.depth, first.hole);
  return { kind, size: first.size, ...(length !== null ? { length } : {}) };
}

// ---------------------------------------------------------------------------
// Placement

export type FastenerIssue = 'lost' | 'size';

export interface FastenerPlacement {
  matrices: Map<Id, Mat4>;
  issues: Map<Id, FastenerIssue>;
}

/**
 * Matrice de chaque élément dans l'assemblage : repère du bord de trou (axe vers l'extérieur de la
 * matière) dans la pièce placée, puis empilement sur le même bord.
 */
export function placeFasteners(assembly: Assembly, meshOf: (partId: Id) => MeshData | null | undefined, instanceMatrix: (instanceId: Id) => Mat4 | undefined): FastenerPlacement {
  const matrices = new Map<Id, Mat4>();
  const issues = new Map<Id, FastenerIssue>();
  // Sur un même bord : les rondelles d'abord (contre la pièce), puis l'écrou ou la tête de vis,
  // quel que soit l'ordre de pose.
  const rank = (f: AssemblyFastener) => (fastenerType(f.kind).shape === 'washer' ? 0 : 1);
  const ordered = (assembly.fasteners ?? []).map((f, i) => ({ f, i })).sort((a, b) => rank(a.f) - rank(b.f) || a.i - b.i);
  const stacked = new Map<string, number>();
  for (const { f } of ordered) {
    const inst = assembly.instances.find((i) => i.id === f.at.instanceId);
    const mesh = inst ? meshOf(inst.partId) : null;
    const placed = inst ? instanceMatrix(inst.id) : undefined;
    const frame = mesh ? lcsFrame(mesh, { kind: 'circle', edge: f.at.edge }) : null;
    const hole = mesh ? holeOf(mesh, f.at.edge) : null;
    if (!mesh || !placed || !frame || !hole) {
      issues.set(f.id, 'lost');
      continue;
    }
    if (!sizesForHole(f.kind, hole.diameter).some((m) => m.size === f.size)) issues.set(f.id, 'size');
    const key = `${f.at.instanceId}|${JSON.stringify(f.at.edge)}|${f.flip ? 1 : 0}`;
    let offset = stacked.get(key) ?? 0;
    stacked.set(key, offset + stackHeight(f));
    // Tête fraisée posée sur un trou simple (pas dans sa fraisure) : la tête reste au-dessus.
    const t = fastenerType(f.kind);
    if (t.shape === 'countersunk' && matchCountersink(hole.diameter) !== f.size) offset += t.dims[f.size]!.k;
    let m = multiply4(placed, multiply4(frameMatrix4(frame), translation4({ x: 0, y: 0, z: f.flip ? -offset : offset })));
    if (f.flip) m = multiply4(m, rotationX4(Math.PI));
    matrices.set(f.id, m);
  }
  return { matrices, issues };
}

export const FASTENER_ISSUE_MESSAGES: Record<FastenerIssue, string> = {
  lost: 'Le trou où elle était posée a disparu (pièce modifiée) : supprimez-la ou reposez-la.',
  size: 'Le trou a changé de diamètre : cette taille n’y va plus. Choisissez une autre taille.',
};

// ---------------------------------------------------------------------------
// Liste et nomenclature

export interface FastenerGroup {
  name: string;
  kind: FastenerKind;
  size: MetricSize;
  length?: number;
  ids: Id[];
}

/** Éléments identiques regroupés (même type, taille, longueur), dans l'ordre d'apparition. */
export function fastenerGroups(assembly: Assembly | undefined): FastenerGroup[] {
  const groups: FastenerGroup[] = [];
  for (const f of assembly?.fasteners ?? []) {
    const name = designation(f.kind, f.size, f.length);
    const g = groups.find((x) => x.name === name);
    if (g) g.ids.push(f.id);
    else groups.push({ name, kind: f.kind, size: f.size, ...(f.length !== undefined ? { length: f.length } : {}), ids: [f.id] });
  }
  return groups;
}
