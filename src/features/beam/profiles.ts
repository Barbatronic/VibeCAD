/**
 * Section des profilés aluminium : série 20 (rainure de 6 mm, la plus courante en fabrication
 * amateur), V-slot et T-slot, et MakerBeam 10 × 10 (rainure de 3 mm). Cotes approchées des fiches
 * du commerce : de quoi concevoir autour (encombrement, rainures, alésages), pas un plan d'usinage
 * du profilé.
 */
import type { BeamSize, BeamSystem } from '../../domain/model';
import type { Vec2 } from '../../math/vec';
import type { ProfileLoop, ProfileRegion, ProfileSegment } from '../../sketch/profiles';

/** Côté d'un module de la série 20 (mm). */
export const BEAM_MODULE = 20;
/** Alésage au centre de chaque module de la série 20 : Ø 4,2, à tarauder en M5. */
export const BEAM_BORE = 4.2;

export const BEAM_SYSTEMS: Record<BeamSystem, string> = { vslot: 'V-slot', tslot: 'T-slot', makerbeam: 'MakerBeam' };

/** Gamme d'un système : module, sections, rayon des arêtes, alésage, texte d'aide. */
interface BeamRange {
  module: number;
  sizes: BeamSize[];
  corner: number;
  bore: number;
  help: string;
}

const SERIES_20: Omit<BeamRange, 'help'> = { module: BEAM_MODULE, sizes: ['2020', '2040', '2060', '2080', '4040', '4080'], corner: 1.5, bore: BEAM_BORE };
const RANGES: Record<BeamSystem, BeamRange> = {
  vslot: { ...SERIES_20, help: 'Série 20 · rainure 6 mm · alésages Ø 4,2 (M5)' },
  tslot: { ...SERIES_20, help: 'Série 20 · rainure 6 mm · alésages Ø 4,2 (M5)' },
  makerbeam: { module: 10, sizes: ['1010'], corner: 0.5, bore: 2.5, help: 'MakerBeam · rainure 3 mm · alésage Ø 2,5 (M3)' },
};

export const beamRange = (system: BeamSystem): BeamRange => RANGES[system];

/** Toutes les sections connues. */
export const BEAM_SIZES: BeamSize[] = [...new Set(Object.values(RANGES).flatMap((r) => r.sizes))];

/** Modules en largeur et en hauteur d'une section (« 2040 » : 1 × 2). */
export function beamModules(size: BeamSize, system: BeamSystem = 'vslot'): { cols: number; rows: number } {
  const m = RANGES[system].module;
  return { cols: Number(size.slice(0, 2)) / m, rows: Number(size.slice(2)) / m };
}

export const beamLabel = (size: BeamSize) => `${size.slice(0, 2)} × ${size.slice(2)}`;

/**
 * Rainure vue depuis la face : (u le long de la face depuis l'axe de la rainure, d vers l'intérieur).
 * Entrée (en V à 45° ou droite), lèvre, puis chambre en T qui se resserre vers le cœur.
 */
function slotPath(system: BeamSystem): Vec2[] {
  if (system === 'makerbeam') {
    // MakerBeam : entrée de 3 mm, lèvre de 1 mm, chambre sous la lèvre bordée par les voiles
    // diagonaux (1 mm) qui relient les coins au cœur (carré de 3,9 mm autour de l'alésage).
    const left: Vec2[] = [
      { x: -1.5, y: 0 },
      { x: -1.5, y: 1 },
      { x: -3.29, y: 1 },
      { x: -1.24, y: 3.05 },
    ];
    return [...left, ...[...left].reverse().map((p) => ({ x: -p.x, y: p.y }))];
  }
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
  const { module, corner: CORNER, bore } = RANGES[system];
  const { cols, rows } = beamModules(size, system);
  const w = cols * module;
  const h = rows * module;
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
    for (let k = 0; k < length / module - 0.5; k++) {
      const centre = module / 2 + k * module;
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
      const center = sub({ x: (cx + 0.5) * module, y: (cy + 0.5) * module }, { x: w / 2, y: h / 2 });
      const hole: ProfileSegment[] = [{ kind: 'circle', entityId: `bore${cx}-${cy}`, center, radius: bore / 2, clockwise: true }];
      holes.push({ segments: hole, signedArea: signedArea(hole) });
    }
  return { outer, holes, area: outer.signedArea + holes.reduce((s, l) => s + l.signedArea, 0) };
}
