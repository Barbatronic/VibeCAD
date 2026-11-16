/**
 * Lecture d'une carte KiCad (`.kicad_pcb`, KiCad 6 et suivants) pour la conception mécanique :
 * contour (couche Edge.Cuts), épaisseur, trous de fixation, et composants (repère, empreinte,
 * côté, position, emprise, modèle 3D). Calcul pur : la carte est rendue dans le repère de
 * VibeCAD (millimètres, Y vers le haut), coin bas gauche du contour à l'origine.
 */
import type { Vec2, Vec3 } from '../math/vec';
import { atom, child, children, isList, num, parseSExpr, type SList } from './sexpr';

export type OutlineSegment = { kind: 'line'; a: Vec2; b: Vec2 } | { kind: 'arc'; a: Vec2; mid: Vec2; b: Vec2 } | { kind: 'circle'; center: Vec2; radius: number };

export interface BoardHole {
  center: Vec2;
  diameter: number;
  /** Repère du composant qui le porte (H1…), s'il y en a un. */
  ref: string | null;
}

export interface ModelRef {
  /** Chemin tel qu'écrit dans la carte (variables d'environnement comprises). */
  path: string;
  /** Nom du fichier, sans dossier. */
  file: string;
  offset: Vec3;
  scale: Vec3;
  rotate: Vec3;
}

export interface BoardComponent {
  ref: string;
  value: string;
  /** Empreinte (« Resistor_SMD:R_0805_2012Metric »). */
  footprint: string;
  side: 'top' | 'bottom';
  /** Origine de l'empreinte (repère VibeCAD) et rotation autour de Z (degrés, sens trigonométrique). */
  at: Vec2;
  rotation: number;
  /** Emprise dans le repère de l'empreinte (Y vers le haut), d'après la couche courtyard, sinon les pastilles. */
  box: { min: Vec2; max: Vec2 } | null;
  models: ModelRef[];
  /** Composant traversant (pastilles percées) : sa hauteur par défaut est plus grande. */
  through: boolean;
}

export interface KicadBoard {
  name: string;
  thickness: number;
  /** Contour, en segments non ordonnés. */
  outline: OutlineSegment[];
  holes: BoardHole[];
  components: BoardComponent[];
  /** Décalage appliqué (coordonnées KiCad du coin bas gauche du contour). */
  origin: Vec2;
}

const xy = (l: SList | undefined): Vec2 => ({ x: num(l, 0), y: num(l, 1) });
const xyz = (l: SList | undefined, fallback = 0): Vec3 => (l ? { x: num(l, 0, fallback), y: num(l, 1, fallback), z: num(l, 2, fallback) } : { x: fallback, y: fallback, z: fallback });
const layerOf = (l: SList) => atom(child(l, 'layer'));

/** Point du dessin KiCad (Y vers le bas) dans le repère d'une empreinte : rotation puis translation. */
function placeLocal(p: Vec2, at: { x: number; y: number; angle: number }): Vec2 {
  // Angles KiCad : sens trigonométrique à l'écran, Y vers le bas.
  const r = (-at.angle * Math.PI) / 180;
  return { x: at.x + p.x * Math.cos(r) - p.y * Math.sin(r), y: at.y + p.x * Math.sin(r) + p.y * Math.cos(r) };
}

