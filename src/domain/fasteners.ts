/**
 * Visserie métrique normalisée (sans filetage modélisé) : dimensions des vis, écrous et rondelles
 * courants, longueurs normalisées, et diamètres de trou qui conviennent à chaque taille (passage
 * ISO 273, perçage avant taraudage). Le diamètre d'une vis est toujours déduit du trou où on la
 * pose : on ne peut pas mettre une vis de mauvaise taille.
 */

export type FastenerKind = 'iso4762' | 'iso7380' | 'iso10642' | 'iso4017' | 'iso4032' | 'iso7089';

export type MetricSize = 'M2' | 'M2.5' | 'M3' | 'M4' | 'M5' | 'M6' | 'M8' | 'M10' | 'M12';

export const METRIC_SIZES: MetricSize[] = ['M2', 'M2.5', 'M3', 'M4', 'M5', 'M6', 'M8', 'M10', 'M12'];

/** Diamètre nominal (mm). */
export function nominal(size: MetricSize): number {
  return Number(size.slice(1));
}

/** Forme de la tête (ou de la pièce, pour un écrou ou une rondelle). */
export type HeadShape = 'socket' | 'button' | 'countersunk' | 'hex' | 'nut' | 'washer';

export interface FastenerType {
  kind: FastenerKind;
  /** Nom court (« Vis CHC ») et norme (« ISO 4762 »). */
  label: string;
  standard: string;
  /** Ce que c'est, en mots simples. */
  help: string;
  shape: HeadShape;
  /** Vis : a une longueur. */
  screw: boolean;
  /** Dimensions par taille : tête (ou pièce) de diamètre `d` (sur plats pour un hexagone), hauteur `k`. */
  dims: Partial<Record<MetricSize, { d: number; k: number; lengths?: [number, number] }>>;
}

/** Longueurs normalisées des vis (mm). */
export const STANDARD_LENGTHS = [3, 4, 5, 6, 8, 10, 12, 14, 16, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 80, 90, 100, 110, 120];

