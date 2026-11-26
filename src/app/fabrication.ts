/**
 * Préparation de la fabrication (calculs purs, testables) : réglages par défaut, orientation
 * « face posée sur le plateau », disposition des pièces et des exemplaires sur le plateau
 * d'impression, estimation de matière.
 */
import type { CadDocument, FabricationSettings, FaceRef, Id, LaserMaterial, Part, PrintItem, PrintPlate, PrintSeries } from '../domain/model';
import { engraveColors, sheetOf, type MaterialSheet } from '../domain/material-sheets';
import { paintMaterials } from '../domain/paint';
import type { FaceTag, MeshData, ShapeAnalysis } from '../geometry/kernel';
import { multiply4, translation4, type Mat4 } from '../math/mat4';
import { normalize3, type Vec3 } from '../math/vec';
import { formatNumber } from '../domain/units';
import { markLayout, zoneBox, type VariantMark } from '../features/series-mark';

/**
 * Matériaux préréglés : plaques de 300 × 200 mm de contreplaqué et d'acrylique, en 3 et 5 mm. À
 * épaisseur égale, le choix automatique prend le premier de la liste (le contreplaqué) ; l'acrylique
 * se choisit pièce par pièce. Trait de coupe de l'acrylique un peu plus fin.
 */
export const DEFAULT_LASER_MATERIALS: LaserMaterial[] = [
  { id: 'mat-3', name: 'Contreplaqué 3 mm', thickness: 3, sheet: { w: 300, h: 200 }, kerf: 0.15 },
  { id: 'mat-5', name: 'Contreplaqué 5 mm', thickness: 5, sheet: { w: 300, h: 200 }, kerf: 0.15 },
  { id: 'mat-acr-3', name: 'Acrylique 3 mm', thickness: 3, sheet: { w: 300, h: 200 }, kerf: 0.1 },
  { id: 'mat-acr-5', name: 'Acrylique 5 mm', thickness: 5, sheet: { w: 300, h: 200 }, kerf: 0.1 },
];

export const DEFAULT_FABRICATION: FabricationSettings = {
  print: { bed: { x: 220, y: 220, z: 250 }, spacing: 5, items: [] },
  laser: { materials: DEFAULT_LASER_MATERIALS, spacing: 4, items: [] },
};

/** Nouveau matériau : identifiant libre, réglages copiés du dernier matériau (ou des préréglages). */
export function newLaserMaterial(existing: readonly LaserMaterial[]): LaserMaterial {
  const taken = new Set(existing.map((m) => m.id));
  let n = existing.length + 1;
  while (taken.has(`mat-${n}`)) n++;
  const model = existing[existing.length - 1] ?? DEFAULT_LASER_MATERIALS[0]!;
  return { ...model, id: `mat-${n}`, name: `Matériau ${existing.length + 1}`, sheet: { ...model.sheet } };
}

/** Densité du PLA (g/cm³), pour l'estimation de matière. */
export const PLA_DENSITY = 1.24;

/**
 * Réglages du projet, complétés. Chaque pièce ayant un volume a sa ligne, dans le sous-onglet de son
 * procédé : Impression 3D pour une matière imprimée, Découpe laser pour une matière découpée ; une
 * pièce sans matière choisie figure dans les deux. Chaque matière découpée a sa plaque, à son nom.
 */
export function fabricationSettings(doc: CadDocument, hasSolid: (partId: Id) => boolean): FabricationSettings {
  const f = doc.fabrication ?? DEFAULT_FABRICATION;
  const parts = doc.parts.filter((p) => hasSolid(p.id));
  const processOf = (p: Part) => sheetOf(doc, p)?.process;
  const cut = parts.filter((p) => (processOf(p) ?? 'laser') === 'laser');
  // Plaques des matières découpées : nom et épaisseur de la fiche, le reste gardé d'un réglage à l'autre.
  const laserSheets = [...new Map(cut.flatMap((p) => {
    const s = sheetOf(doc, p);
    return s ? [[s.id, s] as const] : [];
  })).values()];
  const fromSheets: LaserMaterial[] = laserSheets.map((s) => {
    const kept = f.laser.materials.find((m) => m.id === s.id);
    return {
      sheet: kept?.sheet ?? { w: 300, h: 200 },
      kerf: kept?.kerf ?? (s.base === 'acrylic' ? 0.1 : 0.15),
      ...(kept?.placements ? { placements: kept.placements } : {}),
      id: s.id,
      name: s.name,
      thickness: s.thickness ?? kept?.thickness ?? 3,
      fromSheet: true,
    };
  });
  // Plateaux : ceux du projet, ou (ancien format) les pièces qui avaient des exemplaires, sur « Plateau 1 ».
  const exists = new Set(doc.parts.map((p) => p.id));
  const plates = (f.print.plates ?? [{ id: 'plate-1', name: 'Plateau 1', items: f.print.items.filter((i) => i.copies > 0) }]).map((pl) => ({
    ...pl,
    items: pl.items.filter((i) => exists.has(i.partId)),
  }));
  return {
    print: { ...f.print, items: [], plates },
    laser: {
      ...f.laser,
      // Les anciens matériaux laser ne servent plus qu'aux pièces sans matière choisie.
      materials: [...(fromSheets.length && cut.every((p) => sheetOf(doc, p)) ? [] : f.laser.materials.filter((m) => !m.fromSheet && !laserSheets.some((s) => s.id === m.id))), ...fromSheets],
      items: cut.map((p) => {
        const item = f.laser.items.find((i) => i.partId === p.id) ?? { partId: p.id, copies: 0 };
        const s = sheetOf(doc, p);
        return s ? { ...item, materialId: s.id } : item;
      }),
    },
    ...(f.drawings?.length ? { drawings: f.drawings } : {}),
  };
}

