/**
 * Section des profilés aluminium série 20 (rainure de 6 mm, la plus courante en fabrication
 * amateur). Cotes approchées des fiches V-slot et T-slot du commerce : de quoi concevoir autour
 * (encombrement, rainures, alésages), pas un plan d'usinage du profilé.
 */
import type { BeamSize, BeamSystem } from '../../domain/model';
import type { Vec2 } from '../../math/vec';
import type { ProfileLoop, ProfileRegion, ProfileSegment } from '../../sketch/profiles';

/** Côté d'un module (mm). */
export const BEAM_MODULE = 20;
/** Rayon des arêtes extérieures (mm). */
const CORNER = 1.5;
/** Alésage au centre de chaque module : Ø 4,2, à tarauder en M5. */
export const BEAM_BORE = 4.2;

export const BEAM_SIZES: BeamSize[] = ['2020', '2040', '2060', '2080', '4040', '4080'];
export const BEAM_SYSTEMS: Record<BeamSystem, string> = { vslot: 'V-slot', tslot: 'T-slot' };

/** Modules en largeur et en hauteur d'une section (« 2040 » : 1 × 2). */
export function beamModules(size: BeamSize): { cols: number; rows: number } {
  return { cols: Number(size.slice(0, 2)) / BEAM_MODULE, rows: Number(size.slice(2)) / BEAM_MODULE };
}

export const beamLabel = (size: BeamSize) => `${size.slice(0, 2)} × ${size.slice(2)}`;

/**
 * Rainure vue depuis la face : (u le long de la face depuis l'axe de la rainure, d vers l'intérieur).
 * Entrée (en V à 45° ou droite), lèvre, puis chambre en T qui se resserre vers le cœur.
 */
function slotPath(system: BeamSystem): Vec2[] {
  const chamber: Vec2[] = [
    { x: -3.1, y: 2 },
    { x: -5.6, y: 2 },
    { x: -5.6, y: 3.2 },
    { x: -3, y: 6.1 },
  ];
  const entry: Vec2[] = system === 'vslot' ? [{ x: -4.6, y: 0 }, { x: -3.1, y: 1.5 }] : [{ x: -3.1, y: 0 }];
  const left = [...entry, ...chamber];
  return [...left, ...[...left].reverse().map((p) => ({ x: -p.x, y: p.y }))];
}

const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });

/** Aire signée d'une boucle (arcs comptés par leur corde et leur segment circulaire). */
function signedArea(segments: ProfileSegment[]): number {
  let a = 0;
  for (const s of segments) {
    if (s.kind === 'circle') return (s.clockwise ? -1 : 1) * Math.PI * s.radius * s.radius;
    if (s.kind !== 'line' && s.kind !== 'arc') continue;
    a += (s.start.x * s.end.y - s.end.x * s.start.y) / 2;
    if (s.kind === 'arc') {
      const c = Math.hypot(s.end.x - s.start.x, s.end.y - s.start.y);
      const theta = 2 * Math.asin(Math.min(1, c / (2 * s.radius)));
      a += (s.clockwise ? -1 : 1) * ((s.radius * s.radius) / 2) * (theta - Math.sin(theta));
    }
  }
  return a;
}

/** Section d'un profilé, centrée sur l'origine (x : largeur, y : hauteur). */
export function beamProfile(system: BeamSystem, size: BeamSize): ProfileRegion {
  const { cols, rows } = beamModules(size);
  const w = cols * BEAM_MODULE;
  const h = rows * BEAM_MODULE;
  // Faces parcourues dans le sens trigonométrique : bas, droite, haut, gauche.
  const corners: Vec2[] = [
    { x: -w / 2, y: -h / 2 },
    { x: w / 2, y: -h / 2 },
    { x: w / 2, y: h / 2 },
    { x: -w / 2, y: h / 2 },
  ];
  const slot = slotPath(system);
  const segments: ProfileSegment[] = [];
  let id = 0;
  const line = (a: Vec2, b: Vec2) => {
    if (Math.hypot(b.x - a.x, b.y - a.y) > 1e-9) segments.push({ kind: 'line', entityId: `b${id++}`, start: a, end: b });
  };
  for (let i = 0; i < 4; i++) {
    const a = corners[i]!;
    const b = corners[(i + 1) % 4]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const t = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
    // Vers l'intérieur : à gauche du sens de parcours.
    const n = { x: -t.y, y: t.x };
    const at = (s: number, d = 0): Vec2 => ({ x: a.x + t.x * s + n.x * d, y: a.y + t.y * s + n.y * d });
    const pts: Vec2[] = [at(CORNER)];
    for (let k = 0; k < length / BEAM_MODULE - 0.5; k++) {
      const centre = BEAM_MODULE / 2 + k * BEAM_MODULE;
      for (const p of slot) pts.push(at(centre + p.x, p.y));
    }
    pts.push(at(length - CORNER));
    for (let j = 0; j + 1 < pts.length; j++) line(pts[j]!, pts[j + 1]!);
    // Arrondi vers la face suivante.
    const next = corners[(i + 2) % 4]!;
    const t2len = Math.hypot(next.x - b.x, next.y - b.y);
    const t2 = { x: (next.x - b.x) / t2len, y: (next.y - b.y) / t2len };
    const start = pts[pts.length - 1]!;
    const end = { x: b.x + t2.x * CORNER, y: b.y + t2.y * CORNER };
    const center = { x: b.x - t.x * CORNER + n.x * CORNER, y: b.y - t.y * CORNER + n.y * CORNER };
    segments.push({ kind: 'arc', entityId: `c${i}`, start, end, center, radius: CORNER, clockwise: false });
  }
  const outer: ProfileLoop = { segments, signedArea: signedArea(segments) };
  const holes: ProfileLoop[] = [];
  for (let cx = 0; cx < cols; cx++)
    for (let cy = 0; cy < rows; cy++) {
      const center = sub({ x: (cx + 0.5) * BEAM_MODULE, y: (cy + 0.5) * BEAM_MODULE }, { x: w / 2, y: h / 2 });
      const hole: ProfileSegment[] = [{ kind: 'circle', entityId: `bore${cx}-${cy}`, center, radius: BEAM_BORE / 2, clockwise: true }];
      holes.push({ segments: hole, signedArea: signedArea(hole) });
    }
  return { outer, holes, area: outer.signedArea + holes.reduce((s, l) => s + l.signedArea, 0) };
}