export const FASTENER_TYPES: FastenerType[] = [
  {
    kind: 'iso4762',
    label: 'Vis CHC',
    standard: 'ISO 4762',
    help: 'Vis à tête cylindrique et six pans creux : la plus courante, se serre avec une clé Allen.',
    shape: 'socket',
    screw: true,
    dims: {
      M2: { d: 3.8, k: 2, lengths: [3, 20] },
      'M2.5': { d: 4.5, k: 2.5, lengths: [4, 25] },
      M3: { d: 5.5, k: 3, lengths: [5, 30] },
      M4: { d: 7, k: 4, lengths: [6, 40] },
      M5: { d: 8.5, k: 5, lengths: [8, 50] },
      M6: { d: 10, k: 6, lengths: [10, 60] },
      M8: { d: 13, k: 8, lengths: [12, 80] },
      M10: { d: 16, k: 10, lengths: [16, 100] },
      M12: { d: 18, k: 12, lengths: [20, 120] },
    },
  },
  {
    kind: 'iso7380',
    label: 'Vis BHC',
    standard: 'ISO 7380-1',
    help: 'Vis à tête bombée et six pans creux : tête basse et arrondie, qui dépasse peu.',
    shape: 'button',
    screw: true,
    dims: {
      M3: { d: 5.7, k: 1.65, lengths: [5, 30] },
      M4: { d: 7.6, k: 2.2, lengths: [6, 40] },
      M5: { d: 9.5, k: 2.75, lengths: [8, 50] },
      M6: { d: 10.5, k: 3.3, lengths: [10, 60] },
      M8: { d: 14, k: 4.4, lengths: [16, 80] },
      M10: { d: 17.5, k: 5.5, lengths: [20, 90] },
      M12: { d: 21, k: 6.6, lengths: [25, 90] },
    },
  },
  {
    kind: 'iso10642',
    label: 'Vis FHC',
    standard: 'ISO 10642',
    help: 'Vis à tête fraisée (conique à 90°) et six pans creux : la tête s’enfonce dans un trou fraisé et ne dépasse pas.',
    shape: 'countersunk',
    screw: true,
    dims: {
      M3: { d: 6.72, k: 1.86, lengths: [8, 30] },
      M4: { d: 8.96, k: 2.48, lengths: [8, 40] },
      M5: { d: 11.2, k: 3.1, lengths: [8, 50] },
      M6: { d: 13.44, k: 3.72, lengths: [8, 60] },
      M8: { d: 17.92, k: 4.96, lengths: [10, 80] },
      M10: { d: 22.4, k: 6.2, lengths: [12, 100] },
      M12: { d: 26.88, k: 7.44, lengths: [20, 100] },
    },
  },
  {
    kind: 'iso4017',
    label: 'Vis H',
    standard: 'ISO 4017',
    help: 'Vis à tête hexagonale, entièrement filetée : se serre avec une clé plate.',
    shape: 'hex',
    screw: true,
    dims: {
      M3: { d: 5.5, k: 2, lengths: [6, 30] },
      M4: { d: 7, k: 2.8, lengths: [8, 40] },
      M5: { d: 8, k: 3.5, lengths: [10, 50] },
      M6: { d: 10, k: 4, lengths: [12, 60] },
      M8: { d: 13, k: 5.3, lengths: [16, 80] },
      M10: { d: 16, k: 6.4, lengths: [20, 100] },
      M12: { d: 18, k: 7.5, lengths: [25, 120] },
    },
  },
  {
    kind: 'iso4032',
    label: 'Écrou H',
    standard: 'ISO 4032',
    help: 'Écrou hexagonal : il se visse au bout d’une vis qui traverse les pièces.',
    shape: 'nut',
    screw: false,
    dims: {
      M2: { d: 4, k: 1.6 },
      'M2.5': { d: 5, k: 2 },
      M3: { d: 5.5, k: 2.4 },
      M4: { d: 7, k: 3.2 },
      M5: { d: 8, k: 4.7 },
      M6: { d: 10, k: 5.2 },
      M8: { d: 13, k: 6.8 },
      M10: { d: 16, k: 8.4 },
      M12: { d: 18, k: 10.8 },
    },
  },
  {
    kind: 'iso7089',
    label: 'Rondelle plate',
    standard: 'ISO 7089',
    help: 'Rondelle plate : elle se glisse sous une tête de vis ou un écrou pour mieux répartir le serrage.',
    shape: 'washer',
    screw: false,
    dims: {
      M2: { d: 5, k: 0.3 },
      'M2.5': { d: 6, k: 0.5 },
      M3: { d: 7, k: 0.5 },
      M4: { d: 9, k: 0.8 },
      M5: { d: 10, k: 1 },
      M6: { d: 12, k: 1.6 },
      M8: { d: 16, k: 1.6 },
      M10: { d: 20, k: 2 },
      M12: { d: 24, k: 2.5 },
    },
  },
];

export function fastenerType(kind: FastenerKind): FastenerType {
  return FASTENER_TYPES.find((t) => t.kind === kind)!;
}

/** Tailles existant dans la norme. */
export function sizesOf(kind: FastenerKind): MetricSize[] {
  const dims = fastenerType(kind).dims;
  return METRIC_SIZES.filter((s) => dims[s]);
}

/** Longueurs normalisées d'une vis de cette taille (vide pour un écrou ou une rondelle). */
export function lengthsOf(kind: FastenerKind, size: MetricSize): number[] {
  const range = fastenerType(kind).dims[size]?.lengths;
  return range ? STANDARD_LENGTHS.filter((l) => l >= range[0] && l <= range[1]) : [];
}