/** Nouveau plateau vide, au premier nom libre (« Plateau 2 »…). */
export function newPlate(plates: readonly PrintPlate[]): PrintPlate {
  const ids = new Set(plates.map((p) => p.id));
  const names = new Set(plates.map((p) => p.name));
  let n = plates.length + 1;
  while (ids.has(`plate-${n}`) || names.has(`Plateau ${n}`)) n++;
  return { id: `plate-${n}`, name: `Plateau ${n}`, items: [] };
}

/** Plateau choisi (le premier si l'identifiant n'existe pas, un plateau vide s'il n'y en a aucun). */
export function selectedPlate(print: FabricationSettings['print'], id: Id | null): PrintPlate {
  const plates = print.plates ?? [];
  return plates.find((p) => p.id === id) ?? plates[0] ?? { id: 'plate-1', name: 'Plateau 1', items: [] };
}

/** Pièces qu'on peut mettre sur un plateau : un volume, et une matière imprimée (ou pas encore de matière). */
export function printableParts(doc: CadDocument, hasSolid: (partId: Id) => boolean): Part[] {
  return doc.parts.filter((p) => hasSolid(p.id) && (sheetOf(doc, p)?.process ?? 'print') === 'print');
}

/** Nombre d'emplacements d'un AMS. */
export const AMS_SLOTS = 4;

/**
 * Emplacements de l'AMS : les matières imprimées utilisées, dans l'ordre choisi (`print.ams`) puis
 * dans l'ordre des pièces. Au-delà de `AMS_SLOTS`, l'imprimante ne peut pas tout charger.
 */
export function amsSlots(doc: CadDocument, settings: FabricationSettings['print']): MaterialSheet[] {
  const used = new Map<Id, MaterialSheet>();
  for (const item of settings.items) {
    const part = doc.parts.find((p) => p.id === item.partId);
    const s = part && item.copies > 0 ? sheetOf(doc, part) : undefined;
    if (!s || s.process !== 'print') continue;
    used.set(s.id, s);
    for (const id of [...paintMaterials(part!.paint), ...engraveColors(part!).map((e) => e.material)]) {
      const painted = doc.materials?.find((m) => m.id === id);
      if (painted) used.set(painted.id, painted);
    }
  }
  const ordered = (settings.ams ?? []).flatMap((id) => (used.has(id) ? [used.get(id)!] : []));
  return [...ordered, ...[...used.values()].filter((s) => !ordered.includes(s))];
}

const sameTag = (t: FaceTag, r: FaceRef) =>
  t.featureId === r.featureId && t.role === r.role && (t.entityId ?? null) === (r.entityId ?? null) && (t.index ?? null) === (r.index ?? null);

/** Normale sortante d'une face plane désignée (null si elle n'existe plus ou n'est pas plane). */
export function faceNormal(mesh: MeshData, ref: FaceRef): Vec3 | null {
  const face = mesh.faces.find((f) => f.plane && f.tags.some((t) => sameTag(t, ref)));
  return face?.plane?.normal ?? null;
}

/**
 * Réglage d'impression d'une pièce : sur le plateau `preferred` s'il la porte, sinon sur le premier
 * plateau qui la porte (ancien format : la liste unique).
 */
