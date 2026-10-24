/**
 * Matière d'une pièce : sert à sa masse (Propriétés) et de matériau par défaut à ses études de
 * simulation. Mêmes identifiants que les matériaux de la simulation (`sim/materials.ts`).
 */
import type { Part } from './model';

export interface PartMaterial {
  id: string;
  name: string;
  /** Masse volumique (g/cm³), pièce pleine. */
  density: number;
}

export const PART_MATERIALS: PartMaterial[] = [
  { id: 'pla', name: 'PLA', density: 1.24 },
  { id: 'petg', name: 'PETG', density: 1.27 },
  { id: 'abs', name: 'ABS', density: 1.04 },
  { id: 'tpu', name: 'TPU (souple)', density: 1.21 },
  { id: 'plywood', name: 'Contreplaqué', density: 0.6 },
  { id: 'acrylic', name: 'Acrylique (PMMA)', density: 1.18 },
  { id: 'aluminium', name: 'Aluminium', density: 2.7 },
  { id: 'steel', name: 'Acier', density: 7.85 },
];

export const DEFAULT_PART_MATERIAL = 'pla';

export function partMaterial(id: string | undefined): PartMaterial {
  return PART_MATERIALS.find((m) => m.id === id) ?? PART_MATERIALS.find((m) => m.id === DEFAULT_PART_MATERIAL)!;
}

/**
 * Matière de la pièce : celle choisie, sinon celle de sa tôle quand elle en a une (acrylique, acier,
 * aluminium, PETG), sinon le PLA.
 */
export function partMaterialId(part: Part): string {
  if (part.material && PART_MATERIALS.some((m) => m.id === part.material)) return part.material;
  const sheet = part.features.find((f) => f.type === 'sheet');
  const fromSheet = sheet?.type === 'sheet' ? sheet.params.materialId : undefined;
  if (fromSheet && PART_MATERIALS.some((m) => m.id === fromSheet)) return fromSheet;
  return DEFAULT_PART_MATERIAL;
}

/** Masse (g) d'un volume plein (mm³) dans cette matière. */
export function massOf(volumeMm3: number, material: PartMaterial): number {
  return (volumeMm3 / 1000) * material.density;
}