/** Trous de passage ISO 273 (série fine, moyenne, large) et perçage avant taraudage (mm). */
export const HOLES: Record<MetricSize, { fine: number; medium: number; coarse: number; tap: number }> = {
  M2: { fine: 2.2, medium: 2.4, coarse: 2.6, tap: 1.6 },
  'M2.5': { fine: 2.7, medium: 2.9, coarse: 3.1, tap: 2.05 },
  M3: { fine: 3.2, medium: 3.4, coarse: 3.6, tap: 2.5 },
  M4: { fine: 4.3, medium: 4.5, coarse: 4.8, tap: 3.3 },
  M5: { fine: 5.3, medium: 5.5, coarse: 5.8, tap: 4.2 },
  M6: { fine: 6.4, medium: 6.6, coarse: 7, tap: 5 },
  M8: { fine: 8.4, medium: 9, coarse: 10, tap: 6.8 },
  M10: { fine: 10.5, medium: 11, coarse: 12, tap: 8.5 },
  M12: { fine: 13, medium: 13.5, coarse: 14.5, tap: 10.2 },
};

export type HoleMatch = { size: MetricSize; hole: 'clearance' | 'tapped' };

/**
 * Tailles de vis qui conviennent à un trou de ce diamètre, la plus probable d'abord : trou de
 * passage (du diamètre nominal, fréquent en impression 3D, jusqu'à la série large ISO 273 ; la
 * plus grosse vis qui passe), puis perçage de taraudage (± 0,15 mm).
 */
export function holeMatches(diameter: number): HoleMatch[] {
  const out: HoleMatch[] = [];
  for (const size of [...METRIC_SIZES].reverse()) {
    if (diameter >= nominal(size) - 0.05 && diameter <= HOLES[size].coarse + 0.05) out.push({ size, hole: 'clearance' });
  }
  for (const size of METRIC_SIZES) if (Math.abs(diameter - HOLES[size].tap) <= 0.15) out.push({ size, hole: 'tapped' });
  return out;
}

export function matchHole(diameter: number): HoleMatch | null {
  return holeMatches(diameter)[0] ?? null;
}

/** Fraisure d'une vis FHC : le cercle cliqué a à peu près le diamètre de la tête. */
export function matchCountersink(diameter: number): MetricSize | null {
  const t = fastenerType('iso10642');
  return sizesOf('iso10642').find((s) => Math.abs(diameter - t.dims[s]!.d) <= Math.max(0.6, 0.08 * t.dims[s]!.d)) ?? null;
}

/** Explication quand aucun élément de visserie ne va dans un trou. */
export function holeAdvice(diameter: number): string {
  const d = diameter.toFixed(2).replace(/\.?0+$/, '').replace('.', ',');
  return `Ce trou fait ${d} mm : aucune vis métrique normalisée n’y va. Exemples : M3 → trou de passage 3,2 à 3,6 mm (ISO 273) ou 2,5 mm à tarauder ; M4 → 4,3 à 4,8 mm ou 3,3 mm.`;
}

/**
 * Longueur proposée pour une vis qui traverse `depth` mm de matière : la plus petite longueur
 * normalisée qui dépasse d'au moins un diamètre (de quoi prendre un écrou ou se visser dans la pièce
 * suivante) ; dans un trou taraudé, celle qui remplit au mieux le trou.
 */
export function suggestedLength(kind: FastenerKind, size: MetricSize, depth: number, hole: 'clearance' | 'tapped'): number | null {
  const lengths = lengthsOf(kind, size);
  if (lengths.length === 0) return null;
  const head = kind === 'iso10642' ? fastenerType(kind).dims[size]!.k : 0;
  const wanted = hole === 'tapped' ? Math.min(depth, 2 * nominal(size)) : depth + nominal(size) + head;
  const fit = hole === 'tapped' ? [...lengths].reverse().find((l) => l <= Math.max(wanted, lengths[0]!)) : lengths.find((l) => l >= wanted);
  return fit ?? lengths[lengths.length - 1]!;
}

/** Désignation normalisée : « Vis CHC ISO 4762 M3 × 12 », « Écrou H ISO 4032 M3 ». */
export function designation(kind: FastenerKind, size: MetricSize, length?: number): string {
  const t = fastenerType(kind);
  return `${t.label} ${t.standard} ${size}${t.screw && length ? ` × ${length}` : ''}`;
}