export function printItemOf(print: FabricationSettings['print'] | undefined, partId: Id, preferred?: Id | null): PrintItem | undefined {
  if (!print) return undefined;
  const plates = print.plates ?? [{ id: '', name: '', items: print.items }];
  const on = (pl: PrintPlate) => pl.items.find((i) => i.partId === partId);
  const first = plates.find((pl) => pl.id === preferred);
  return (first && on(first)) ?? plates.map(on).find((i) => !!i);
}

/** Sens d'impression dans le repère de la pièce (le haut du plateau) : opposé à la face posée dessous ; null : +Z. */
export function printUp(mesh: MeshData, item: PrintItem | undefined): Vec3 | null {
  const n = item?.downFace ? faceNormal(mesh, item.downFace) : null;
  if (!n) return null;
  const len = Math.hypot(n.x, n.y, n.z) || 1;
  return { x: -n.x / len, y: -n.y / len, z: -n.z / len };
}

/** Rotation qui amène la direction `n` sur −Z (la face vient se poser sur le plateau). */
export function rotationToDown(nIn: Vec3): Mat4 {
  const n = normalize3(nIn);
  const target = { x: 0, y: 0, z: -1 };
  const c = n.x * target.x + n.y * target.y + n.z * target.z;
  if (c > 1 - 1e-9) return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  if (c < -1 + 1e-9) return [1, 0, 0, 0, 0, -1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1]; // demi-tour autour de X
  // Formule de Rodrigues : axe k = n × cible, angle θ.
  const k = normalize3({ x: n.y * target.z - n.z * target.y, y: n.z * target.x - n.x * target.z, z: n.x * target.y - n.y * target.x });
  const s = Math.sqrt(1 - c * c);
  const t = 1 - c;
  const r = [
    t * k.x * k.x + c, t * k.x * k.y - s * k.z, t * k.x * k.z + s * k.y,
    t * k.x * k.y + s * k.z, t * k.y * k.y + c, t * k.y * k.z - s * k.x,
    t * k.x * k.z - s * k.y, t * k.y * k.z + s * k.x, t * k.z * k.z + c,
  ];
  // Rangement par colonnes.
  return [r[0]!, r[3]!, r[6]!, 0, r[1]!, r[4]!, r[7]!, 0, r[2]!, r[5]!, r[8]!, 0, 0, 0, 0, 1];
}

const scale4 = (s: number): Mat4 => [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1];

/** Boîte englobante des sommets du maillage après une transformation. */
function transformedBounds(mesh: MeshData, m: Mat4): { min: Vec3; max: Vec3 } {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  const p = mesh.positions;
  for (let i = 0; i < p.length; i += 3) {
    const x = m[0]! * p[i]! + m[4]! * p[i + 1]! + m[8]! * p[i + 2]! + m[12]!;
    const y = m[1]! * p[i]! + m[5]! * p[i + 1]! + m[9]! * p[i + 2]! + m[13]!;
    const z = m[2]! * p[i]! + m[6]! * p[i + 1]! + m[10]! * p[i + 2]! + m[14]!;
    if (x < min.x) min.x = x;
    if (y < min.y) min.y = y;
    if (z < min.z) min.z = z;
    if (x > max.x) max.x = x;
    if (y > max.y) max.y = y;
    if (z > max.z) max.z = z;
  }
  return { min, max };
}

/** Nombre maximal de versions dans une série d'essais (chacune est un recalcul de la pièce). */
export const SERIES_MAX = 25;

const roundValue = (v: number) => Math.round(v * 1e6) / 1e6;

/**
 * Valeurs d'une série d'essais, dans l'ordre croissant et sans doublon (l'ordre de pose sur le
 * plateau). `error` explique une saisie incomplète ou une série trop longue.
 */
export function seriesValues(series: PrintSeries): { values: number[]; error?: string } {
  let raw: number[] = [];
  const finite = (...xs: (number | undefined)[]) => xs.every((x) => x !== undefined && Number.isFinite(x));
  if (series.mode === 'range') {
    const { from, to, count } = series;
    if (!finite(from, to, count)) return { values: [], error: 'Indiquez les deux valeurs et le nombre d’essais.' };
    const n = Math.round(count!);
    if (n < 1) return { values: [], error: 'Au moins un essai.' };
    if (n > SERIES_MAX) return { values: [], error: `${SERIES_MAX} essais au plus.` };
    raw = n === 1 ? [from!] : Array.from({ length: n }, (_v, i) => from! + ((to! - from!) * i) / (n - 1));
  } else if (series.mode === 'around') {
    const { center, delta, step } = series;
    if (!finite(center, delta, step)) return { values: [], error: 'Indiquez la valeur, l’écart et le pas.' };
    if (step! <= 0) return { values: [], error: 'Le pas doit être positif.' };
    const k = Math.floor(Math.abs(delta!) / step! + 1e-9);
    if (2 * k + 1 > SERIES_MAX) return { values: [], error: `${2 * k + 1} essais : ${SERIES_MAX} au plus. Augmentez le pas.` };
    raw = Array.from({ length: 2 * k + 1 }, (_v, i) => center! + (i - k) * step!);
  } else {
    raw = (series.values ?? []).filter((x) => Number.isFinite(x));
    if (raw.length === 0) return { values: [], error: 'Indiquez au moins une valeur.' };
    if (raw.length > SERIES_MAX) return { values: [], error: `${SERIES_MAX} essais au plus.` };
  }
  return { values: [...new Set(raw.map(roundValue))].sort((a, b) => a - b) };
}