/** Segments d'une figure graphique (gr_* ou fp_*), dans le repère où elle est écrite. */
function shapeSegments(g: SList): OutlineSegment[] {
  const kind = g.head.slice(3);
  if (kind === 'line') return [{ kind: 'line', a: xy(child(g, 'start')), b: xy(child(g, 'end')) }];
  if (kind === 'arc') return [{ kind: 'arc', a: xy(child(g, 'start')), mid: xy(child(g, 'mid')), b: xy(child(g, 'end')) }];
  if (kind === 'circle') {
    const c = xy(child(g, 'center'));
    const e = xy(child(g, 'end'));
    return [{ kind: 'circle', center: c, radius: Math.hypot(e.x - c.x, e.y - c.y) }];
  }
  if (kind === 'rect') {
    const a = xy(child(g, 'start'));
    const b = xy(child(g, 'end'));
    const pts = [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
    return pts.map((p, i) => ({ kind: 'line', a: p, b: pts[(i + 1) % 4]! }));
  }
  if (kind === 'poly') {
    const pts = children(child(g, 'pts') ?? { head: '', items: [] }, 'xy').map(xy);
    return pts.length > 2 ? pts.map((p, i) => ({ kind: 'line', a: p, b: pts[(i + 1) % pts.length]! })) : [];
  }
  return [];
}

const mapSegment = (s: OutlineSegment, f: (p: Vec2) => Vec2, scaleRadius = 1): OutlineSegment =>
  s.kind === 'line' ? { kind: 'line', a: f(s.a), b: f(s.b) } : s.kind === 'arc' ? { kind: 'arc', a: f(s.a), mid: f(s.mid), b: f(s.b) } : { kind: 'circle', center: f(s.center), radius: s.radius * scaleRadius };

function segmentPoints(s: OutlineSegment): Vec2[] {
  if (s.kind === 'line') return [s.a, s.b];
  if (s.kind === 'arc') return [s.a, s.mid, s.b];
  return [
    { x: s.center.x - s.radius, y: s.center.y - s.radius },
    { x: s.center.x + s.radius, y: s.center.y + s.radius },
  ];
}

function boundsOf(points: Vec2[]): { min: Vec2; max: Vec2 } | null {
  if (points.length === 0) return null;
  return {
    min: { x: Math.min(...points.map((p) => p.x)), y: Math.min(...points.map((p) => p.y)) },
    max: { x: Math.max(...points.map((p) => p.x)), y: Math.max(...points.map((p) => p.y)) },
  };
}

export function parseKicadBoard(text: string, name: string): KicadBoard {
  const root = parseSExpr(text);
  if (root.head !== 'kicad_pcb') throw new Error('Ce fichier n’est pas une carte KiCad (.kicad_pcb).');
  if (num(child(root, 'version')) < 20211014) throw new Error('Carte enregistrée avec une version trop ancienne de KiCad (avant la version 6) : ouvrez-la et enregistrez-la dans un KiCad récent.');
  const thickness = num(child(child(root, 'general') ?? root, 'thickness'), 0, 1.6) || 1.6;
  // Contour, en coordonnées KiCad.
  const raw: OutlineSegment[] = [];
  for (const g of root.items) {
    if (isList(g) && g.head.startsWith('gr_') && layerOf(g) === 'Edge.Cuts') raw.push(...shapeSegments(g));
  }
  const footprints = children(root, 'footprint');
  for (const fp of footprints) {
    const at = child(fp, 'at');
    const place = { x: num(at, 0), y: num(at, 1), angle: num(at, 2) };
    for (const g of fp.items) if (isList(g) && g.head.startsWith('fp_') && layerOf(g) === 'Edge.Cuts') raw.push(...shapeSegments(g).map((s) => mapSegment(s, (p) => placeLocal(p, place))));
  }
  if (raw.length === 0) throw new Error('Cette carte n’a pas de contour (couche Edge.Cuts).');
  const b = boundsOf(raw.flatMap(segmentPoints))!;
  const origin = { x: b.min.x, y: b.max.y };
  // Repère VibeCAD : Y vers le haut, coin bas gauche à l'origine.
  const toBoard = (p: Vec2): Vec2 => ({ x: round(p.x - origin.x), y: round(origin.y - p.y) });
  const outline = raw.map((s) => mapSegment(s, toBoard));
  const holes: BoardHole[] = [];
  const components: BoardComponent[] = [];
  for (const fp of footprints) {
    const footprint = atom(fp) ?? '';
    const at = child(fp, 'at');
    const place = { x: num(at, 0), y: num(at, 1), angle: num(at, 2) };
    const side = layerOf(fp) === 'B.Cu' ? 'bottom' : 'top';
    const prop = (key: string) => children(fp, 'property').find((p) => atom(p) === key);
    const ref = atom(prop('Reference'), 1) ?? atom(children(fp, 'fp_text').find((t) => atom(t) === 'reference'), 1) ?? '';
    const value = atom(prop('Value'), 1) ?? atom(children(fp, 'fp_text').find((t) => atom(t) === 'value'), 1) ?? '';
    const pads = children(fp, 'pad');
    // Trous de la carte : perçages non métallisés, et trous de fixation.
    const mounting = /MountingHole/i.test(footprint);
    for (const pad of pads) {
      const drill = child(pad, 'drill');
      const d = num(drill);
      if (!(d > 0) || atom(drill) === 'oval') continue;
      if (atom(pad, 1) === 'np_thru_hole' || (mounting && d >= 2)) {
        holes.push({ center: toBoard(placeLocal(xy(child(pad, 'at')), place)), diameter: d, ref: ref || null });
      }
    }
    if (mounting || pads.length === 0 || pads.every((p) => atom(p, 1) === 'np_thru_hole')) continue;
    const attr = child(fp, 'attr');
    if (attr?.items.includes('board_only')) continue;
    // Emprise : couche courtyard du côté de l'empreinte, sinon les pastilles (repère de l'empreinte, Y vers le haut).
    const yUp = (p: Vec2): Vec2 => ({ x: p.x, y: -p.y });
    const courtyard = fp.items.filter((g): g is SList => isList(g) && g.head.startsWith('fp_') && /CrtYd$/.test(layerOf(g) ?? '')).flatMap((g) => shapeSegments(g).flatMap(segmentPoints));
    const padPoints = pads.flatMap((p) => {
      const c = xy(child(p, 'at'));
      const size = xy(child(p, 'size'));
      return [
        { x: c.x - size.x / 2, y: c.y - size.y / 2 },
        { x: c.x + size.x / 2, y: c.y + size.y / 2 },
      ];
    });
    const box = boundsOf((courtyard.length ? courtyard : padPoints).map(yUp));
    const models = children(fp, 'model')
      .filter((m) => !m.items.includes('hide') && atom(child(m, 'hide')) !== 'yes')
      .map((m): ModelRef => {
        const path = atom(m) ?? '';
        // KiCad 5 : décalage en pouces (`at`) ; ensuite en millimètres (`offset`).
        const offset = child(m, 'offset') ? xyz(child(child(m, 'offset')!, 'xyz')) : child(m, 'at') ? scale3(xyz(child(child(m, 'at')!, 'xyz')), 25.4) : { x: 0, y: 0, z: 0 };
        return { path, file: path.split(/[\\/]/).pop() ?? path, offset, scale: xyz(child(child(m, 'scale') ?? { head: '', items: [] }, 'xyz'), 1), rotate: xyz(child(child(m, 'rotate') ?? { head: '', items: [] }, 'xyz')) };
      });
    const origin2 = toBoard({ x: place.x, y: place.y });
    components.push({
      ref,
      value,
      footprint,
      side,
      at: origin2,
      rotation: place.angle,
      box,
      models,
      through: pads.some((p) => atom(p, 1) === 'thru_hole'),
    });
  }
  return { name, thickness, outline, holes, components, origin };
}

const round = (v: number) => Math.round(v * 1e6) / 1e6;
const scale3 = (v: Vec3, k: number): Vec3 => ({ x: v.x * k, y: v.y * k, z: v.z * k });

// ---------------------------------------------------------------------------
// Modèles 3D

/**
 * Boîte d'un modèle 3D dans le repère de l'empreinte (Y vers le haut, Z au-dessus de la face où
 * le composant est posé), d'après la boîte du fichier STEP et le placement écrit dans la carte :
 * p' = décalage + Rz(rz) · Ry(ry) · Rx(rx) · (échelle · p), comme le visualiseur 3D de KiCad.
 */
export function modelBox(model: ModelRef, bbox: { min: Vec3; max: Vec3 }): { min: Vec3; max: Vec3 } {
  // Le visualiseur de KiCad tourne de l'opposé des angles écrits.
  const r = (d: number) => (-d * Math.PI) / 180;
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(r(model.rotate.x)), Math.sin(r(model.rotate.x)), Math.cos(r(model.rotate.y)), Math.sin(r(model.rotate.y)), Math.cos(r(model.rotate.z)), Math.sin(r(model.rotate.z))];
  // Rx, puis Ry, puis Rz (angles de KiCad, sens trigonométrique).
  const rot = (p: Vec3): Vec3 => {
    const a = { x: p.x, y: cx * p.y - sx * p.z, z: sx * p.y + cx * p.z };
    const b = { x: cy * a.x + sy * a.z, y: a.y, z: -sy * a.x + cy * a.z };
    return { x: cz * b.x - sz * b.y, y: sz * b.x + cz * b.y, z: b.z };
  };
  const pts: Vec3[] = [];
  for (const x of [bbox.min.x, bbox.max.x])
    for (const y of [bbox.min.y, bbox.max.y])
      for (const z of [bbox.min.z, bbox.max.z]) {
        const p = rot({ x: x * model.scale.x, y: y * model.scale.y, z: z * model.scale.z });
        pts.push({ x: p.x + model.offset.x, y: p.y + model.offset.y, z: p.z + model.offset.z });
      }
  return {
    min: { x: Math.min(...pts.map((p) => p.x)), y: Math.min(...pts.map((p) => p.y)), z: Math.min(...pts.map((p) => p.z)) },
    max: { x: Math.max(...pts.map((p) => p.x)), y: Math.max(...pts.map((p) => p.y)), z: Math.max(...pts.map((p) => p.z)) },
  };
}

