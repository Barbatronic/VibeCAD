/**
 * Tôlerie et pliage : matériaux pliables et calculs de pli (domaine pur, sans géométrie).
 *
 * Un pli d'angle θ (radians), de rayon intérieur r, dans une tôle d'épaisseur t, consomme une
 * longueur de matière à plat (« longueur développée du pli ») de θ · (r + K · t) : la fibre
 * neutre, ni étirée ni écrasée, est à K · t de la face intérieure. K (facteur K) dépend du
 * matériau et du rapport r / t : 0,5 pour un pli très arrondi ou un plastique chauffé, vers 0,33
 * pour un pli serré dans du métal. Les valeurs ci-dessous sont indicatives (atelier scolaire) :
 * un essai sur une chute reste le meilleur réglage.
 */

export interface SheetMaterial {
  id: string;
  name: string;
  /** Pliage à froid (plieuse, étau) ou à chaud (thermoplieuse : fil chauffant le long du pli). */
  method: 'cold' | 'hot';
  /** Épaisseurs courantes (mm), proposées dans la liste. */
  thicknesses: number[];
  /** Rayon intérieur minimal = facteur × épaisseur (en dessous, la tôle risque de casser). */
  minRadiusFactor: number;
  /** Angle de pli maximal (degrés) avant de casser ou de blanchir. */
  maxAngle: number;
  /** Facteur K pour un pli dont le rayon vaut environ l'épaisseur. */
  kFactor: number;
  /** Conseil affiché avec le matériau. */
  note: string;
}

export const SHEET_MATERIALS: SheetMaterial[] = [
  {
    id: 'steel',
    name: 'Acier doux',
    method: 'cold',
    thicknesses: [0.5, 0.8, 1, 1.5, 2],
    minRadiusFactor: 1,
    maxAngle: 160,
    kFactor: 0.42,
    note: 'Se plie à froid à la plieuse ; rayon au moins égal à l’épaisseur.',
  },
  {
    id: 'stainless',
    name: 'Inox',
    method: 'cold',
    thicknesses: [0.5, 0.8, 1, 1.5],
    minRadiusFactor: 2,
    maxAngle: 135,
    kFactor: 0.45,
    note: 'Dur et élastique : il revient un peu après le pli (pliez un peu plus que l’angle voulu).',
  },
  {
    id: 'aluminium',
    name: 'Aluminium',
    method: 'cold',
    thicknesses: [0.5, 1, 1.5, 2, 3],
    minRadiusFactor: 1.5,
    maxAngle: 135,
    kFactor: 0.42,
    note: 'Se plie facilement à froid ; un pli trop serré le fissure (rayon ≥ 1,5 × épaisseur).',
  },
  {
    id: 'brass',
    name: 'Laiton',
    method: 'cold',
    thicknesses: [0.5, 0.8, 1],
    minRadiusFactor: 1,
    maxAngle: 160,
    kFactor: 0.44,
    note: 'Se plie à froid ; il durcit si on le plie plusieurs fois au même endroit.',
  },
  {
    id: 'acrylic',
    name: 'Acrylique (PMMA)',
    method: 'hot',
    thicknesses: [2, 3, 4, 5],
    minRadiusFactor: 1,
    maxAngle: 135,
    kFactor: 0.5,
    note: 'Pliage à chaud (thermoplieuse) : à froid, il casse. Chauffez des deux côtés pour plus de 3 mm.',
  },
  {
    id: 'petg',
    name: 'PETG',
    method: 'hot',
    thicknesses: [0.5, 1, 2, 3],
    minRadiusFactor: 1,
    maxAngle: 160,
    kFactor: 0.5,
    note: 'Pliage à chaud, plus souple que l’acrylique ; une feuille fine se plie aussi à froid.',
  },
  {
    id: 'polypropylene',
    name: 'Polypropylène',
    method: 'cold',
    thicknesses: [0.5, 0.8, 1, 2],
    minRadiusFactor: 0.5,
    maxAngle: 180,
    kFactor: 0.5,
    note: 'Se plie à froid et supporte des milliers de pliages (charnière) : idéal pour les boîtes.',
  },
  {
    id: 'cardboard',
    name: 'Carton',
    method: 'cold',
    thicknesses: [0.5, 1, 1.5, 2, 3],
    minRadiusFactor: 0.5,
    maxAngle: 180,
    kFactor: 0.5,
    note: 'Pour la maquette : rainez (marquez) le pli avant de plier.',
  },
];

export const DEFAULT_SHEET_MATERIAL = 'aluminium';

export function sheetMaterial(id: string): SheetMaterial {
  return SHEET_MATERIALS.find((m) => m.id === id) ?? SHEET_MATERIALS.find((m) => m.id === DEFAULT_SHEET_MATERIAL)!;
}

/** Rayon intérieur minimal (mm) d'un matériau pour une épaisseur. */
export function minBendRadius(material: SheetMaterial, thickness: number): number {
  return material.minRadiusFactor * thickness;
}

/** Rayon proposé par défaut : le minimum du matériau, sans descendre sous 0,5 mm. */
export function defaultBendRadius(material: SheetMaterial, thickness: number): number {
  return Math.max(0.5, Math.round(minBendRadius(material, thickness) * 10) / 10);
}

/**
 * Facteur K selon le rayon : le matériau donne K pour r ≈ t ; un pli plus serré rapproche la fibre
 * neutre de l'intérieur (K plus petit), un pli très ouvert la ramène au milieu (0,5).
 */
export function kFactorFor(material: SheetMaterial, radius: number, thickness: number): number {
  if (material.kFactor >= 0.5) return 0.5;
  const ratio = thickness > 0 ? radius / thickness : 1;
  if (ratio >= 4) return 0.5;
  if (ratio <= 1) return Math.max(0.33, material.kFactor - 0.08 * (1 - ratio));
  return material.kFactor + ((0.5 - material.kFactor) * (ratio - 1)) / 3;
}

/** Longueur développée d'un pli (mm) : longueur de la fibre neutre dans l'arrondi. */
export function bendAllowance(angleDeg: number, radius: number, thickness: number, k: number): number {
  return (Math.abs(angleDeg) * Math.PI * (radius + k * thickness)) / 180;
}

export type BendIssue = { kind: 'radius'; min: number } | { kind: 'angle'; max: number } | { kind: 'thickness'; available: number[] };

/** Ce qui rend un pli risqué pour ce matériau (rayon trop petit, angle trop grand, épaisseur rare). */
export function bendIssues(material: SheetMaterial, thickness: number, radius: number, angleDeg: number): BendIssue[] {
  const issues: BendIssue[] = [];
  const min = minBendRadius(material, thickness);
  if (radius < min - 1e-9) issues.push({ kind: 'radius', min });
  if (Math.abs(angleDeg) > material.maxAngle + 1e-9) issues.push({ kind: 'angle', max: material.maxAngle });
  if (!material.thicknesses.some((t) => Math.abs(t - thickness) < 1e-6)) issues.push({ kind: 'thickness', available: material.thicknesses });
  return issues;
}