/** Valeur d'essai écrite pour l'utilisateur (virgule décimale, 4 décimales au plus). */
export function formatSeriesValue(v: number): string {
  return v.toLocaleString('fr-FR', { maximumFractionDigits: 4, useGrouping: false });
}

/** Clé d'une version calculée : pièce, paramètre, valeur et marquage. */
export function variantKey(partId: Id, series: Pick<PrintSeries, 'parameter' | 'mark' | 'zone'>, value: number): string {
  return `${partId}|${series.parameter.toLowerCase()}|${roundValue(value)}|${series.mark ? JSON.stringify(series.mark) : ''}|${series.zone ? JSON.stringify(series.zone) : ''}`;
}

/** Marquage d'une version (texte de la valeur centré sur la face), d'après le maillage de la pièce. */
export function seriesMark(mesh: MeshData | null | undefined, series: PrintSeries, value: number): (VariantMark & { tooSmall: boolean }) | null {
  if (!series.mark || !mesh) return null;
  const clip = series.zone ? zoneBox(mesh, series.zone.face, series.zone.margin) : null;
  return markLayout(mesh, series.mark.face, formatSeriesValue(value), series.mark.height, series.mark.depth, clip);
}

/** Version d'une pièce pour une valeur d'essai, calculée à part. */
export interface PrintVariant {
  mesh: MeshData | null;
  meshKey: string | null;
  analysis: ShapeAnalysis | null;
  /** Étape en échec dans cette version (son nom). */
  failed?: string;
  /** Zone d'essai : face introuvable, ou zone sans matière. */
  zone?: 'lost' | 'empty';
}

export interface PrintPlacement {
  partId: Id;
  name: string;
  /** Rang de l'exemplaire parmi ceux de la pièce (toutes valeurs d'essai confondues). */
  copy: number;
  /** Plateau (0, 1, 2…) : quand un plateau est plein, on passe au suivant. */
  plate: number;
  matrix: Mat4;
  size: Vec3;
  /** Matière estimée de cet exemplaire (g). */
  grams: number;
  /** Série d'essais : valeur du paramètre ; `pending` tant que cette version n'est pas calculée. */
  variant?: { parameter: string; value: number; pending: boolean };
  /** Maillage de la version d'essai (absent : celui de la pièce). */
  mesh?: MeshData;
  meshKey?: string | null;
}

export interface PrintLayout {
  placements: PrintPlacement[];
  /** Nombre de plateaux nécessaires. */
  plates: number;
  /** Matière estimée (g) pour des pièces pleines en PLA. */
  grams: number;
  /** Messages pour l'utilisateur (pièce trop grande, plateau trop petit, face disparue…). */
  warnings: string[];
}

/**
 * Dispose les pièces (et leurs exemplaires) sur le plateau : chaque pièce est orientée (face
 * choisie vers le bas), mise à l'échelle, posée à z = 0 puis rangée en lignes, de gauche à droite
 * et d'avant en arrière. Quand le plateau est plein, la suite va sur un nouveau plateau. Une pièce
 * en série d'essais donne une version par valeur, dans l'ordre croissant (`variantOf` : version
 * calculée, ou undefined tant qu'elle ne l'est pas — la pièce actuelle tient alors sa place).
 */