/** Fichier STEP à chercher pour un modèle : le même nom, ou son équivalent `.step` / `.stp` d'un `.wrl`. */
export function modelCandidates(model: ModelRef): string[] {
  const base = model.file.replace(/\.(wrl|vrml|step|stp)$/i, '').toLowerCase();
  return [`${base}.step`, `${base}.stp`];
}

/**
 * Hauteur estimée d'un composant sans modèle 3D, d'après le nom de son empreinte : hauteur écrite
 * dans le nom (« _H11.0mm », condensateur « 5x5.4 »), sinon celle des boîtiers courants.
 */
export function estimatedHeight(footprint: string, through: boolean): number {
  const name = footprint.split(':').pop() ?? footprint;
  const written = /_H(\d+(?:\.\d+)?)mm/i.exec(name);
  if (written) return Number(written[1]);
  const elec = /CP_Elec_\d+(?:\.\d+)?x(\d+(?:\.\d+)?)/i.exec(name);
  if (elec) return Number(elec[1]);
  const radial = /CP_Radial_D(\d+(?:\.\d+)?)mm/i.exec(name);
  if (radial) return Math.round(Number(radial[1]) * 1.4 * 10) / 10;
  const table: [RegExp, number][] = [
    [/(?:^|_)(0201|0603Metric)/, 0.3],
    [/(?:^|_)(0402|1005Metric)/, 0.4],
    [/(?:^|_)(0603|1608Metric)/, 0.5],
    [/(?:^|_)(0805|2012Metric)/, 0.6],
    [/(?:^|_)(1206|3216Metric|1210|3225Metric)/, 0.7],
    [/^LED_\d{4}/, 1],
    [/SOT-23/, 1.1],
    [/SOT-223/, 1.8],
    [/SOIC|SOP-/, 1.75],
    [/TSSOP|MSOP/, 1.1],
    [/QFN|DFN/, 0.9],
    [/[LT]QFP/, 1.6],
    [/D_SMA/, 2.3],
    [/D_SMB/, 2.4],
    [/D_SMC/, 2.6],
    [/TO-220/, 16],
    [/TO-92/, 5],
    [/PinHeader|PinSocket/, 8.5],
    [/Molex_KK-254/, 11],
    [/Molex_KK-396/, 13],
    [/JST_XH/, 7],
    [/JST_PH/, 6],
    [/JST_SH/, 4.3],
    [/USB_C/, 3.3],
    [/USB/, 4],
    [/Crystal/, 4],
    [/SW_PUSH|SW_Push/, 5],
  ];
  for (const [re, h] of table) if (re.test(name)) return h;
  return through ? 8 : 1.5;
}
