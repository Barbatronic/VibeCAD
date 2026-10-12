/**
 * Préparation de la fabrication (calculs purs, testables) : réglages par défaut, orientation
 * « face posée sur le plateau », disposition des pièces et des exemplaires sur le plateau
 * d'impression, estimation de matière.
 */
import type { CadDocument, FabricationSettings, FaceRef, Id, LaserMaterial, PrintItem } from '../domain/model';
import type { FaceTag, MeshData, ShapeAnalysis } from '../geometry/kernel';
import { multiply4, translation4, type Mat4 } from '../math/mat4';
import { normalize3, type Vec3 } from '../math/vec';

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

/** Réglages du projet, complétés : chaque pièce ayant un volume a sa ligne. */
export function fabricationSettings(doc: CadDocument, hasSolid: (partId: Id) => boolean): FabricationSettings {
  const f = doc.fabrication ?? DEFAULT_FABRICATION;
  const parts = doc.parts.filter((p) => hasSolid(p.id));
  return {
    print: {
      ...f.print,
      items: parts.map((p) => f.print.items.find((i) => i.partId === p.id) ?? { partId: p.id, copies: 1, scale: 100 }),
    },
    laser: {
      ...f.laser,
      items: parts.map((p) => f.laser.items.find((i) => i.partId === p.id) ?? { partId: p.id, copies: 0 }),
    },
  };
}

const sameTag = (t: FaceTag, r: FaceRef) =>
  t.featureId === r.featureId && t.role === r.role && (t.entityId ?? null) === (r.entityId ?? null) && (t.index ?? null) === (r.index ?? null);

/** Normale sortante d'une face plane désignée (null si elle n'existe plus ou n'est pas plane). */
export function faceNormal(mesh: MeshData, ref: FaceRef): Vec3 | null {
  const face = mesh.faces.find((f) => f.plane && f.tags.some((t) => sameTag(t, ref)));
  return face?.plane?.normal ?? null;
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

export interface PrintPlacement {
  partId: Id;
  name: string;
  copy: number;
  /** Plateau (0, 1, 2…) : quand un plateau est plein, on passe au suivant. */
  plate: number;
  matrix: Mat4;
  size: Vec3;
  /** Matière estimée de cet exemplaire (g). */
  grams: number;
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
 * et d'avant en arrière. Quand le plateau est plein, la suite va sur un nouveau plateau.
 */
export function printLayout(
  settings: FabricationSettings['print'],
  parts: readonly { id: Id; name: string }[],
  meshOf: (partId: Id) => MeshData | null | undefined,
  analysisOf: (partId: Id) => ShapeAnalysis | null | undefined,
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
    const mesh = meshOf(item.partId);
    if (!part || !mesh || item.copies <= 0) continue;
    const s = item.scale / 100;
    let rotation: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    if (item.downFace) {
      const n = faceNormal(mesh, item.downFace);
      if (n) rotation = rotationToDown(n);
      else warnings.push(`« ${part.name} » : la face choisie pour poser la pièce n’existe plus ; choisissez-en une autre.`);
    }
    const oriented = multiply4(scale4(s), rotation);
    const b = transformedBounds(mesh, oriented);
    const size = { x: b.max.x - b.min.x, y: b.max.y - b.min.y, z: b.max.z - b.min.z };
    if (size.x > settings.bed.x || size.y > settings.bed.y || size.z > settings.bed.z) {
      warnings.push(`« ${part.name} » (${Math.ceil(size.x)} × ${Math.ceil(size.y)} × ${Math.ceil(size.z)} mm) est plus grande que le plateau.`);
    }
    const each = ((analysisOf(item.partId)?.volume ?? 0) * s * s * s * PLA_DENSITY) / 1000;
    grams += each * item.copies;
    for (let copy = 0; copy < item.copies; copy++) {
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
      placements.push({ partId: item.partId, name: item.copies > 1 ? `${part.name} (${copy + 1})` : part.name, copy, plate, matrix: multiply4(at, oriented), size, grams: each });
      x += size.x + settings.spacing;
      rowDepth = Math.max(rowDepth, size.y);
    }
  }
  return { placements, plates: placements.length ? plate + 1 : 0, grams, warnings };
}