export function printLayout(
  settings: FabricationSettings['print'],
  parts: readonly { id: Id; name: string }[],
  meshOf: (partId: Id) => MeshData | null | undefined,
  analysisOf: (partId: Id) => ShapeAnalysis | null | undefined,
  variantOf?: (partId: Id, series: PrintSeries, value: number) => PrintVariant | undefined,
): PrintLayout {
  const placements: PrintPlacement[] = [];
  const warnings: string[] = [];
  let grams = 0;
  let plate = 0;
  let x = 0;
  let y = 0;
  let rowDepth = 0;
  for (const item of settings.items as PrintItem[]) {
    const part = parts.find((p) => p.id === item.partId);
    const baseMesh = meshOf(item.partId);
    if (!part || !baseMesh || item.copies <= 0) continue;
    const series = item.series;
    let values: (number | null)[] = [null];
    if (series) {
      const r = seriesValues(series);
      if (r.error) warnings.push(`« ${part.name} », série d’essais : ${r.error}`);
      values = r.values;
      if (item.scale !== 100 && r.values.length) {
        const v = r.values[0]!;
        warnings.push(`« ${part.name} » : échelle ${formatNumber(item.scale, 1)} % pendant une série d’essais : les cotes essayées sont agrandies d’autant (${series.parameter} ${formatSeriesValue(v)} → ${formatSeriesValue((v * item.scale) / 100)} mm). Remettez 100 %.`);
      }
      // Marquage : la face existe-t-elle encore, le texte le plus long reste-t-il lisible ?
      const longest = [...r.values].sort((a, b) => formatSeriesValue(b).length - formatSeriesValue(a).length)[0];
      if (series.mark && longest !== undefined) {
        const m = seriesMark(baseMesh, series, longest);
        if (!m) warnings.push(series.zone ? `« ${part.name} » : la face du marquage n’est pas dans la zone d’essai (ou n’existe plus) ; choisissez-en une autre.` : `« ${part.name} » : la face du marquage n’existe plus ou n’est pas plane ; choisissez-en une autre.`);
        else if (m.tooSmall) warnings.push(`« ${part.name} » : face trop petite, le marquage ferait ${formatNumber(m.height, 1)} mm de haut (illisible) ; choisissez une face plus grande.`);
      }
    }
    const s = item.scale / 100;
    let copy = 0;
    let faceWarned = false;
    for (const value of values) {
      const variant = series && value !== null ? variantOf?.(item.partId, series, value) : undefined;
      const label = series && value !== null ? `${part.name} — ${series.parameter} ${formatSeriesValue(value)}` : part.name;
      if (variant?.failed) warnings.push(`« ${label} » : erreur à l’étape « ${variant.failed} ».`);
      if (variant?.zone) warnings.push(`« ${label} » : ${variant.zone === 'lost' ? 'la face de la zone d’essai n’existe plus ; choisissez-en une autre' : 'la zone d’essai ne contient aucune matière'}.`);
      if (variant && !variant.mesh) continue;
      const mesh = variant?.mesh ?? baseMesh;
      const analysis = variant ? variant.analysis : analysisOf(item.partId);
      let rotation: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
      if (item.downFace) {
        const n = faceNormal(mesh, item.downFace);
        if (n) rotation = rotationToDown(n);
        else if (!faceWarned) {
          faceWarned = true;
          warnings.push(`« ${part.name} » : la face choisie pour poser la pièce n’existe plus ; choisissez-en une autre.`);
        }
      }
      const oriented = multiply4(scale4(s), rotation);
      const b = transformedBounds(mesh, oriented);
      const size = { x: b.max.x - b.min.x, y: b.max.y - b.min.y, z: b.max.z - b.min.z };
      if (size.x > settings.bed.x || size.y > settings.bed.y || size.z > settings.bed.z) {
        warnings.push(`« ${label} » (${Math.ceil(size.x)} × ${Math.ceil(size.y)} × ${Math.ceil(size.z)} mm) est plus grande que le plateau.`);
      }
      const each = ((analysis?.volume ?? 0) * s * s * s * PLA_DENSITY) / 1000;
      grams += each * item.copies;
      for (let k = 0; k < item.copies; k++) {
        if (x > 0 && x + size.x > settings.bed.x) {
          x = 0;
          y += rowDepth + settings.spacing;
          rowDepth = 0;
        }
        if (y > 0 && y + size.y > settings.bed.y) {
          plate++;
          x = 0;
          y = 0;
          rowDepth = 0;
        }
        const at = translation4({ x: x - b.min.x, y: y - b.min.y, z: -b.min.z });
        placements.push({
          partId: item.partId,
          name: item.copies > 1 ? `${label} (${k + 1})` : label,
          copy: copy++,
          plate,
          matrix: multiply4(at, oriented),
          size,
          grams: each,
          ...(series && value !== null ? { variant: { parameter: series.parameter, value, pending: !variant } } : {}),
          ...(variant?.mesh ? { mesh: variant.mesh, meshKey: variant.meshKey } : {}),
        });
        x += size.x + settings.spacing;
        rowDepth = Math.max(rowDepth, size.y);
      }
    }
  }
  return { placements, plates: placements.length ? plate + 1 : 0, grams, warnings };
}
